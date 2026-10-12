# codemode-git: sketch

> **Note (Oct 11):** this is the original design sketch. The curator and skills library (sections 3 onward) were built, tested on DABstep, and removed in favor of the simpler examples layer; see [README.md](README.md) and [docs/experiments.md](docs/experiments.md).

**Pitch:** A drop-in plugin for `@cloudflare/codemode` that turns every Code Mode execution into a commit on that agent's own Cloudflare Artifacts repo. An *optional* curator subscribes to push events across a whole namespace of agent repos. It mines working code into a shared, verified skill library, which flows back into every agent as Code Mode **snippets**.

Competition brief: *"a new way for hundreds of thousands of agents to work on changes concurrently"*. Deadline **Oct 14**: a 5–10 min demo, open source, run instructions.

| GitHub concept | codemode-git replacement |
|---|---|
| Shared repo + branches | One Artifacts repo per agent, all inside one namespace |
| Commit | One Code Mode execution: code + tool-call log + outcome |
| Pull request | A skill proposal mined from many agents' successful commits |
| Code review | Replay verification against the recorded tool-call logs |
| Merge conflict | Competing proposals, settled by replay pass rate and reuse |
| Dependency | `skills.lock` pins an immutable skill-library commit |

---

## 0. How it fits the existing codemode SDK (checked against `@cloudflare/codemode@0.5.3`)

The current SDK already has most of the pieces. We plug into four existing seams:

| Existing codemode piece | What we hook |
|---|---|
| `CodemodeRuntime` (DO facet) keeps a durable **execution log**: `ExecutionState { id, code, status, log: ToolLogEntry[], result, error, connectors }`, auto-pruned to the newest 50 | Git becomes the *permanent* audit trail behind it |
| `CodemodeConnector.disposeExecution(executionId, status)` fires on every terminal transition (`completed / error / rejected / rolled_back`) for every connector | **Our commit hook.** No wrapping of executor or runtime needed |
| **Snippets**: `runtime.saveSnippet`, `codemode.search` / `describe` / `run`. The SDK doc explicitly says promotion should come from "an eval, or your own heuristics, not the model's judgement" | The curator *is* that eval. Skills land in agents as snippets, so they get search, describe, the connector-requirement check and approval-aware execution for free |
| `ToolLogEntry` records each call's args and results for replay | Free, deterministic fixtures for verifying skills by replay |

So the integration story for an existing codemode agent is: **add one connector**. The curator runs as a separate Worker and the agent doesn't know it exists.

### The one gap: installing a snippet from outside

`saveSnippet(name, { executionId })` can only promote an execution's own code. There's no public way to insert a snippet whose code came from elsewhere. Snippets live in the facet's private `cm_snippets` table.

- **Plan:** a ~20-line upstream PR to `cloudflare/agents` adding `runtime.installSnippet({ name, code, description, inputSchema, connectors })`. Ship it as a `pnpm patch` for the demo. Proposing a clean upstream API to the judges' own SDK is a good look.
- **Fallback:** a `skills` connector whose methods are library skills. That's worse, because connector methods run host-side and so can't call other connectors through the replay log.

---

## 1. Package layout

```
codemode-git/
  packages/
    codemode-git/          # the plugin (agent side)
      src/connector.ts     #   GitHistoryConnector: disposeExecution -> commit
      src/sink.ts          #   GitSink interface + ArtifactsSink (isomorphic-git push)
      src/skills.ts        #   syncSkills(runtime, {repo, ref}) -> installSnippet
      src/format.ts        #   commit layout + trailers (shared with curator)
    curator/               # optional secondary layer (separate Worker)
      src/workflow.ts      #   CuratorWorkflow, triggered by cf.artifacts.repo.pushed
      src/verify.ts        #   replay a candidate against recorded ToolLogEntry fixtures
  examples/
    agent/                 # stock codemode agent + 3 lines of codemode-git
  demo/                    # load generator + dashboard
```

## 2. Agent side: every execution is a commit

### Usage (the whole integration)

```ts
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { gitHistory, syncSkills } from "codemode-git";

const history = gitHistory({ artifacts: this.env.ARTIFACTS, repo: `agent-${this.name}` });

const runtime = history.bind(createCodemodeRuntime({
  ctx: this.ctx,
  executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
  connectors: [github, slack, history.connector],   // <- the plugin
}));

await syncSkills(runtime, { artifacts: this.env.ARTIFACTS, repo: "skills" }); // optional
```

`bind()` exists because a connector can't see the runtime on its own. The hook only gets `(executionId, status)`, so the connector needs the handle to read `runtime.executions()`.

### Commit hook

```ts
class GitHistoryConnector extends CodemodeConnector {
  name() { return "history"; }

  // Optional model-facing reads: lets the agent look back past the 50-run retention.
  protected tools() {
    return {
      log:  { description: "Recent past executions (intent, status, sha)", execute: ... },
      show: { description: "Code + tool calls of a past execution by sha", execute: ... },
    };
  }

  override async disposeExecution(executionId: string, status: ExecutionEndStatus) {
    const exec = await this.runtime.find(executionId);
    if (!exec || await this.sink.hasCommit(executionId, status)) return;  // idempotent
    this.ctx.waitUntil(this.sink.commit(toCommit(exec, status)));         // don't block the tool result
  }
}
```

SDK rules this has to respect: the hook can fire twice (`completed` then `rolled_back`), may run on a fresh instance, and must never throw. Firing twice is actually useful: a rollback shows up as a second commit on top of the run.

### Repo layout per agent (`agent-<id>`)

```
run.js            # this execution's code. `git log -p run.js` = the agent's trajectory
calls.jsonl       # ToolLogEntry[]: connector, method, args, result, state
result.json       # final result / error (redacted)
skills.lock       # skill-library sha this agent is pinned to
```

Commit message:
```
<intent: one line>

Codemode-Execution: exec_abc123
Codemode-Status: completed
Codemode-Connectors: github, slack
Codemode-Snippets: paginate-search          # snippets it called via codemode.run
```

**Intent** is the one thing `ExecutionState` doesn't carry. The plugin takes `describe?: (exec) => string | Promise<string>`. In the example agent we pass the last user message. The default is a cheap LLM summary of the code.

### Write path

The Artifacts **binding can't write commits**; it only creates, forks and reads repos. Writes go through git-over-HTTPS with a write-scoped repo token, using **isomorphic-git** inside the Worker. Each agent's Durable Object is the **only writer** to its repo, so pushes never race. That property is the whole concurrency argument at the storage layer.

Cost concern: a clone + commit + push per execution. To avoid it, persist the isomorphic-git object store in the agent DO's SQLite, so each run is a local commit plus an incremental push. We can also batch pushes on a DO alarm.

> Checked `cf` v1.0.0-beta.12: Artifacts write operations cover namespaces, repos (create/fork/import/delete) and tokens only. Commits, files, trees, blobs and logs are **read-only**, so writes still go through git push with a repo token. Use `cf` for setup (namespace, `skills` repo, tokens) and in the demo for reading. `GitSink` stays an interface in case a commit endpoint ships.

## 3. Curator: optional, event-driven, over a namespace

The curator subscribes to the collection, not to individual agents. In the Workflow's Wrangler config, use the `cf.artifacts.repo.pushed` trigger and **omit `repoName`**, so it fires for every repo in the namespace. The namespace *is* the "collection of git repos". Different namespaces (e.g. per tenant) get separate curators and libraries.

`CuratorWorkflow` steps, per pushed commit:

1. **Filter:** only `Codemode-Status: completed`. Read `run.js` and `calls.jsonl` via the binding (`readFile`).
2. **Embed and cluster:** embed intent + code into Vectorize and look for near-duplicates **across different agent repos**. Promote when ≥3 distinct repos have done the same thing. That cross-repo threshold is what makes this more than single-agent Voyager.
3. **Generalize:** an LLM turns the cluster into one parameterized snippet `async (input) => {...}`, plus a description, an `inputSchema`, and the connectors it requires.
4. **Verify by replay:** run the candidate in a Dynamic Worker against each source run's `calls.jsonl`. A fixture connector serves recorded results and fails on argument divergence, which mirrors codemode's own divergence check. Require the candidate to match the original final results.
5. **Commit:** write to the `skills` repo as `skills/<name>/{snippet.js, meta.json, fixtures/, provenance.json}`, where provenance lists the source repo + sha pairs. The curator is the **only writer** to `skills`.
6. **Reorganize** (cron, Voyager's compositional step): merge near-duplicate skills, compose skills that always run in sequence into higher-level ones, and retire skills nobody uses.

Voyager mapping: the skill library is the `skills` repo plus Vectorize. Iterative prompting with feedback shows up as the agent's error→fix commit chains. Self-verification is the replay against recorded calls. An automatic curriculum (surfacing clusters of *failed* runs as "skills wanted") is a stretch goal.

**Back to agents:** `syncSkills` reads `skills` at the ref pinned in `skills.lock` and calls `installSnippet` for each skill whose connector requirements this agent meets. Upgrading the pin is itself a commit to the agent's repo, so any skill change is visible and revertible per agent.

## 4. Why it scales

- **Zero shared write targets on the hot path:** each agent writes only its own repo, and only the curator writes `skills`.
- **Reads are immutable:** agents pin a skill sha, so library changes never break a running agent.
- **Conflicts become selection:** two agents solving the same problem differently yields two proposals, and replay decides between them.
- **The curator is optional and asynchronous:** agents never wait on it. If it's turned off, you still have full git history per agent.

## 5. Demo (5–10 min)

1. Show the stock codemode example agent, then add `history.connector` (a 3-line diff).
2. Load generator: about 30 agents with varied tasks that share hidden subproblems (pagination, date normalization, retry/backoff, summarizing tables).
3. Live grid of agent repos with commits ticking in. Run `git clone` on one with the plain git CLI and show the error→fix chain with `git log -p run.js`.
4. Turn on the curator: a cluster across 4 repos, then replay verification passes, then a commit to `skills` with provenance links.
5. New agents call `codemode.run("paginate-search")`. Chart tokens and attempts per task before vs after.

## 6. Build order (3 days)

- **Day 1:** `GitHistoryConnector` + `ArtifactsSink` (isomorphic-git) + example agent. One execution becomes one commit, visible with `git clone`.
- **Day 2:** `installSnippet` patch + `syncSkills`, then the curator Workflow on `repo.pushed` (filter → cluster → generalize → verify → commit).
- **Day 3:** Load generator, dashboard, metrics, demo recording, README, and the upstream PR draft.

Cut first if behind: the reorganize step, the `history.log/show` tools, and the DO-backed object store (fall back to a shallow clone per commit).

## Open questions

- Granularity: start with whole executions as skills (the snippet shape already fits); extracting sub-functions is a stretch goal.
- Redaction: `calls.jsonl` holds real tool results. Redact by default and keep full fixtures only in a private namespace.
- Paused runs: commit on `onPassEnd("paused")` to an `exec/<id>` branch, or ignore them? Ignore for v1.

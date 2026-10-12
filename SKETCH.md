# codemode-git: design notes

> **History:** this started as a design sketch for a curator Worker that mined agents' runs into a shared library of verified skills, installed into agents as Code Mode snippets. That was built, tested on DABstep and removed: agents copied a skill's wrong interpretation along with its code, so errors became correlated across agents. The simpler examples layer replaced it (see [docs/experiments.md](docs/experiments.md)). The curator is in git history before `af8fa3d`. These notes describe what exists now.

**Pitch:** A drop-in connector for `@cloudflare/codemode` that turns every Code Mode execution into a commit on that agent's own Cloudflare Artifacts repo. Optionally, each agent's answer-producing runs are embedded into Vectorize, so new agents start with the closest runs other agents committed, shown as *unverified* examples.

| GitHub concept | codemode-git replacement |
|---|---|
| Shared repo + branches | One Artifacts repo per agent, all inside one namespace |
| Commit | One Code Mode execution: code + tool-call log + outcome |
| Code search across repos | Vectorize over question + code of answer-producing runs |
| Permalink | An example is `repo@sha`, so it links back to the full run |

---

## 0. How it fits the codemode SDK (checked against `@cloudflare/codemode@0.5.3`)

| Existing codemode piece | What we hook |
|---|---|
| `CodemodeRuntime` (DO facet) keeps a durable **execution log**: `ExecutionState { id, code, status, log: ToolLogEntry[], result, error, connectors }`, auto-pruned to the newest 50 | Git becomes the *permanent* audit trail behind it |
| `CodemodeConnector.disposeExecution(executionId, status)` fires on every terminal transition (`completed / error / rejected / rolled_back`) for every connector | **Our commit hook.** No wrapping of executor or runtime needed |
| `ToolLogEntry` records each call's args and results | Committed as `calls.jsonl` |

So the integration for an existing codemode agent is: **add one connector**.

## 1. Upstream gaps

Nothing here blocks the package; each would remove a workaround.

- **`disposeExecution` only gets `(executionId, status)`.** The connector has to look the execution up through the runtime handle, and a connector can't see the runtime on its own. Hence `history.bind(runtime)`. Passing the terminal `ExecutionState` to the hook (or giving connectors the runtime handle) would make `bind()` unnecessary. This is the most worthwhile upstream PR to `cloudflare/agents`.
- **No intent on `ExecutionState`.** We take the code's leading `//` comment, or a `describe(exec)` callback. An optional caller-supplied label on an execution would give every connector a commit subject.
- **Artifacts can't write commits through the binding.** It only creates, forks and reads repos, so writes go through git-over-HTTPS with isomorphic-git (see §3). This is a platform feature request, not an SDK PR. `GitSink` stays an interface in case a commit endpoint ships.

## 2. Agent side: every execution is a commit

```ts
const history = new GitHistoryConnector(this.ctx, this.env, {
  sink: new ArtifactsSink({ artifacts: this.env.ARTIFACTS, repo: `agent-${name}` })
});
const runtime = history.bind(createCodemodeRuntime({ ..., connectors: [github, history] }));
```

The hook writes each terminal run to an outbox table in the agent's SQLite, then drains the outbox to the sink in order. SDK rules this has to respect: the hook can fire twice (`completed` then `rolled_back`), may run on a fresh instance, and must never throw. The outbox makes it idempotent (one commit per execution and status) and crash-safe. A rollback shows up as a second commit on top of the run.

The model also gets read-only `history.log()` and `history.show(ref)`, to look back past the runtime's 50-run retention.

### Repo layout per agent (`agent-<id>`)

```
run.js            # this execution's code. `git log -p run.js` = the agent's trajectory
calls.jsonl       # ToolLogEntry[]: connector, method, args, result, state
result.json       # final status, result or error, and logs
```

Commit message:
```
<intent: one line>

Codemode-Execution: exec_abc123
Codemode-Status: completed
Codemode-Connectors: github, slack
Codemode-Snippets: paginate-search          # SDK snippets it called via codemode.run, if any
Codemode-Examples: agent-7@1a2b3c, ...      # via extraTrailers: examples this run was shown
```

## 3. Write path

Each agent's Durable Object is the **only writer** to its repo, so pushes never race. That property is the whole concurrency argument at the storage layer. Writes use a write-scoped repo token and isomorphic-git inside the Worker, with an in-memory filesystem.

## 4. Examples: learning from other agents (optional)

- After solving: `indexExample` embeds question + code (`@cf/qwen/qwen3-embedding-0.6b`) into Vectorize with `scope`, `task`, `ok` and `repo@sha` metadata.
- Before solving: `retrieveExamples` returns the closest answer-producing runs of *other* tasks in the scope. The retrieval instruction goes on the query side only.
- Examples are shown to the model as unverified. Unlike the removed skills library, nothing is generalized or promoted, so a wrong run is one example among several rather than a shared function every agent calls.

## 5. Why it scales

- **Zero shared write targets on the hot path:** each agent writes only its own repo. Vectorize upserts are independent per run.
- **Nothing to coordinate:** retrieval is read-only and eventually consistent, and agents never wait on each other.
- **History without examples still works:** turning examples off leaves full git history per agent.

## Open questions

- Redaction: `calls.jsonl` holds real tool results. The default only truncates large values; pass `redact` to scrub, and keep full logs in a private namespace.
- Paused runs: commit on pause to an `exec/<id>` branch, or ignore them? Ignored for now.

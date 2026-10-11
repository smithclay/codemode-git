# codemode-git

Every [Code Mode](https://www.npmjs.com/package/@cloudflare/codemode) execution becomes a git commit on that agent's own [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repo. Clone it with plain `git` and `git log -p run.js` is the agent's trajectory.

An optional curator consumes push events across the whole namespace and promotes code that several agents keep writing into a shared, verified skill library. Agents pick skills up as Code Mode snippets. See [SKETCH.md](SKETCH.md) for the full design.

## Use it in a Code Mode agent

```ts
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector } from "codemode-git";

const history = new GitHistoryConnector(this.ctx, this.env, {
  sink: new ArtifactsSink({ artifacts: this.env.ARTIFACTS, repo: `agent-${name}` })
});

const runtime = history.bind(
  createCodemodeRuntime({
    ctx: this.ctx,
    executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
    connectors: [github, history] // <- add the connector
  })
);
```

When a run reaches a terminal state (`completed`, `error`, `rejected` or `rolled_back`), the connector writes it to a durable outbox in the agent's SQLite and pushes it in order. Each commit contains:

| File | Contents |
|---|---|
| `run.js` | the code the model ran |
| `calls.jsonl` | every connector call: args, result, approval state |
| `result.json` | final status, result or error, and logs |

The commit message is the run's intent (by default the code's leading `//` comment), followed by `Codemode-Execution`, `Codemode-Status`, `Codemode-Connectors` and `Codemode-Snippets` trailers. The model also gets read-only `history.log()` and `history.show(ref)` tools.

## Shared skills

Export codemode-git's runtime (a subclass of codemode's that adds `installSnippet`) and sync the library:

```ts
export { CodemodeRuntime } from "codemode-git";

await syncSkills({ ctx: this.ctx, artifacts: this.env.ARTIFACTS, connectors: ["catalog"] });
```

Each skill in the `skills` repo becomes a snippet: the model finds it with `codemode.search` and runs it with `codemode.run(name, input)`. Skills that need connectors the agent doesn't have are skipped. Set `extraTrailers` on the history connector to record the skills commit each run saw (`Codemode-Skills-Ref`).

## The curator

[packages/curator](packages/curator) is a separate Worker with one Durable Object per namespace. It is the only writer to the `skills` repo. For each new run commit it:

1. **Ingests** the commit's `run.js`, `calls.jsonl` and `result.json`, and counts reuse of any skills the run called.
2. **Checks coverage:** if an existing skill already does this, the run is marked covered. Embeddings shortlist the skills, and [Clef](https://huggingface.co/Cloudflare/clef) (`@cf/cloudflare/clef`, Cloudflare's decision model) picks the covering skill or "none".
3. **Clusters:** embeddings shortlist the nearest run from each other agent, and Clef decides in one call which ones are the same task. At least 3 distinct agents are needed.
4. **Ranks:** Clef scores how reusable the task is (0 one-off .. 2 broadly reusable). Low scores are skipped, and the published index is ordered by this score.
5. **Generalizes** the cluster into one `async (input) => ...` snippet with `@cf/moonshotai/kimi-k2.7-code`.
6. **Verifies by replay:** runs the snippet in a Dynamic Worker against each source run's recorded tool calls, and requires the same calls and the same result. On failure it sends the failures back for one repair round.
7. **Publishes** `skills/<name>/{snippet.js,meta.json,provenance.json}` and `index.json` to the `skills` repo. The commit lists every source commit.

```bash
cd packages/curator && cf dev -- --port 8788
curl -X POST localhost:8788/backfill   # walk every agent repo (idempotent)
curl localhost:8788/status             # runs, skills, reuse counts, recent attempts
```

`POST /events` accepts `cf.artifacts.repo.pushed` events directly. The deployed Worker also consumes them from a queue.

## Layout

```
packages/codemode-git/   the plugin: history connector, Artifacts sink, runtime + syncSkills
packages/curator/        the optional curator Worker
examples/agent/          a stock Code Mode agent with a paginated `catalog` connector
```

## Run the example

Prerequisites: Node 22+, a Cloudflare account with Artifacts enabled, and the `cf` CLI (v1). The example is configured with `cloudflare.config.ts`, and `cf dev` / `cf deploy` drive it. The repo's `.npmrc` uses npm's `linked` install strategy because `cf` looks for its dev server in the project's own `node_modules`.

```bash
npm install
cf artifacts namespaces create --namespace codemode-git
cd examples/agent && cf dev
```

Then run some code as agent `alice`:

```bash
curl -X POST localhost:8787/agents/alice/execute --data-binary @- <<'EOF'
// Count lamps in stock across every page
async () => {
  let cursor = null, count = 0;
  do {
    const page = await catalog.search({ category: "lamps", cursor });
    count += page.items.filter((p) => p.stock > 0).length;
    cursor = page.nextCursor;
  } while (cursor);
  return count;
}
EOF
curl localhost:8787/agents/alice/commits
```

Clone the agent's repo with a read token (use the `plaintext` value up to `?expires=`):

```bash
cf artifacts namespaces tokens create codemode-git --repo agent-alice --scope read --ttl 3600
git -c http.extraHeader="Authorization: Bearer <token>" clone https://<account-id>.artifacts.cloudflare.net/git/codemode-git/agent-alice.git
git log --format='%h %s [%(trailers:key=Codemode-Status,valueonly)]'
```

## Tests

```bash
npm test
```

`test/artifacts.smoke.test.ts` pushes to a real repo when `SMOKE_REMOTE` and `SMOKE_TOKEN` are set; otherwise it's skipped.

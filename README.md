# codemode-git

Every [Code Mode](https://www.npmjs.com/package/@cloudflare/codemode) execution becomes a git commit on that agent's own [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repo. Clone it with plain `git` and `git log -p run.js` is the agent's trajectory.

Optionally, agents learn from each other: each agent's answer-producing run is embedded into [Vectorize](https://developers.cloudflare.com/vectorize/), and a new agent starts with the closest runs other agents committed, as unverified examples. On the [DABstep](https://huggingface.co/spaces/adyen/DABstep) benchmark this cut tokens per task roughly in half without hurting accuracy (see [docs/experiments.md](docs/experiments.md)).

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

## Examples: learning from other agents' runs (optional)

```ts
import { indexExample, retrieveExamples } from "codemode-git";

// Before solving: the 3 closest answer-producing runs of other tasks in this scope.
const examples = await retrieveExamples({ ai: env.AI, index: env.EXAMPLES, scope, question, excludeTask: taskId });

// After solving: the run the answer came from becomes an example for later agents.
await indexExample({ ai: env.AI, index: env.EXAMPLES, scope, task: taskId, repo, sha, question, code, ok: true });
```

Each example is a commit (`repo@sha`), so it links back to the full run in that agent's history. Pass them to `GitHistoryConnector`'s `extraTrailers` to record which examples each run saw (`Codemode-Examples`). Show them to the model as *unverified*. In our experiments agents still wrote and ran their own code, but much less of it.

**Embeddings** use `@cf/qwen/qwen3-embedding-0.6b` (1024 dimensions). Documents are the raw question plus code; the retrieval instruction goes on the query side only. The Vectorize index needs cosine distance and metadata indexes on `scope` (string), `ok` (boolean) and `task` (string):

```bash
cf vectorize create --name codemode-git-examples --config-dimensions 1024 --config-metric cosine
for spec in scope:string ok:boolean task:string; do
  cf vectorize metadata-index create --index-name codemode-git-examples --property-name "${spec%%:*}" --index-type "${spec##*:}"
done
```

Vectorize is eventually consistent. New vectors are queryable after ~30s, but metadata filters see them only after ~1–2 minutes.

An earlier version distilled runs into a shared library of verified skills with a curator Worker. Agents copied a skill's wrong interpretation along with its code, so errors became correlated across agents (see [docs/experiments.md](docs/experiments.md)). It was removed; it's in git history before `af8fa3d`.

## Layout

```
packages/codemode-git/   the plugin: history connector, Artifacts sink, examples (Vectorize)
examples/agent/          a stock Code Mode agent with a paginated `catalog` connector
benchmarks/dabstep/      DABstep harness: stock Code Mode vs Code Mode + codemode-git
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

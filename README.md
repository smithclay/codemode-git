# codemode-git

Every [Code Mode](https://www.npmjs.com/package/@cloudflare/codemode) execution becomes a git commit on that agent's own [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repo. Clone it with plain `git` and `git log -p run.js` is the agent's trajectory.

An optional curator (coming next) subscribes to push events across the whole namespace and promotes code that keeps working into shared skills. See [SKETCH.md](SKETCH.md) for the full design.

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

## Layout

```
packages/codemode-git/   the plugin: GitHistoryConnector, ArtifactsSink, commit format
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

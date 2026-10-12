# codemode-git

[![CI](https://github.com/smithclay/codemode-git/actions/workflows/ci.yml/badge.svg)](https://github.com/smithclay/codemode-git/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@smithclay/codemode-git)](https://www.npmjs.com/package/@smithclay/codemode-git)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Built with cf](https://img.shields.io/badge/built%20with-cf%20CLI-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cf/)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/smithclay/codemode-git/tree/main/examples/agent)

**Code memory for Code Mode agents, on Cloudflare Artifacts.** Throw away the isolate, keep the code.

Every [Code Mode](https://www.npmjs.com/package/@cloudflare/codemode) execution becomes a git commit on that agent's own [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repo. Clone it with plain `git` and `git log -p run.js` is the agent's trajectory.

Optionally, agents learn from each other: each agent's answer-producing run is embedded into [Vectorize](https://developers.cloudflare.com/vectorize/), and a new agent starts with the closest runs other agents committed, as unverified examples. On all 450 tasks of the [DABstep](https://huggingface.co/spaces/adyen/DABstep) data-analysis benchmark, with the same model (glm-5.3-flash) and prompt, adding examples raised accuracy from 32.2% to 46.2% on Adyen's official scorer (hard tasks: 23.5% → 38.6%). It also cut median tokens per task by about two thirds (see [docs/experiments.md](docs/experiments.md)).

## Install

```bash
npm install @smithclay/codemode-git @cloudflare/codemode
```

`@cloudflare/codemode` is a peer dependency. The package targets Cloudflare Workers (Durable Objects, Artifacts, Vectorize), so it runs in a Worker, not in plain Node. Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

<details>
<summary>Install from GitHub Packages instead</summary>

The same package is mirrored to [GitHub Packages](https://github.com/smithclay/codemode-git/pkgs/npm/codemode-git), which needs a token even for public packages: a [personal access token (classic)](https://github.com/settings/tokens) with `read:packages`, exported as `GITHUB_TOKEN`. npm and pnpm read `.npmrc`:

```ini
@smithclay:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Yarn (v2+) reads `.yarnrc.yml`:

```yaml
npmScopes:
  smithclay:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAuthToken: "${GITHUB_TOKEN}"
```
</details>

## Use it in a Code Mode agent

```ts
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector } from "@smithclay/codemode-git";

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
import { indexExample, retrieveExamples } from "@smithclay/codemode-git";

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
examples/agent/          a stock Code Mode agent with a paginated `lamps` connector (a lava lamp wall)
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
// Count lava lamps that are flowing, across every page of the wall
async () => {
  let cursor = null, count = 0;
  do {
    const page = await lamps.wall({ cursor });
    count += page.lamps.filter((l) => l.status === "flowing").length;
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

### Run many agents at once

`scripts/swarm.mjs` starts N agents concurrently. Each one runs one execution and pushes the commit to its own repo, then the script prints commits per second and latency percentiles. Pass `ADMIN_TOKEN` if the Worker requires one.

```bash
node examples/agent/scripts/swarm.mjs https://codemode-git-example.<subdomain>.workers.dev --agents 1000 --concurrency 200
```

### Deploy it

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/smithclay/codemode-git/tree/main/examples/agent)

The button copies `examples/agent` into a new repo on your GitHub or GitLab account and deploys it with Workers Builds. Create the Artifacts namespace first: the button doesn't provision Artifacts. Set `ADMIN_TOKEN` when it asks, because the Worker runs any code it's sent. The button only reads Wrangler config, so the example also has a `wrangler.jsonc` that mirrors `cloudflare.config.ts` (CI checks both). If the button fails, deploy from the command line:

```bash
npx cf artifacts namespaces create --namespace codemode-git
cd examples/agent
npx cf deploy
npx cf workers secrets update ADMIN_TOKEN --worker codemode-git-example --text "$(openssl rand -hex 32)"
```

## Releasing

[`publish.yml`](.github/workflows/publish.yml) runs when a GitHub release is published. It checks that the tag is `v<version>` from `packages/codemode-git/package.json`, typechecks and tests, then publishes to npmjs with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no npm token, automatic provenance) and to GitHub Packages.

One-time npm setup:

1. Publish the first version from your machine (`npm publish --workspace @smithclay/codemode-git`). A trusted publisher can only be added to a package that exists.
2. In the package's settings on npmjs.com, add a trusted publisher: GitHub Actions, repository `smithclay/codemode-git`, workflow `publish.yml`, environment `npm`.
3. Under Publishing access, choose "Require two-factor authentication and disallow tokens".
4. Optionally, add required reviewers to the `npm` environment in the repo settings, so each publish waits for approval.

## Tests

```bash
npm test
```

`test/artifacts.smoke.test.ts` pushes to a real repo when `SMOKE_REMOTE` and `SMOKE_TOKEN` are set; otherwise it's skipped.

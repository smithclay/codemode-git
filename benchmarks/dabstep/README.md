# DABstep benchmark

This harness runs Adyen's [DABstep](https://huggingface.co/datasets/adyen/DABstep) data-analysis benchmark through Code Mode agents on Cloudflare Workers, in two arms:

| Arm | What the agent gets |
|---|---|
| `baseline` | Stock Code Mode: a read-only `data` connector over the DABstep context in D1. |
| `codemode-git-examples` | The same, plus codemode-git. Every run is a commit on the agent's own Artifacts repo, and the agent starts with the 3 closest answer-producing runs other agents committed, retrieved from Vectorize and shown as unverified examples. |

Each task gets one fresh agent (a `Solver` Durable Object), with the same model, prompt and step budget in both arms. The default model is `@cf/zai-org/glm-5.3-flash` on Workers AI, with 20 steps. Results and analysis are in [docs/experiments.md](../../docs/experiments.md). The code for the reported full run is at tag [`dabstep-full1`](https://github.com/smithclay/codemode-git/tree/dabstep-full1).

## Prerequisites

- Node 22+ and Python 3.
- A Cloudflare account on Workers Paid, with Artifacts, Workers AI and Vectorize.
- The `cf` CLI, logged in (`npx cf login`).
- `npm install` at the repo root. The harness is a workspace and uses the local `@smithclay/codemode-git`.

All commands below run from `benchmarks/dabstep`.

## 1. Download the data

```bash
scripts/fetch.sh
```

This fetches the context files (payments, fees, merchant data, the manual), the `dev` and `all` task splits, and Adyen's official scorer into `data/`, which is gitignored. The DABstep data is CC BY 4.0. Only the 10 `dev` tasks have public answers; the 450 in `all` are scored by the leaderboard.

## 2. Load the context into D1

Build one SQL file from the context. Tables keep the original file and column names, so the manual's terms map onto them.

```bash
python3 scripts/build_sql.py > data/load.sql
```

Create a database and put its id in `cloudflare.config.ts` (`DB: bindings.d1({ name: "dabstep", id: "…" })`). The id in the repo is the original author's database.

```bash
npx cf d1 create dabstep
```

Then load the SQL (about 25 MB). With `cf`, apply it as a single migration:

```bash
mkdir -p data/sql && cp data/load.sql data/sql/0001_dabstep.sql
npx cf d1 migrations apply <database-id> --dir data/sql
```

> This step wasn't re-run for this README; the original database was loaded earlier. If the migration hits a size limit, use D1's bulk import instead: add the database to a minimal Wrangler config (`d1_databases`) and run `npx wrangler d1 execute dabstep --remote --file data/load.sql`.

## 3. Create the other resources

- **Artifacts namespace** (one repo per agent):

  ```bash
  npx cf artifacts namespaces create --namespace codemode-git
  ```

- **Vectorize index** `codemode-git-examples` (1024 dimensions, cosine), with metadata indexes on `scope`, `ok` and `task`. The commands are in the [root README](../../README.md#examples-learning-from-other-agents-runs-optional). The examples arm needs the metadata indexes; without them, filtered queries return nothing.

## 4. Start the harness Worker

**Locally,** with remote bindings for D1, Artifacts, Workers AI and Vectorize:

```bash
npx cf dev --port 8790
```

**Or deployed.** Every request to a deployed Worker needs `HARNESS_TOKEN` as a bearer token, and the Worker rejects everything without it. Set it at deploy time so it's never open:

```bash
echo '{"HARNESS_TOKEN": "<a long random string>"}' > data/secrets.json
npx cf deploy --secrets-file data/secrets.json
```

Before spending on model calls, run the self-test. It checks the Code Mode runtime against real D1 and does an examples round trip through Vectorize, with no chat-model calls:

```bash
curl -X POST localhost:8790/selftest
```

## 5. Run the tasks

`scripts/run.mjs` sends tasks to `POST /solve`, one fresh agent per task, and appends results to `results/<run>-<arm>.jsonl`, which is gitignored. It's resumable: finished tasks are skipped on a rerun. A dropped connection reconnects to the same agent, which rejoins its run. Other infrastructure failures retry the task with a fresh agent, up to 3 attempts, so failures don't bias results toward easy tasks. Pass `--url` and set `HARNESS_TOKEN` in the environment for a deployed Worker.

Start with a smoke test on the graded dev tasks:

```bash
node scripts/run.mjs --run smoke --arm baseline --split dev --limit 5 --url http://localhost:8790
```

The full run (`full1`) used all 450 tasks, both arms side by side in two terminals, with rolling concurrency 8:

```bash
node scripts/run.mjs --run full1 --arm baseline --split all --concurrency 8 --rolling --url <worker-url>
node scripts/run.mjs --run full1 --arm codemode-git-examples --split all --concurrency 8 --rolling --url <worker-url>
```

- **Time and cost:** each arm took about 8.5 hours of wall time. Workers AI spend was $26.76 for both arms, including retries.
- **Spend guard:** `--budget-tokens` (default 175M) stops launching new tasks once finished tasks have used that many tokens.
- **Task order matters for the examples arm,** since agents learn only from earlier runs. `data/tasks/all.jsonl` is used in its published order.
- **Without `--rolling`,** tasks go out in waves, and the examples arm waits `--settle` seconds (default 120) between waves. Vectorize metadata filters see new vectors only after about 1–2 minutes.
- **Other flags:** `--model`, `--max-steps` and `--tasks <ids>`.

## 6. Score

```bash
python3 scripts/score.py results/full1-baseline.jsonl results/full1-codemode-git-examples.jsonl
```

This scores the `dev` tasks with the official scorer, and writes `<file>.submission.jsonl` (`{task_id, agent_answer}`) for the [DABstep leaderboard](https://huggingface.co/spaces/adyen/DABstep). Accuracy on all 450 tasks comes from submitting there. The leaderboard publishes per-task scores in the dataset under `data/task_scores/`.

## 7. Analyze

- **Paired comparison:** accuracy (with McNemar counts), step-limit exhaustion, code runs, tokens and time, plus a learning curve by position in the run:

  ```bash
  python3 scripts/compare.py results/full1-baseline.jsonl results/full1-codemode-git-examples.jsonl --slice all
  ```

- **Learning curve from the official per-task scores:** download your two `data/task_scores/` files from the dataset and save them as `Baseline.jsonl` and `with_Examples.jsonl` in one directory, then:

  ```bash
  python3 scripts/learning_curve.py <that-directory>
  ```

## Smaller experiments

DABstep's 450 tasks come from about 113 question templates, so retrieval has related runs to find. For cheaper A/B runs:

- `scripts/make_slice.py --name ab25 --sample 15` samples test-split tasks (ungraded material to learn from), followed by every dev task (graded).
- `scripts/make_template_slice.py` concentrates on the templates of chosen dev tasks, where learning across agents has the best chance to apply.

Both write `data/tasks/<name>.jsonl`. Run a slice with `--split <name>`, and compare with `--slice <name>`. The experiments log in [docs/experiments.md](../../docs/experiments.md) records the slices used (`ab25`, `tpl36`) and what they showed.

## Tests

```bash
npm test --workspace benchmarks/dabstep
```

These are unit tests for the agent loop's tool-call parsing and result clipping.

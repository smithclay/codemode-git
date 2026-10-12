# Competition submission: draft answers

Form: [cloudflare.com/git-competition/submit](https://www.cloudflare.com/git-competition/submit). Closes Oct 14, 2026, 11:59 PM PDT. Entrants must be legal residents of the US or Canada, and 18 or older.

## Your team

Fill in on the form: team name, primary contact, location, and up to two attendees for Connect (Oct 21, San Francisco).

## Project name

codemode-git

## Project vision

Self-improving Code Mode agents, with git as their memory.

Code Mode lets a model write code against its tools, which makes agents good at investigations. But every investigation is thrown away when the run ends, so each new agent starts from zero. codemode-git makes that layer durable, then learns from it.

**Phase 1, durable:** every Code Mode execution becomes a commit on the agent's own Cloudflare Artifacts repo: the code, every tool call with its result, and the outcome. Each agent is the only writer to its repo, so thousands can run at once without locks or merges. Agents read their history back through tools, and people can `git clone` it. GitHub here is headless: git is the memory layer, not a UI.

**Phase 2, learning:** each answer-producing run is embedded into Vectorize. A new agent starts with the closest runs other agents committed, shown as unverified examples, and a commit trailer records which memories each run used.

On all 450 tasks of Adyen's DABstep benchmark, with the same model and prompt, scored by Adyen's official scorer:
- **Accuracy:** 32.2% → 46.2% overall, and 23.5% → 38.6% on hard tasks.
- **Cost:** after a cold start of about 25 tasks, median tokens per task held at about a third of baseline.

We also found that distilled, verified "skills" made agents wrong together, while raw, unverified runs worked.

## How you used Cloudflare

- **Artifacts:** one repo per agent, created from the Workers binding, written with short-lived repo-scoped write tokens and isomorphic-git running inside the Worker. Anyone can clone with plain `git`.
- **Durable Objects (SQLite):** one per agent. Each is the only writer to its repo, and holds a durable outbox that makes commits idempotent, ordered and crash-safe.
- **Workers + Worker Loader:** Code Mode runs model-written code in sandboxed Dynamic Workers. Our connector hooks the end of every execution.
- **Workers AI:** `glm-5.3-flash` drives the agents, and `@cf/qwen/qwen3-embedding-0.6b` embeds runs.
- **Vectorize:** cross-agent retrieval of other agents' runs, with metadata filters on scope, task and outcome.
- **cf CLI:** project config is `cloudflare.config.ts`, and CI runs `cf build` plus a credential-free `cf deploy --dry-run`.
- **Deploy to Cloudflare button (Workers Builds):** one-click deploy of the example agent.

## Open source repository URL

https://github.com/smithclay/codemode-git (MIT)

## Instructions to run your project

Use it in your own Code Mode agent:

```
npm install @smithclay/codemode-git @cloudflare/codemode
```

Then add `GitHistoryConnector` to your connectors (three lines; see the README).

Run the example agent:
1. Use the Deploy to Cloudflare button in the README, or `npm install` then `cd examples/agent && npx cf dev`.
2. Create the Artifacts namespace first: `npx cf artifacts namespaces create --namespace codemode-git`.
3. `POST /agents/<name>/execute` with Code Mode code. `GET /agents/<name>/commits` returns the commit sha.
4. Clone the agent's repo with a read token and run `git log -p run.js`.
5. Concurrency burst: `node examples/agent/scripts/swarm.mjs <worker-url> --agents 1000`.

The DABstep benchmark harness and its results are in `benchmarks/dabstep` and `docs/experiments.md`.

## Confirmations

- Built with Cloudflare Workers and Artifacts: yes.
- Follows the competition terms: yes. The repo is MIT-licensed with a LICENSE file. The DABstep data is downloaded by a script, not committed.

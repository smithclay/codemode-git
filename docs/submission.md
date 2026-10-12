# Competition submission: draft answers

Form: [cloudflare.com/git-competition/submit](https://www.cloudflare.com/git-competition/submit). Closes Oct 14, 2026, 11:59 PM PDT. Entrants must be legal residents of the US or Canada, and 18 or older.

## Your team

Fill in on the form: team name, primary contact, location, and up to two attendees for Connect (Oct 21, San Francisco).

## Project name

codemode-git

## Project vision

The next GitHub has no merge button. When thousands of agents work at once, branches, merge conflicts and review queues are the bottleneck. codemode-git gives every Code Mode agent its own Cloudflare Artifacts repo, and every execution becomes a commit: the code, every tool call and the result. Agents never write to a shared repo, so there's nothing to lock or merge.

Agents collaborate by reading instead of merging. Each answer-producing run is embedded into Vectorize. The next agent starts with the closest commits other agents made, shown as unverified examples, and a trailer records which commits influenced which. The result is a provenance graph in plain git.

We tested it on all 450 tasks of Adyen's DABstep benchmark, with the same model and prompt, scored by Adyen's official scorer:
- **Accuracy:** 32.2% → 46.2% overall, and 23.5% → 38.6% on hard tasks.
- **Cost:** median tokens per task fell by about two thirds.

We also built, measured and removed the GitHub-style alternative: a replay-verified shared skill library. It made agents wrong together.

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

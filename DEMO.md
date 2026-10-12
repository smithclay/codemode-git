# Demo video: draft script

**Due:** Oct 14, 2026, 11:59 PM PDT. The video must be 5–10 min, in MP4, WebM or MOV, under 2 GiB. Target **8:00** so there's room to spare. Form answers are drafted in [docs/submission.md](docs/submission.md).

**Thesis, in one line:** the next GitHub has no merge button. Each agent writes only its own repo, and agents collaborate by *reading* each other's commits instead of merging them.

## What the judges score, and where the video covers it

| Criterion (1–5 each) | Weight | Where it lands |
|---|---|---|
| Originality and quality of the prototype for agent-oriented software collaboration | 50% | Hook, both primitives, the review story, results. About half the runtime |
| Concurrency, coordination, context preservation, review, conflict handling | 25% | Swarm burst (concurrency), `git log -p` (context), provenance trailers (coordination), curator lesson (review), single writer per repo (conflicts) |
| Ease of use and product experience | 25% | Three-line integration, `npm install`, Deploy button, `git clone` with plain git |

## Presentation principles (from the research)

- **Speak Cloudflare's Artifacts vocabulary.** Their launch post says "Agents know Git", and their guidance is one repo per unit of autonomous work. Use that framing and show a plain `git clone` of an agent's repo on screen.
- **Never show a PR or a merge UI.** Cloudflare said it doesn't want "GitHub as it exists today with agents added on top". Every on-screen artifact should be a commit, a trailer, or a retrieval.
- **Show the whole platform at work.** The 2024 Cloudflare AI Challenge winner was praised for using a wide range of Cloudflare products. We use eight; show them on one architecture slide rather than listing them aloud.
- **Show quality control, not just output.** Judges in that challenge also rewarded checking a model's output. Our review story (verified shared skills made agents wrong together) is a real, measured finding. Treat it as a feature of the design, not an apology.
- **Lead with one hard number.** On Adyen's official scorer, same model and prompt: 32.2% → 46.2% overall, 23.5% → 38.6% on hard tasks.
- **Make it work as a 10-minute live talk too.** Finalists present on stage at Connect (Oct 21). Keep every beat runnable live from a terminal, with recordings as a backup.

## Run of show (~8:00)

| Time | Beat | On screen | Voiceover (draft) |
|---|---|---|---|
| 0:00–0:35 | **Hook** | Title card, then the accuracy number | "Same model. Same prompt. On a 450-task agent benchmark, accuracy went from 32 to 46 percent. The only change: agents could read each other's git history. This is codemode-git." |
| 0:35–1:20 | **Problem** | One slide: a branch/PR/merge graph struck through, then one repo per agent | "GitHub's primitives assume a few writers and human reviewers. Branches, merge conflicts and review queues don't survive thousands of agents. Cloudflare's answer for storage is one repo per agent. So the question becomes: if every agent has its own repo, how do they work together?" |
| 1:20–2:35 | **Primitive 1: every execution is a commit** | The three-line diff in a stock Code Mode agent. A `curl` execute call. Then `git clone` and `git log -p run.js`, with the `Codemode-*` trailers highlighted | "Add one connector to a Code Mode agent. Every run becomes a commit on that agent's own Artifacts repo: the code it ran, every tool call and the result. Clone it with plain git, and `git log -p` is the agent's trajectory. Agents also get `history.log` and `history.show`, so they can look back further than the runtime remembers." |
| 2:35–3:35 | **Concurrency** | Terminal running `scripts/swarm.mjs`, then the summary JSON. Artifacts dashboard metrics | "Here are [1,000] agents at once: [1,000] Durable Objects, [1,000] repos, [N] commits a second, zero conflicts. Each agent is the only writer to its own repo, so there's nothing to lock and nothing to merge." |
| 3:35–5:05 | **Primitive 2: collaboration by retrieval** | Diagram: push → embed question + code → Vectorize. New agent → 3 closest commits from *other* tasks → shown as unverified examples. A real DABstep commit with a `Codemode-Examples:` trailer, then `git show` of the referenced commit in another agent's repo | "When an agent produces an answer, that run is embedded. The next agent starts with the three closest runs other agents committed, labeled as unverified. Every example is a `repo@sha`, and the trailer records which commits influenced which. Instead of a merge graph, you get a provenance graph, and it's all in git." |
| 5:05–6:05 | **Review: what we tried and removed** | Two-column slide: "verified skill library (PR-style gate)" vs "unverified examples". The fee-454 example | "We first built the GitHub answer: a curator that mined agents' runs into a shared skill library, verified by replay before merging. It certified reproducibility, not correctness. One wrong skill passed, and later agents copied it and got the same answer wrong. A shared, merged library makes errors correlated. So we removed it. Review at agent scale is provenance, plus each agent re-running the code itself." |
| 6:05–7:05 | **Results** | Chart: accuracy by level (easy, hard, overall). Small table: median tokens 191k → 61k, code runs 13.8 → 9.4, step-limit exhaustion 13% → 7%, Workers AI spend $26.76 | "Scored by Adyen's official DABstep scorer: hard tasks from 23.5 to 38.6 percent, with a third of the median tokens. Agents still wrote and ran their own code, just much less of it. Caveats: one run per arm, and the examples come from earlier runs in the same pass, with no answers or labels." |
| 7:05–8:00 | **Ease of use and close** | `npm install @smithclay/codemode-git`, the Deploy to Cloudflare button, the architecture slide with all eight products. Then the closing line | "It's a package on npm, three lines in your agent, and a Deploy to Cloudflare button. Next: push events from Artifacts to index runs as they land, and git-notes for provenance. The next GitHub has no merge button. Agents just commit, and learn from each other's history." |

## Assets to capture

- [ ] **Three-line diff:** the stock Code Mode example with the connector added, from the README.
- [ ] **Live execute → commit:** `cf dev` or the deployed Worker, a `curl` execute, then `GET /commits` showing the sha.
- [ ] **`git clone` an agent repo with a read token,** then `git log --format='%h %s [%(trailers:key=Codemode-Status,valueonly)]'` and `git log -p run.js`.
- [ ] **Swarm burst:** run against the deployed example. Record both the terminal and the Artifacts dashboard. Fill in the bracketed numbers in the script.
- [ ] **Provenance hop:** a DABstep examples-arm commit with `Codemode-Examples:`, then `git show` of the referenced commit in another agent's repo.
- [ ] **Charts:** accuracy by level, plus a tokens/code-runs table, from [docs/experiments.md](docs/experiments.md).
- [ ] **Architecture slide:** Workers, Durable Objects (SQLite), Artifacts, Worker Loader, Workers AI, Vectorize, the cf CLI, and Workers Builds through the Deploy button.
- [ ] **The Deploy to Cloudflare button working end to end,** after a clean retry.

## Swarm burst

```bash
cd examples/agent
ADMIN_TOKEN=... node scripts/swarm.mjs https://codemode-git-example.<subdomain>.workers.dev --agents 1000 --concurrency 200
```

Each agent is `agent-swarm-<run>-<i>`: one Durable Object, one repo and one commit. The script prints repos with a commit, errors, wall time, commits per second, and p50/p95 for execute, push and total. Run it before Oct 15, when Artifacts billing starts. Start with `--agents 50` to check the setup.

## Pre-flight

- [ ] Deployed example on a fresh Artifacts namespace, with `ADMIN_TOKEN` set.
- [ ] Swarm at 50 agents, then 1,000. Note any rate limits or push errors.
- [ ] Rehearse once against the clock, aiming for 7:30–8:30.
- [ ] Export to MP4 under 2 GiB, then submit at [cloudflare.com/git-competition/submit](https://www.cloudflare.com/git-competition/submit).

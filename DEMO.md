# Demo video: draft script

**Due:** Oct 14, 2026, 11:59 PM PDT. The video must be 5–10 min, in MP4, WebM or MOV, under 2 GiB. Target **8:00** so there's room to spare. Form answers are drafted in [docs/submission.md](docs/submission.md).

**Thesis:** self-improving Code Mode agents, with git as their memory.
- Code Mode is great for investigations: the model writes code that calls tools and works through the data.
- **Phase 1 (durable):** every Code Mode execution becomes a commit, so an investigation is no longer thrown away when the run ends.
- **Phase 2 (learning):** agents read that memory, their own and other agents', and get better over time.
- GitHub here is headless: no UI, no humans in the loop. Git is the storage and retrieval layer for agent experience.

**What we're not pitching:** a reimagined GitHub experience, with branches, PRs or merge UIs for agents. Many entries will do that. The git layer here is infrastructure the agents use, not a product humans browse.

## What the judges score, and where the video covers it

| Criterion (1–5 each) | Weight | Where it lands |
|---|---|---|
| Originality and quality of the prototype for agent-oriented software collaboration | 50% | Agents that improve by reading each other's committed work: the learning curve, the official benchmark result, and what kind of memory works (raw runs, not distilled skills) |
| Concurrency, coordination, context preservation, review, conflict handling | 25% | Context preservation is the whole of Phase 1. Concurrency: the swarm burst, with one writer per repo and no conflicts. Coordination: retrieval plus provenance trailers. Review: memory is shown as unverified, and every example links to its source commit |
| Ease of use and product experience | 25% | Three lines in an existing Code Mode agent, `npm install`, the Deploy button, plain `git clone` |

## Presentation principles

- **Lead with the curve, not the platform.** The memorable image is agents getting cheaper and better as memory accumulates. Cloudflare products serve that story.
- **Use Cloudflare's own framing where it helps.** "Agents know Git" and one repo per agent are both from their Artifacts launch post. We use those repos as memory, and nobody has to look at them.
- **Show the whole platform once, on one architecture slide.** The 2024 Cloudflare AI Challenge winner was praised for using a wide range of Cloudflare products. We use eight.
- **Show the quality-control finding.** We tested two kinds of memory. Distilled, verified skills made agents wrong together. Raw runs shown as unverified worked. That's a real, measured insight about agent memory.
- **Make it work as a 10-minute live talk too.** Finalists present at Connect (Oct 21). Keep every beat runnable live, with recordings as a backup.

## Run of show (~8:00)

| Time | Beat | On screen | Voiceover (draft) |
|---|---|---|---|
| 0:00–0:40 | **Hook** | The learning curve: median tokens per task across the run, baseline flat, memory arm dropping within the first few dozen tasks | "These agents get better as they work. For the first eight tasks, both arms cost the same. Once agents could read each other's past investigations, median cost per task fell to about a third and stayed there. Accuracy went from 32 to 46 percent on Adyen's official scorer. Same model, same prompt. The difference is memory, and the memory is git." |
| 0:40–1:30 | **Why Code Mode needs memory** | A Code Mode run: the model writes code, it calls tools, the result comes back, and the code is discarded | "Code Mode lets a model write code against your tools instead of making one tool call at a time. It's great for investigations. But each investigation is thrown away when the run ends. The next agent with the same question starts from zero. Every agent is on day one, forever." |
| 1:30–2:50 | **Phase 1: durable Code Mode** | The three-line diff. A `curl` execute call. Then `git clone` an agent's repo and `git log -p run.js`, with the `Codemode-*` trailers highlighted | "Add one connector. Every execution becomes a commit on that agent's own Artifacts repo: the code it ran, every tool call with its result, and the outcome. That's a durable, inspectable record of what the agent tried. Agents can read it back with `history.log` and `history.show`, and you can `git clone` it with plain git. Nobody has to open a GitHub UI. Git is the storage." |
| 2:50–3:40 | **Memory at fleet scale** | Terminal running `scripts/swarm.mjs`, then the summary JSON. Artifacts dashboard metrics | "Here are [1,000] agents at once: [1,000] Durable Objects, each writing its own memory to its own repo, [N] commits a second, zero conflicts. Each agent is the only writer to its repo, so there's nothing to lock and nothing to merge." |
| 3:40–5:10 | **Phase 2: learning from memory** | Diagram: commit → embed question + code → Vectorize. New agent → 3 closest runs from *other* tasks → prompt, as unverified examples. Then a real commit with a `Codemode-Examples:` trailer, and `git show` of the referenced commit in another agent's repo | "When an agent's run produces an answer, that run is embedded. A new agent starts with the three closest runs other agents committed, labeled unverified. It still writes and runs its own code, just much less of it. Every example is a `repo@sha`, and the trailer records exactly which memories each run used." |
| 5:10–6:10 | **What kind of memory works** | Two columns: "distilled skills (verified, shared)" vs "raw runs (unverified, per agent)". The fee-454 example | "Our first design distilled runs into a shared library of verified skills. It sounds better, but it made agents wrong together. One skill passed verification by reproducing two wrong runs, and later agents copied it and got the same answer wrong. Consolidated memory spreads errors. So we kept the raw, episodic record: real runs, clearly labeled, with a link back to the source." |
| 6:10–7:10 | **Results** | Accuracy by level (easy, hard, overall). Learning-curve table. Small table: code runs 13.8 → 9.4, step-limit exhaustion 13% → 7%, Workers AI spend $26.76 | "All 450 DABstep tasks, scored by Adyen: hard tasks from 23.5 to 38.6 percent. Agents ran out of steps half as often and needed a third fewer code runs. Caveats: one run per arm, and memory comes from earlier runs in the same pass, with no answers or labels." |
| 7:10–8:00 | **Use it, and what's next** | `npm install @smithclay/codemode-git`, the Deploy button, the architecture slide with all eight products. Closing line | "It's a package on npm, three lines in a Code Mode agent, and a Deploy to Cloudflare button. Next: index runs as they're pushed, using Artifacts events; record outcomes as git-notes; and let agents mine their own history between tasks. Code Mode made agents good at investigating. Git makes them remember, and that's how they get better." |

## Assets to capture

- [ ] **Learning curve chart:** median tokens per task by run position, both arms. See "Learning curve" in [docs/experiments.md](docs/experiments.md).
- [ ] **Three-line diff:** the stock Code Mode example with the connector added, from the README.
- [ ] **Live execute → commit:** a `curl` execute, then `GET /commits` showing the sha.
- [ ] **`git clone` an agent repo with a read token,** then `git log -p run.js`.
- [ ] **Swarm burst:** run against the deployed example. Record both the terminal and the Artifacts dashboard. Fill in the bracketed numbers in the script.
- [ ] **Provenance hop:** a DABstep examples-arm commit with `Codemode-Examples:`, then `git show` of the referenced commit in another agent's repo.
- [ ] **Accuracy chart:** accuracy by level, from [docs/experiments.md](docs/experiments.md).
- [ ] **Architecture slide:** Workers, Durable Objects (SQLite), Artifacts, Worker Loader, Workers AI, Vectorize, the cf CLI, and Workers Builds through the Deploy button.

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

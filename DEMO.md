# Demo video: draft script

**Due:** Oct 14, 2026, 11:59 PM PDT. The video must be 5–10 min, in MP4, WebM or MOV, under 2 GiB. Target **8:00** so there's room to spare. Form answers are drafted in [docs/submission.md](docs/submission.md).

## The one-two punch

1. **Code Mode (Cloudflare's insight).** Models are better at writing code than at calling tools one at a time. In Code Mode the agent writes one function that chains tool calls, and Cloudflare calls that code "a compact plan" ([Code Mode MCP post](https://blog.cloudflare.com/code-mode-mcp/)). Each snippet runs in a fresh isolate, which is then thrown away ([Dynamic Workers post](https://blog.cloudflare.com/dynamic-workers/)).
2. **Code memory (ours).** If the code is the plan, then the code an agent writes over time is its experience, and today it's thrown away with the isolate. We keep it:
   - **Phase 1, durable:** every Code Mode execution is saved to the agent's own Cloudflare Artifacts repo.
   - **Phase 2, learning:** Workers AI embeddings and Vectorize let the next agent start from the closest code other agents already ran. That measurably improves agent outcomes.

**Tagline:** throw away the isolate, keep the code.

**Vocabulary:** say "Cloudflare Artifacts" and "code memory", not "git". Artifacts speaks Git, so mention once that any git client can read it, and move on. We are not pitching a reimagined GitHub.

## What the judges score, and where the video covers it

| Criterion (1–5 each) | Weight | Where it lands |
|---|---|---|
| Originality and quality of the prototype for agent-oriented software collaboration | 50% | Code memory as the next step after Code Mode. The michelle→matthew walkthrough. The learning curve and official benchmark result. Which memory works |
| Concurrency, coordination, context preservation, review, conflict handling | 25% | Context preservation is Phase 1. Concurrency: the swarm, with one writer per Artifacts repo and no conflicts. Coordination: retrieval plus provenance. Review: memory is shown as unverified, and every example links to its source |
| Ease of use and product experience | 25% | Three lines in an existing Code Mode agent, `npm install`, the Deploy button |

## Run of show (~8:00)

| Time | Beat | On screen | Voiceover (draft) |
|---|---|---|---|
| 0:00–0:30 | **Cold open** | Cloudflare's lava lamp wall (LavaRand), then split screen. Agent michelle: "How many lava lamps on the wall are flowing right now?", taking [N] executions to work out that the wall is paginated. Agent matthew: "How many red lava lamps are flowing?", taking one execution | "Cloudflare's lobby has a wall of about a hundred lava lamps, and a camera turns the moving wax into randomness for encryption. Here are two Code Mode agents checking on that wall, with two similar questions. The first one figures it out the hard way. The second gets it right the first time, because it can read the code the first one wrote. This is codemode-git: code memory for Code Mode agents, on Cloudflare Artifacts." |
| 0:30–1:30 | **Punch 1: why Code Mode** | Left: the same task as a chain of individual tool calls, each result going back through the model. Right: one function that walks every page of `lamps.wall` and returns a number | "Cloudflare's Code Mode insight: models are much better at writing code than at calling tools one at a time. They've seen millions of real programs. So instead of ten tool calls, the agent writes one function: loop over every page of the wall, filter, count, return. Cloudflare calls that code a compact plan." |
| 1:30–2:00 | **The gap** | The isolate lifecycle: load → run → discard. The code fades out with it | "Each plan runs in a fresh isolate that's thrown away afterward, which is exactly right for the sandbox. But the plan goes too. The next agent with the same kind of question starts from zero." |
| 2:00–3:15 | **Punch 2, Phase 1: code memory on Artifacts** | The three-line diff. michelle's Artifacts repo: `run.js`, `calls.jsonl`, `result.json`, with the `Codemode-*` trailers in the commit message. One shot of `git clone` | "Add one connector. Every execution is saved to that agent's own Cloudflare Artifacts repo: the code it ran, every tool call with its result, and the outcome. Artifacts gives every agent its own repo, at any scale. It speaks Git, so any git client can read it, but nobody has to. Agents read their own history back with two tools." |
| 3:15–3:45 | **Memory at fleet scale** | `scripts/swarm.mjs` summary. Artifacts dashboard metrics | "[1,000] agents at once: [1,000] Durable Objects, each writing to its own Artifacts repo, [N] runs saved per second, zero conflicts. Each agent is the only writer to its repo, so there's nothing to lock and nothing to merge." |
| 3:45–5:00 | **Phase 2: learning from code memory** | Diagram: saved run → Workers AI embedding of question + code → Vectorize. matthew's question → nearest runs → prompt, labeled unverified. matthew's commit with `Codemode-Examples: agent-michelle@<sha>`, then michelle's run it points to | "When a run produces an answer, Workers AI embeds the question and the code into Vectorize. matthew's question is similar to michelle's, so matthew starts with michelle's code, labeled unverified. matthew still writes and runs its own code, but already knows the wall is paginated. Its saved run records exactly which memory it used, so every answer traces back to the code that informed it." |
| 5:00–6:50 | **Deep dive: the benchmark** | DABstep: 450 payments-analysis tasks from Adyen. Learning-curve chart. Official accuracy by level. Small table: code runs 13.8 → 9.4, step-limit exhaustion 13% → 7%, Workers AI spend $26.76. Then a two-column slide: distilled skills vs raw runs | "Does it hold up on real investigations? DABstep is 450 data-analysis tasks over Adyen's payments data, the kind of work Code Mode is built for. Same model, same prompt, scored by Adyen's official scorer. Accuracy goes from 32 to 46 percent, and from 23.5 to 38.6 on hard tasks. The curve shows the learning. For the first eight tasks there's no memory, and both arms cost the same. Within about 25 tasks, the memory arm's median cost falls to about a third of baseline and stays there. One more finding: we first distilled runs into verified, shared skills. That made agents wrong together, because one bad skill spread. Raw runs, labeled unverified, worked better." |
| 6:50–8:00 | **Use it, what's next, close** | `npm install @smithclay/codemode-git`, the three lines, the Deploy to Cloudflare button. An architecture slide: Workers, Worker Loader, Durable Objects, Artifacts, Workers AI, Vectorize, cf CLI, Workers Builds. Closing line | "It's on npm. It's three lines in a Code Mode agent, plus a Deploy to Cloudflare button. Next: index runs as they're pushed, using Artifacts events, and record outcomes alongside the code. Code Mode made code the way agents act. Artifacts makes it the way they remember. Throw away the isolate. Keep the code." |

## The walkthrough (michelle → matthew)

This uses the example's `lamps` connector, a deterministic stand-in for Cloudflare's lobby wall: 10 rows of 10 lava lamps. Each lamp has a wax color (7 colors), a status (`flowing`, `warming` or `off`) and hours on. `lamps.wall()` returns 12 lamps per page plus `nextCursor`, and filters by row, wax or status.

1. **michelle** asks "How many lava lamps on the wall are flowing right now?" (answer: **67**, across 6 pages) with an empty memory. It writes Code Mode code, may stop at the first page, notices `nextCursor`, and loops. Each attempt is a saved run in `agent-michelle`. Record its executions and tokens.
2. michelle's answer-producing run is embedded into Vectorize.
3. **matthew** asks "How many red lava lamps are flowing?" (answer: **10**: 15 red lamps across 2 pages). It retrieves michelle's run as an unverified example and writes the paginated loop on its first try. Its saved run carries `Codemode-Examples: agent-michelle@<sha>`. Record its executions and tokens.
4. **On screen:** both runs side by side, with executions and tokens per agent.

**Needs:** the example agent can currently only run code it's handed. The walkthrough needs a small model loop in the example, `POST /agents/:name/ask`, plus Workers AI and Vectorize bindings. It would be a trimmed port of the benchmark's loop in `benchmarks/dabstep/src/solver.ts`. Not built yet.

## Assets to capture

- [ ] **michelle → matthew walkthrough:** both runs, with executions and tokens. Needs the `ask` endpoint.
- [ ] **Code Mode contrast:** tool-call-by-tool-call vs one function. A static slide is fine.
- [ ] **Lava lamp wall photo or b-roll** for the cold open: Cloudflare press assets, or footage we have the rights to.
- [ ] **Three-line diff,** from the README.
- [ ] **michelle's Artifacts repo:** files and trailers, plus one `git clone`.
- [ ] **Swarm burst:** run against the deployed example. Record both the terminal and the Artifacts dashboard. Fill in the bracketed numbers.
- [ ] **Learning curve and accuracy charts,** from [docs/experiments.md](docs/experiments.md).
- [ ] **Architecture slide** with all eight products.

## Swarm burst

```bash
cd examples/agent
ADMIN_TOKEN=... node scripts/swarm.mjs https://codemode-git-example.<subdomain>.workers.dev --agents 1000 --concurrency 200
```

Each agent is `agent-swarm-<run>-<i>`: one Durable Object, one Artifacts repo and one saved run. The script prints repos with a run, errors, wall time, runs per second, and p50/p95 for execute, push and total. Run it before Oct 15, when Artifacts billing starts. Start with `--agents 50` to check the setup.

## Pre-flight

- [ ] Deployed example on a fresh Artifacts namespace, with `ADMIN_TOKEN` set.
- [ ] Swarm at 50 agents, then 1,000.
- [ ] Rehearse once against the clock, aiming for 7:30–8:30.
- [ ] Export to MP4 under 2 GiB, then submit at [cloudflare.com/git-competition/submit](https://www.cloudflare.com/git-competition/submit).

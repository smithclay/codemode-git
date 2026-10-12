# Demo video: draft script

**Due:** Oct 14, 2026, 11:59 PM PDT. The video must be 5–10 min, in MP4, WebM or MOV, under 2 GiB. Currently **~5:15**: the rules require 5–10 min. Form answers are drafted in [docs/submission.md](docs/submission.md).

## The one-two punch

**Thesis (the opening line):** what if Cloudflare Artifacts could make Code Mode self-improving?


1. **Code Mode (Cloudflare's insight).** Models are better at writing code than at calling tools one at a time. In Code Mode the agent writes one function that chains tool calls, and Cloudflare calls that code "a compact plan" ([Code Mode MCP post](https://blog.cloudflare.com/code-mode-mcp/)). Each snippet runs in a fresh isolate, which is then thrown away ([Dynamic Workers post](https://blog.cloudflare.com/dynamic-workers/)).
2. **Code memory (ours).** If the code is the plan, then the code an agent writes over time is its experience, and today it's thrown away with the isolate. We keep it:
   - **Phase 1, durable:** every Code Mode execution is saved to the agent's own Cloudflare Artifacts repo.
   - **Phase 2, learning:** Workers AI embeddings and Vectorize let the next agent start from the closest code other agents already ran. That measurably improves agent outcomes.

**Title:** Self-Improving Code Mode Workers, with Artifacts Memory. The package stays `codemode-git`.

**Tagline:** keep the code, and your Workers get smarter over time.

**Vocabulary:** say "Cloudflare Artifacts" and "code memory", not "git". Artifacts speaks Git, so mention once that any git client can read it, and move on. We are not pitching a reimagined GitHub.

## What the judges score, and where the video covers it

| Criterion (1–5 each) | Weight | Where it lands |
|---|---|---|
| Originality and quality of the prototype for agent-oriented software collaboration | 50% | Code memory as the next step after Code Mode. The michelle→matthew walkthrough. The learning curve and official benchmark result. Which memory works |
| Concurrency, coordination, context preservation, review, conflict handling | 25% | Context preservation is Phase 1. Concurrency: the swarm, with one writer per Artifacts repo and no conflicts. Coordination: retrieval plus provenance. Review: memory is shown as unverified, and every example links to its source |
| Ease of use and product experience | 25% | Three lines in an existing Code Mode agent, `npm install`, the Deploy button |

## Run of show (~5:15)

The video is code: [demo/video](demo/video). [transcript.md](demo/video/transcript.md) holds every voiceover line, so treat it as the source of truth for the narration. Edit it and run `npm run voiceover`.

**Style:** a keynote talk, not a slide deck. Each scene is one idea, shown as an animated diagram, often a before and after. On-screen text is a few words at most, the voiceover carries the detail, and animations are timed to the spoken word. Keep the technical depth (outbox, isomorphic-git, embeddings), because the audience is technical.

| # | Scene | Diagram | Point |
|---|---|---|---|
| 1 | **Thesis** | "What if Cloudflare Artifacts could make Code Mode self-improving?", built phrase by phrase, then the name | The hook is the thesis |
| 2 | **We tried it** | 32.2% → 46.2% counter. "Hard tasks: 23.5% → 38.6%". "+ memory" | The result, as proof of the thesis: same model, same prompt |
| 3 | **Every agent starts from zero** | A grid of agents, each writing code that dissolves | The problem |
| 4 | **Code Mode** | Before: model ⇄ tools ping-pong. After: one program in an isolate | Brief context; the code is the plan |
| 5 | **The gap** | The isolate collapses, and the code falls away | The plan is thrown away |
| 6 | **Phase 1: code memory** | Agents → their own Artifacts repos, with commits stacking up | 1 repo per agent, 1 writer per repo, 0 merges |
| 7 | **Under the hood** | execution ends → Durable Object SQLite outbox → isomorphic-git → Artifacts | How the write path works |
| 8 | **Every attempt, in git** (≥30s) | `git log` of an agent: error, fix, answer | Slot for a VHS recording |
| 9 | **One repo per agent** (≥25s) | 1,000 squares lighting up | Slot for the swarm recording |
| 10 | **Phase 2: learning** | michelle's repo → Workers AI → Vectorize → matthew. A provenance arrow back | Retrieval and `Codemode-Examples` |
| 11 | **Lava lamp wall** (≥60s) | michelle and matthew lanes: runs ✓/✗ and token bars | Slot for the real `walkthrough.mjs` run |
| 12 | **Learning curve** | Median tokens by run position, baseline vs memory | Cold start, then about a third |
| 13 | **Accuracy** | Overall 32.2 → 46.2, hard 23.5 → 38.6 | Right more often, not just cheaper |
| 14 | **Which memory works** | A shared skill hub spreading red to every agent, vs independent raw runs | The skills finding |
| 15 | **Close** | `npm install`, three lines of code, the tagline over the lava wall | Use it |

**Recording slots:** scenes 8, 9 and 11 show placeholders until a recording is added. To add one, put it at `demo/video/public/clips/<scene>.mp4` and add the scene id to `public/clips/index.json`. Without recordings the video runs about 3:45. The three recordings add about 80s, which brings it just over the 5-minute minimum; `npm run voiceover` prints the current runtime.

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

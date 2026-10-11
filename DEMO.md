# Day 3: live demo plan

**The claim the demo must prove:** many agents work at once with no shared repo, no branches and no merge conflicts, and the system still gets *collectively smarter*. What one agent figures out, every later agent can reuse, and every step is a plain git commit you can clone.

**The one chart that proves it:** attempts and tokens per task, wave 1 (no skills) vs wave 2 (skills available), on the same task families with different parameters.

---

## What has to exist (build list)

### 1. Model-driven agents (the critical gap)
So far every run was hand-written. The demo needs a model writing Code Mode code.

- Each `CodeAgent` gets a task prompt and runs a small loop: prompt the model, run the code, and on error feed the error back, for up to 3 attempts. Every attempt is a commit, so **error→fix chains appear in git naturally**. That is Voyager's iterative prompting, visible in `git log -p run.js`.
- The model sees connector docs plus the codemode workflow (`codemode.search` → `describe` → call). Snippets surface through `search`, so skills are discovered, not hard-wired.
- Recorded per task as commit trailers: `Codemode-Task`, `Codemode-Attempt`, `Codemode-Tokens`. The curator aggregates them for the chart.
- **Model choice:** a *cheap* model for agents, so the skill uplift is large and visible ("skills make a small model reliable"), and the stronger code model only in the curator.

### 2. A world with shared sub-problems
`catalog` alone is too thin. Add 1–2 connectors whose quirks many tasks hit:

| Connector | Built-in trap | Skill it should produce |
|---|---|---|
| `catalog` (exists) | pagination via `nextCursor` | walk-all-pages / count-by-category |
| `orders` | paginated, **mixed date formats** (`2026-10-03`, `10/03/2026`, epoch ms) | orders-in-date-range |
| `inventory` | per-warehouse stock, has to be summed across warehouses | total-stock-for-product |

About 6 task families × many parameter values. Each family template is phrased in several ways so clustering is non-trivial ("How many…", "Count…", "Number of…").

### 3. Swarm launcher
- `POST /swarm { wave, agents, families }` on the agent Worker fans out to N fresh agent Durable Objects (`w1-a001`…), each with one generated task.
- It runs everything concurrently; the Workers runtime handles the fan-out. Target: **100 agents per wave** live, plus one pre-recorded run at **1,000** for the scale claim.

### 4. Live event delivery + safety net
- On deploy: subscribe each new agent repo's `pushed` events to a queue the curator consumes. The account-level `repo.created` event triggers creating that repo's subscription. Needs the REST API, because the `cf` subscription command doesn't expose Artifacts source fields.
- **Safety net for a live demo:** a curator cron that backfills every 30s. It's idempotent, so if events lag, nothing is lost.

### 5. Dashboard (served by the curator Worker, live)
- **Agents grid:** one tile per repo, colored by latest status, with attempt count. Clicking one shows its commit chain and diffs.
- **Skills panel:** each skill with its Clef reusability score, replay result (3/3), source agents (provenance links) and reuse count, ticking up live.
- **Curator feed:** clusters considered, Clef same-task probabilities, rejections and why (low reusability, failed replay), and publishes.
- **The chart:** attempts per task and tokens per task by wave, plus % of runs using a skill.
- **Counters:** repos, commits, events and skills. The scale story at a glance.

---

## Run of show (~7 min)

| Time | Beat | On screen |
|---|---|---|
| 0:00 | **Problem.** Git hosting assumes humans; agents produce orders of magnitude more changes. Branches, PRs and merge conflicts don't scale to 100k agents. | One slide |
| 0:40 | **Plugin.** A stock Code Mode agent plus 3 lines turns every execution into a commit on its own Artifacts repo. | Code diff |
| 1:20 | **Wave 1:** launch 100 agents, no skills. | Grid lights up, commit counter climbs |
| 2:30 | **Real git.** `git clone` one agent and run `git log -p run.js`: an error→fix chain with `Codemode-*` trailers. | Terminal |
| 3:15 | **Curator.** Clusters form across agents. Clef decides "same task" and scores reusability; replay verifies; skills land in the `skills` repo with provenance. | Curator feed + skills panel |
| 4:30 | **Wave 2:** 100 new agents, same families, new parameters. They find skills via `codemode.search`. | Reuse counts tick; chart drops |
| 5:45 | **Governance with git.** `git log` on `skills`; an agent commit shows `Codemode-Skills-Ref`, the exact library version it ran. Pin or roll back = change a ref. | Terminal |
| 6:30 | **Scale and close.** No shared writes on the hot path: each agent writes only its repo, only the curator writes `skills`. Show the 1,000-agent run numbers. | Counters + architecture slide |

---

## Test plan (before recording)

1. **Smoke, 10 agents, local.** End to end through the LLM loop. Check that trailers, the curator and skills all show up.
2. **Wave pair, 50 + 50, deployed.** Check that skills form in wave 1 and that the wave 2 chart actually drops. Tune `POLICY` (min repos, Clef thresholds) and the task mix if it doesn't.
3. **Load, 200 agents, deployed.** Watch for Workers AI rate limits (agent model, Clef, embeddings), Artifacts push errors, and curator lag (it processes serially). Fixes if needed: batch Clef questions across runs, or shard the curator by connector set.
4. **Fault drills:**
   - Kill the curator mid-wave and confirm that backfill catches up.
   - Force a bad proposal and confirm the replay rejects it.
   - Check that an agent with a missing connector skips skills.
5. **1,000-agent run, recorded** for the scale numbers: repos created, commits pushed, events, time to first skill, cost.
6. **Dress rehearsal ×2** on the deployed stack with fresh namespaces (`demo-1`, `demo-2`). Keep the best recording as the backup video.

## Risks

| Risk | Mitigation |
|---|---|
| Model nondeterminism: no clusters form live | Families designed with strong overlap; a minimum of ~15 agents per family; tested thresholds; backup recording |
| Rate limits at 100+ concurrent agents | Stagger launches over ~20s; measured in test 3 |
| Curator falls behind | Cron backfill; show queue depth on the dashboard; per-commit cost measured in test 3 |
| Bad skill published | Replay verification is the gate; the demo shows a rejection on purpose |
| Live network flakiness on stage | Deployed stack, not local; backup recording |

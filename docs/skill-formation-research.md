# Skill formation: Voyager, follow-ups, and a verb-based redesign

Research notes behind the curator redesign. **[verified]** means the claim was checked against the paper text or code, and **[abstract only]** means only the abstract was read.

## Voyager ([paper](https://arxiv.org/abs/2305.16291), [code](https://github.com/MineDojo/Voyager)) [verified]

- **When a skill is added:** only on task success (`if info["success"]: add_new_skill`). Success is judged by a GPT-4 critic that looks at the final state; there is no ground truth. Removing self-verification costs 73% of the items discovered.
- **Granularity:** one program per curriculum task. The skill is the last async function in the program. This works because the curriculum keeps tasks tiny ("Mine 3 iron").
- **Keys and retrieval:** each skill has a description of at most 6 sentences, written by GPT-3.5. Retrieval embeds those descriptions and returns the top 5 by similarity to the task context and execution feedback.
- **Composition:** all skills are injected into the runtime, so new code calls old skills by name. The prompt forces the use of control primitives.
- **Dedup:** by function name only. A skill with an existing name is overwritten and the old version kept as V2. Voyager never merges runs from different episodes.
- **Failure handling:** up to 4 rounds of iterative prompting, feeding back errors, environment feedback and the critic's critique.

## Skill-formation mechanisms since Voyager

| | Granularity | Promoted when | Checked without ground truth | Conflicts | Composition |
|---|---|---|---|---|---|
| Voyager | whole (tiny) task | the critic says success | LLM critic | overwrite by name | call by name |
| [ReGAL](https://arxiv.org/abs/2401.16467) | shared helpers | the refactored programs still pass | each refactored program reproduces its own original | edit if the new version passes more tests; prune by score | helpers called inside programs |
| [ASI](https://arxiv.org/abs/2504.06821) / [AWM](https://arxiv.org/abs/2409.07429) | 2–5 step subroutines | the episode is judged correct | re-run the task with the skill, plus an LLM judge | not specified | skills call skills |
| [TroVE](https://arxiv.org/abs/2401.12869) | one function per solution | it wins the execution-agreement vote | majority of execution outputs | vote, then prefer the simplest; trim unused | import |
| [CRAFT](https://arxiv.org/abs/2309.17428) | abstracted solution | it's correct on its source | uses ground truth | pick the most comprehensive | retrieved into the prompt |
| [LATM](https://arxiv.org/abs/2305.17126) | tool | it passes generated unit tests | LLM-written tests | n/a | dispatcher picks the tool |

Other work:
- [Stitch](https://arxiv.org/abs/2211.16605), [DreamCoder](https://arxiv.org/abs/2006.08381) and [LILO](https://arxiv.org/abs/2310.19791): promote abstractions by how much they compress the corpus (MDL).
- [ExpeL](https://arxiv.org/abs/2308.10144): vote-scored insights (ADD, EDIT, UPVOTE, DOWNVOTE).
- [CodeT](https://arxiv.org/abs/2207.10397): rank code by agreement between generated code and generated tests.
- [SkillOps](https://arxiv.org/abs/2605.13716) and [Skill-as-Pseudocode](https://arxiv.org/abs/2605.27955): typed skill contracts. **[abstract only]**

## dpyr ([repo](https://github.com/MaximeRivest/dpyr)) [verified]

- **A closed set of verbs** taken from dplyr (`filter`, `mutate`, `select`, `group_by`, `summarize`, the joins, and so on). Composition is plain method chaining, so every chain is valid by construction.
- **Expressions are data:** they're typed and checked when the chain is built.
- **The key idea, `SEMANTICS.md`:** wherever backends disagree, the project makes one numbered decision and backs it with a test. Comparisons honor those documented decisions; they're never fuzzy.

## Redesign for the curator

1. **Mine sub-functions, not whole scripts** (ReGAL, AWM, ASI, Stitch).
   - Split scripts at `data.sql` calls and named intermediate values, and cluster those steps across agents.
   - Promote a helper only if each program rewritten to use it still reproduces its *own* result.
   - Rank candidate helpers by how much code they remove across the corpus.
2. **A closed verb vocabulary over a shared transaction frame** (dpyr, plus Voyager's primitives).
   - Sources: `payments(filter)` and `feeRules()`.
   - Enrichers: `withMerchant` and `withMonthContext`.
   - Fee logic: `matchRules`, then `feeOf`, then `summarize`.
   - Counterfactuals: `overrideRule(id, patch)` and `delta(chainA, chainB)`.
   - New skills must be compositions of verbs, or a new verb with a declared shape.
3. **A semantics ledger instead of option flags** (dpyr `SEMANTICS.md`, TroVE, ExpeL).
   - When source runs disagree, diff their intermediate values to find the first verb where they diverge.
   - Decide that rule once, citing the manual, with the cross-agent majority as a prior, and record it as a numbered row with a test.
   - Sources that disagree with the decision are flagged as wrong, not accommodated.
4. **Promote on label-free consensus plus a fresh re-run** (TroVE, ASI, CodeT).
   - Take the majority answer per question across independent agents.
   - A fresh agent using the skill must call it and agree with the majority on held-out instances.
5. **Unit tests per verb, written from the manual** (LATM, CodeT). This gives verification an oracle that doesn't depend on any one agent's interpretation.
6. **Retrieval and lifecycle hygiene** (Voyager, CRAFT, ReGAL, TroVE).
   - Retrieve by description, looking at the problem, the skill's name and its docstring.
   - Track how often each skill is used and how often it succeeds.
   - Edit a skill only if the new version passes more tests; prune skills with a low score.

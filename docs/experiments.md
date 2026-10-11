# DABstep experiments log

Agents use `glm-5.3-flash` on Workers AI with a 20-step budget. Both arms get the same prompt, tools and task order. Scoring uses the official DABstep scorer on the 10 public dev tasks; no other answer key is used anywhere.

## Model bake-off (dev, baseline arm, n≈10 per model)

| Model | Correct | $/task |
|---|---|---|
| glm-5.3-flash | 4/9 | 0.03 |
| deepseek-v4-pro | 3/8 | 0.39 |
| kimi-k2.7-code | 2/8 | 0.07 |
| glm-5.3 | 1/5 | 0.07 |

The ranking is directional only: with n≈10 the standard error is about ±15 points.

## ab25a: random 25-task slice (an effective A/A run)

No skills formed: the random sample had about one task per template, and 7 of 25 tasks failed on infrastructure. It serves as a noise floor. Two identical arms differed by about 1 graded task and about 30% in tokens.

## tpl36a: template-concentrated slice (48 tasks per arm)

**Design:** 6 templates, each with a graded dev task. 5 sibling tasks per template run round-robin in waves of 6, then the dev tasks 3 times each. All 48 tasks completed in both arms.

**Skills:** 3 published after wave 2: `calculate-fee-change-delta`, `compute-average-card-fee` and `get-fee-records-or-applicable-ids`. Each was verified 2/2. The other 3 templates never formed a skill.

| Per task | Baseline | codemode-git | Paired diff (95% CI) |
|---|---|---|---|
| Code runs | 13.3 | 11.0 | −2.3 [−3.8, −0.8] |
| Model steps | 12.1 | 9.7 | −2.4 [−3.8, −1.0] |
| Seconds | 309 | 211 | −99 [−193, −13] |
| Tokens (mean / median) | 206k / 177k | 169k / 82k | −38k [−80k, +8k] |
| Step-limit exhaustion | 6% | 0% | −6 pts |
| Graded accuracy | 8/18 | 6/18 | discordant 3 vs 1 (n.s.) |

**Learning curve:** in waves 1–2 (no skills yet) the codemode-git arm used more tokens than baseline (noise). From wave 4 on it usually used half or less. With the clean skills:
- fee delta: −70% tokens at equal accuracy (3/3 in both arms);
- average fee: −80% tokens at equal accuracy.

**Skill contagion (t1681).** The `get-fee-records-or-applicable-ids` skill:
- compares `monthly_volume` buckets by string equality;
- computes merchant context cumulatively up to the target day instead of for that month.

It passed replay verification because it reproduced its two (wrong) source runs. Two later agents read its source through `codemode.describe` without calling it, copied the same logic, and gave the same wrong answer: they missed fee 454, whose only merchant condition is `monthly_volume = 100k-1m`. Baseline agents got it right 3/3.

Lesson: replay verification certifies reproducibility, not correctness, and a shared library makes errors correlated across agents. This motivates the redesign in [skill-formation-research.md](skill-formation-research.md):
- sub-function mining;
- a semantics ledger;
- unit tests derived from the manual;
- not exposing a skill's full source by default.

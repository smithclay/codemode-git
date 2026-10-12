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

## tpl36b: examples vs fresh baseline (48 tasks per arm)

**Design:** same slice and task order as tpl36a. The examples arm retrieves the 3 nearest answer-producing runs from *other* tasks in the same run (Vectorize, qwen3-embedding, question + code) and shows them as unverified examples. There is no curator. The arm pauses 120s between waves so new examples become filterable. The baseline was re-run fresh alongside it.

| Per task | Baseline | Examples | Paired diff (95% CI) |
|---|---|---|---|
| Code runs | 15.3 | 8.5 | −6.8 [−9.1, −4.5] |
| Model steps | 12.8 | 7.7 | −5.0 [−6.6, −3.4] |
| Tokens (mean / median) | 215k / 168k | 106k / 62k | −109k [−150k, −71k] |
| Seconds (mean / median) | 308 / 267 | 233 / 133 | −75 [−150, −0.5] |
| Step-limit exhaustion | 6% | 2% | n.s. |
| Graded accuracy | 8/18 | 14/18 | discordant 0 vs 6 |

The fresh baseline reproduced tpl36a's baseline accuracy (8/18).

**Graded accuracy per dev task (3 repeats each):**

| Task | Baseline | Skills (tpl36a) | Examples |
|---|---|---|---|
| t1681 | ✓✓✓ | ✗✓✗ | ✓✓✓ |
| t1464 | ✗✗✗ | ✗✗✗ | ✓✓✓ |
| t1871 | ✓✓✗ | ✓✓✓ | ✓✓✓ |
| t1273 | ✓✗✓ | ✗✓✗ | ✓✓✓ |
| t1753 | ✗✗✓ | ✗✗✓ | ✓✗✓ |
| t2697 | ✗✗✗ | ✗✗✗ | ✗✗✗ |

**Examples vs skills (tpl36a):**
- Examples are also cheaper than skills: −2.5 code runs [−4.2, −0.9] and −63k tokens [−104k, −24k].
- Accuracy was 14/18 vs 6/18.
- The skills arm's contagion task t1681 went 3/3 with examples. Agents read other runs' code, but still wrote and ran their own.

**Caveats:**
- The 18 graded trials are 6 tasks × 3 repeats, which are correlated. At the task level, examples improved 4 tasks and worsened none (sign test p≈0.13).
- Trial-level McNemar (6 vs 0, p≈0.03) overstates the evidence.
- Wave 1 had no examples, yet already differed by 36% in tokens, consistent with the ~30% between-arm noise seen in ab25a.

## val1: compact-results prompt (rejected)

**What was tested:**
- A "keep results small" prompt rule.
- An 8k-character cap on data results.
- A "filter the manual in code instead of re-reading it" line.

**Setup:** baseline arm only, 30 tasks paired with tpl36b's baseline.

**Result:**

| | tpl36b baseline | val1 |
|---|---|---|
| Mean tokens | 224k | 160k (−29%) |
| Graded accuracy | 8/18 | 5/18 |
| Step-limit exhaustion | 1 | 3 |

**Decision:** reverted all three under the pre-agreed rule (roll back at ≤5/18 or ≥2 more exhaustions). The likely cause is that agents saw less of the data and the manual they need.

## full1: all 450 DABstep tasks, baseline vs examples

**Setup:**
- Same model (glm-5.3-flash), prompt and task order (`data/tasks/all.jsonl`) in both arms.
- Rolling concurrency 8 per arm, run side by side.
- The examples arm retrieves from runs earlier in the same run; it has no answers or labels.

**Infrastructure failures:** connection resets (ECONNRESET) on long tasks were re-run.
- These were 13 baseline tasks and 10 examples tasks.
- The runner now reconnects to the same agent instead of starting over.
- The 10 re-run examples-arm tasks saw a fuller index than they would have at their original position.

**Spend:** $26.76 in Workers AI for the run, including retries.

**Results** (paired over all 450 tasks):

| Per task | Baseline | Examples | Paired diff (95% CI) |
|---|---|---|---|
| Code runs | 13.8 | 9.4 | −4.4 [−5.0, −3.8] |
| Model steps | 12.7 | 9.5 | −3.3 [−3.8, −2.7] |
| Tokens (mean / median) | 220k / 191k | 177k / 61k | −43k [−60k, −26k] |
| Step-limit exhaustion | 13% | 7% | −6 pts [−9, −2] |
| Seconds (mean / median) | 540 / 510 | 532 / 341 | n.s. |
| "Not Applicable" answers | 74 | 38 | |

**Interpretation:**
- **Tokens:** the median task needs a third of the tokens. A tail of hard tasks costs about the same in both arms.
- **Agreement:** the arms gave identical answers on 155/450 tasks.
- **Accuracy:** only 6 of the 450 have public answers, and both arms got 2/6, so accuracy comes from the leaderboard (below).

### Official scores (DABstep Unvalidated leaderboard, 2026-10-12)

**Submissions:**
- "Cloudflare Code Mode Baseline" and "Cloudflare Code Mode with Examples".
- Both were scored by Adyen's official scorer. Per-task scores are published in the `adyen/DABstep` dataset under `data/task_scores/`.
- Code is at tag [`dabstep-full1`](https://github.com/smithclay/codemode-git/tree/dabstep-full1).
- An earlier upload of the same baseline file, as "Cloudflare Code Mode dabstep-full1", was never scored and was resubmitted.

| Level | Baseline | Examples | Diff | Only baseline right | Only examples right | McNemar (exact) |
|---|---|---|---|---|---|---|
| Easy (72) | 56 (77.8%) | 62 (86.1%) | +8.3 pts | 1 | 7 | p = 0.07 |
| Hard (378) | 89 (23.5%) | 146 (38.6%) | +15.1 pts | 24 | 81 | p < 0.001 |
| Overall (450) | 145 (32.2%) | 208 (46.2%) | +14.0 pts | 25 | 88 | p < 0.001 |

**Where the gain comes from:**
- Of the 88 tasks only the examples arm got right, the baseline had run out of steps on 13 and answered "Not Applicable" on 15.
- Most of the gain is better answers, not merely more answers.
- Of the 25 tasks only the baseline got right, the examples arm ran out of steps on 2.

**Bottom line:** at the same model and prompt, adding examples raised hard-task accuracy from 23.5% to 38.6% while using a third of the median tokens per task.

**Caveats for the claim:**
- **Test-time learning:** agents see earlier agents' own unverified runs from the same pass over the test set. No answers or labels are used.
- **Task order** is fixed and published (`data/tasks/all.jsonl`).
- **Benchmark structure:** DABstep's tasks come in templates of similar questions, which is the setting where reuse helps.
- **One run per arm.** The paired, per-task comparison controls for task difficulty, but not for run-to-run variance.
- **Prediction miss:** before scores were available, we predicted a 0–3 point gain from label-free signals. That prediction was wrong.

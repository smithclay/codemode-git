"""Paired comparison of two arms on the same slice.

    python3 scripts/compare.py results/tpl36a-baseline.jsonl results/tpl36a-codemode-git.jsonl --slice tpl36

Pairs results by (task_id, repeat). Reports, per arm and as paired
differences: graded accuracy (dev tasks, official scorer, McNemar counts),
step-limit exhaustion, code runs, tokens and time; plus a learning curve by
position in the slice (does the codemode-git arm get cheaper as skills form?).
"""

import argparse
import json
import random
import sys
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))
from scorer import question_scorer  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("a")
p.add_argument("b")
p.add_argument("--slice", required=True)
args = p.parse_args()

gold = {str(t["task_id"]): t["answer"] for t in map(json.loads, (ROOT / "data/tasks/dev.jsonl").read_text().splitlines())}
order = [json.loads(l) for l in (ROOT / "data/tasks" / f"{args.slice}.jsonl").read_text().splitlines() if l.strip()]
position = {(str(t["task_id"]), t.get("repeat", 0)): i for i, t in enumerate(order)}


def load(path):
    rows = {}
    for r in map(json.loads, Path(path).read_text().splitlines()):
        rows[(r["task_id"], r.get("repeat", 0))] = r
    return rows


A, B = load(args.a), load(args.b)
name_a, name_b = Path(args.a).stem, Path(args.b).stem
keys = sorted(set(A) & set(B), key=lambda k: position.get(k, 1e9))
print(f"{len(keys)} paired tasks ({len(A)} in {name_a}, {len(B)} in {name_b}, {len(order)} in slice)\n")

tokens = lambda r: r["tokens"]["input"] + r["tokens"]["output"]
correct = lambda r: question_scorer(str(r["answer"]), str(gold[r["task_id"]]))


def boot_ci(diffs, n=5000, seed=0):
    rng = random.Random(seed)
    means = sorted(mean(rng.choices(diffs, k=len(diffs))) for _ in range(n))
    return means[int(0.025 * n)], means[int(0.975 * n)]


# Graded (dev) tasks
graded = [k for k in keys if k[0] in gold]
if graded:
    ca = sum(correct(A[k]) for k in graded)
    cb = sum(correct(B[k]) for k in graded)
    only_a = sum(correct(A[k]) and not correct(B[k]) for k in graded)
    only_b = sum(correct(B[k]) and not correct(A[k]) for k in graded)
    print(f"graded accuracy ({len(graded)} trials): {name_a} {ca}/{len(graded)}  vs  {name_b} {cb}/{len(graded)}")
    print(f"  discordant pairs: only {name_a} right = {only_a}, only {name_b} right = {only_b}  (McNemar)")
    for tid in sorted({k[0] for k in graded}, key=lambda t: position.get((t, 0), 0)):
        ra = "".join("✓" if correct(A[k]) else "✗" for k in graded if k[0] == tid)
        rb = "".join("✓" if correct(B[k]) else "✗" for k in graded if k[0] == tid)
        print(f"    t{tid}: {name_a} {ra}  {name_b} {rb}")
    print()

print(f"{'metric':22} {name_a:>22} {name_b:>22}   paired diff (b-a), 95% CI")
for label, f in [
    ("exhausted (rate)", lambda r: float(r.get("exhausted", False))),
    ("code runs", lambda r: r["executions"]),
    ("model steps", lambda r: r["steps"]),
    ("tokens", tokens),
    ("seconds", lambda r: r["ms"] / 1000),
]:
    va = [f(A[k]) for k in keys]
    vb = [f(B[k]) for k in keys]
    diffs = [y - x for x, y in zip(va, vb)]
    lo, hi = boot_ci(diffs)
    print(f"{label:22} {mean(va):>14.2f} (md {median(va):>6.0f}) {mean(vb):>14.2f} (md {median(vb):>6.0f})   {mean(diffs):+.2f} [{lo:+.2f}, {hi:+.2f}]")

used = sum(1 for k in keys if B[k].get("skillsUsed"))
offered = sum(1 for k in keys if B[k].get("skillsOffered"))
print(f"\n{name_b}: skills offered on {offered}/{len(keys)} tasks, used on {used}/{len(keys)}")

# Learning curve: tokens by wave of the slice
wave = 6
print(f"\nmean tokens by slice wave (waves of {wave}):")
for w in range(0, len(order), wave):
    ks = [k for k in keys if w <= position.get(k, -1) < w + wave]
    if ks:
        print(f"  wave {w // wave + 1}: {name_a} {mean(tokens(A[k]) for k in ks):>9,.0f}   {name_b} {mean(tokens(B[k]) for k in ks):>9,.0f}"
              f"   skills used {sum(1 for k in ks if B[k].get('skillsUsed'))}/{len(ks)}")

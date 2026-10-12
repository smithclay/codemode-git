"""Learning curve for full1: accuracy and median tokens by position in the run.

    python3 scripts/learning_curve.py <task_scores dir>

<task_scores dir> holds the official per-task scores from the adyen/DABstep
dataset (data/task_scores/), saved as Baseline.jsonl and with_Examples.jsonl.
Task order is data/tasks/all.jsonl; token counts come from results/full1-*.jsonl.
"""

import json
import sys
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
scores = Path(sys.argv[1])
order = [str(json.loads(l)["task_id"]) for l in (ROOT / "data/tasks/all.jsonl").read_text().splitlines() if l.strip()]


def load_scores(name):
    return {r["task_id"]: r["score"] for r in map(json.loads, (scores / f"{name}.jsonl").read_text().splitlines())}


def load_runs(arm):
    return {str(r["task_id"]): r for r in map(json.loads, (ROOT / f"results/full1-{arm}.jsonl").read_text().splitlines())}


acc = {"baseline": load_scores("Baseline"), "examples": load_scores("with_Examples")}
runs = {"baseline": load_runs("baseline"), "examples": load_runs("codemode-git-examples")}
tokens = lambda r: r["tokens"]["input"] + r["tokens"]["output"]

print("| Tasks (run order) | Examples offered | Accuracy: baseline / examples | Median tokens: baseline / examples |")
print("|---|---|---|---|")
for lo, hi in [(0, 8), (8, 24), (24, 48), (48, 96), (96, len(order))]:
    ids = order[lo:hi]
    offered = sum(1 for t in ids if runs["examples"][t].get("examplesOffered"))
    a = [100 * sum(acc[arm][t] for t in ids) / len(ids) for arm in ("baseline", "examples")]
    m = [median(tokens(runs[arm][t]) for t in ids) for arm in ("baseline", "examples")]
    print(f"| {lo + 1}–{hi} | {offered}/{len(ids)} | {a[0]:.1f}% / {a[1]:.1f}% | {m[0] / 1000:.0f}k / {m[1] / 1000:.0f}k |")

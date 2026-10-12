"""Score result files against DABstep dev answers with the official scorer.

    python3 scripts/score.py results/dev1-baseline.jsonl [results/dev1-codemode-git-examples.jsonl ...]

Also writes <file>.submission.jsonl in the leaderboard's format
({task_id, agent_answer}) for any split.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))
from scorer import question_scorer  # noqa: E402  (official scorer, fetched by fetch.sh)

answers = {
    str(t["task_id"]): t["answer"]
    for t in map(json.loads, (ROOT / "data/tasks/dev.jsonl").read_text().splitlines())
}

for path in sys.argv[1:]:
    rows = [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]
    sub = Path(path).with_suffix(".submission.jsonl")
    sub.write_text("".join(json.dumps({"task_id": r["task_id"], "agent_answer": r["answer"]}) + "\n" for r in rows))
    scored = [r for r in rows if r["task_id"] in answers]
    correct = [r for r in scored if question_scorer(str(r["answer"]), str(answers[r["task_id"]]))]
    n = len(rows) or 1
    print(f"{path}")
    if scored:
        print(f"  dev accuracy: {len(correct)}/{len(scored)} = {len(correct) / len(scored):.0%}")
        for level in ("easy", "hard"):
            lv = [r for r in scored if r.get("level") == level]
            if lv:
                ok = sum(1 for r in lv if r in correct)
                print(f"    {level}: {ok}/{len(lv)}")
    print(f"  per task: {sum(r['executions'] for r in rows) / n:.1f} code runs, "
          f"{sum(r['errors'] for r in rows) / n:.1f} errors, "
          f"{sum(r['tokens']['input'] + r['tokens']['output'] for r in rows) / n:,.0f} tokens, "
          f"{sum(r['ms'] for r in rows) / n / 1000:.0f}s")
    # A leaderboard submission must answer every test task exactly once.
    if len(rows) > len(answers):
        test_ids = {str(json.loads(l)["task_id"]) for l in (ROOT / "data/tasks/all.jsonl").read_text().splitlines() if l.strip()}
        ids = [r["task_id"] for r in rows]
        missing = sorted(test_ids - set(ids), key=int)
        dupes = len(ids) - len(set(ids))
        print(f"  coverage: {len(set(ids) & test_ids)}/{len(test_ids)} test tasks"
              f"{f', MISSING {len(missing)}: {missing[:20]}' if missing else ''}{f', {dupes} duplicates' if dupes else ''}")
    print(f"  submission file: {sub}")

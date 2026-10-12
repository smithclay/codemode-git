"""Build a template-concentrated A/B slice, where learning across agents has a chance to apply.

DABstep's 450 tasks are ~113 question templates (most with ~20 instances).
For each graded dev task, take its template and sample N sibling tasks from
the test split. Order: siblings round-robin across templates (one per
template per wave), then every dev task, repeated R times, at the end where
the most has been learned. Same file, same order for both arms.

    python3 scripts/make_template_slice.py --name tpl36 --dev 1681,1464,1871,1273,2697,1753 \
        --per-template 5 --repeats 3 --seed 7
"""

import argparse
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MONTHS = r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\b"


def template(q: str) -> str:
    q = re.sub(r"\b[A-Z][a-z]+(_[A-Za-z]+)+\b", "<M>", q)  # merchant names
    q = re.sub(MONTHS, "<MON>", q)
    q = re.sub(r"\b(NexPay|GlobalCard|SwiftCharge|TransactPlus)\b", "<SCHEME>", q)
    q = re.sub(r"\d+(\.\d+)?", "<N>", q)
    q = re.sub(r"=\s*[A-Z]\b", "= <X>", q)
    # Dev questions are sometimes phrased slightly differently ("are"/"were", "fee"/"Fee").
    q = re.sub(r"\bwere\b", "are", q.lower())
    return q


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True)
    p.add_argument("--dev", required=True, help="comma-separated dev task ids")
    p.add_argument("--per-template", type=int, default=5)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args()

    load = lambda split: [json.loads(l) for l in (ROOT / "data/tasks" / f"{split}.jsonl").read_text().splitlines() if l.strip()]
    dev = {str(t["task_id"]): t for t in load("dev")}
    # Dev tasks also appear in the test split; never use one as a sibling.
    pool = [t for t in load("all") if str(t["task_id"]) not in dev]
    rng = random.Random(args.seed)

    groups = []
    for dev_id in args.dev.split(","):
        d = dev[dev_id]
        siblings = [t for t in pool if template(t["question"]) == template(d["question"])]
        if len(siblings) < args.per_template:
            raise SystemExit(f"t{dev_id}: only {len(siblings)} siblings for template {template(d['question'])!r}")
        groups.append((d, rng.sample(siblings, args.per_template)))

    ordered = []
    for i in range(args.per_template):
        ordered += [sibs[i] for _, sibs in groups]
    for r in range(args.repeats):
        ordered += [{**d, "repeat": r} for d, _ in groups]

    out = ROOT / "data/tasks" / f"{args.name}.jsonl"
    out.write_text("".join(json.dumps(t) + "\n" for t in ordered))
    print(f"{out}: {len(ordered)} tasks ({len(groups)} templates x {args.per_template} siblings + {len(groups)} dev x {args.repeats})")
    for d, sibs in groups:
        print(f"  t{d['task_id']}: {template(d['question'])[:90]}  <- {[s['task_id'] for s in sibs]}")


if __name__ == "__main__":
    main()

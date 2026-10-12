"""Build an A/B task slice: N tasks sampled from the test split (ungraded,
they give the learning arm material to learn from), followed by all dev tasks
(graded). Same file, same order for both arms.

    python3 scripts/make_slice.py --name ab25 --sample 15 --seed 42
"""

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument("--name", required=True)
p.add_argument("--sample", type=int, default=15)
p.add_argument("--seed", type=int, default=42)
args = p.parse_args()

load = lambda split: [json.loads(l) for l in (ROOT / "data/tasks" / f"{split}.jsonl").read_text().splitlines() if l.strip()]
dev = load("dev")
dev_ids = {str(t["task_id"]) for t in dev}
pool = [t for t in load("all") if str(t["task_id"]) not in dev_ids]
picked = random.Random(args.seed).sample(pool, args.sample)
out = ROOT / "data/tasks" / f"{args.name}.jsonl"
out.write_text("".join(json.dumps(t) + "\n" for t in picked + dev))
print(f"{out}: {len(picked)} sampled ({sum(t['level'] == 'hard' for t in picked)} hard) + {len(dev)} dev")
for t in picked:
    print(f"  t{t['task_id']} [{t['level']}] {t['question'][:100]}")

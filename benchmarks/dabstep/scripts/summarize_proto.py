"""Summarize refactor-prototype results (with or without the semantics ledger).

    python3 scripts/summarize_proto.py results/proto-ledger-b*.json
"""

import json
import sys

programs = verified = excluded = 0
helpers, kept, rows, tests, errors = [], [], [], [], []
for path in sys.argv[1:]:
    try:
        data = json.load(open(path))
    except Exception:
        errors.append((path, "unreadable / still running"))
        continue
    for r in data["reports"]:
        if r.get("error"):
            errors.append((path, r["error"][:120]))
            continue
        programs += len(r["results"])
        verified += sum(x["ok"] for x in r["results"])
        excluded += sum(1 for x in r["results"] if x.get("excluded"))
        helpers += r["helpers"]
        kept += r.get("kept", [])
        rows += r.get("ledger") or []
        tests += r.get("tests") or []

print(f"programs {programs}: verified {verified}, excluded as contradicting the ledger {excluded}")
print(f"helpers proposed {len(helpers)}, kept {len(kept)}: {sorted(set(kept))}")
print(f"tests {len(tests)}: passed {sum(t['ok'] for t in tests)}")
for t in tests:
    if not t["ok"]:
        print(f"  FAIL {t['helper']} / {t['name']}: {(t.get('error') or '')[:140]}")
print(f"\nledger rows {len(rows)}:")
for r in rows:
    print(f"  {r['id']} [{r['about'][:60]}] -> {r['decision'][:140]}\n      cite: {r['citation'][:140]}  losers={r['losers']}")
if errors:
    print("\nerrors:", errors)

#!/usr/bin/env bash
# Download the DABstep context files and tasks (CC-BY-4.0, Adyen) into ./data.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=https://huggingface.co/datasets/adyen/DABstep/resolve/main/data
mkdir -p data/context data/tasks
for f in acquirer_countries.csv fees.json manual.md merchant_category_codes.csv merchant_data.json payments-readme.md payments.csv; do
  curl -sfL -o "data/context/$f" "$BASE/context/$f"
done
for split in dev all; do
  curl -sfL -o "data/tasks/$split.jsonl" "$BASE/tasks/$split.jsonl"
done
# The official scorer, used as-is so local scores match the leaderboard.
curl -sfL -o data/scorer.py https://huggingface.co/spaces/adyen/data-agents-benchmark/raw/main/dabstep_benchmark/evaluation/scorer.py
wc -l data/tasks/*.jsonl

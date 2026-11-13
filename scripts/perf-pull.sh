#!/usr/bin/env bash
# Copy the perf reports down from the droplet into perf-data/perf.jsonl (rotated logs included).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-jk}"
mkdir -p perf-data
ssh "$HOST" 'cd /var/log/druid-grove && for f in $(ls -1r perf.log* 2>/dev/null); do case $f in *.gz) zcat "$f";; *) cat "$f";; esac; done' > perf-data/perf.jsonl
echo "$(wc -l < perf-data/perf.jsonl | tr -d ' ') reports -> perf-data/perf.jsonl"

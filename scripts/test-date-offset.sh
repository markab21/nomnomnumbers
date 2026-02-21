#!/usr/bin/env bash
set -e
cd /home/mark/projects/nomnomnumbers

TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -d "1 day ago" +%Y-%m-%d)

# Test date 0 = today
RESULT=$(bun start today --date 0)
echo "$RESULT" | grep -q "\"date\": \"$TODAY\"" && echo "PASS: --date 0 returns today ($TODAY)" || { echo "FAIL: --date 0"; exit 1; }

# Test date -1 = yesterday
RESULT=$(bun start today --date -1)
echo "$RESULT" | grep -q "\"date\": \"$YESTERDAY\"" && echo "PASS: --date -1 returns yesterday ($YESTERDAY)" || { echo "FAIL: --date -1"; exit 1; }

# Test no flag = today
RESULT=$(bun start today)
echo "$RESULT" | grep -q "\"date\": \"$TODAY\"" && echo "PASS: no --date flag defaults to today" || { echo "FAIL: no flag"; exit 1; }

echo "ALL PASS"

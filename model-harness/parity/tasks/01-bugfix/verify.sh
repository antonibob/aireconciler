#!/usr/bin/env bash
# Pass iff the suite is green AND the tests were left alone.
set -u
cd "$1" || exit 1
if ! git diff --quiet -- test_gst.py 2>/dev/null; then
    echo "FAIL: tests were modified"; exit 1
fi
python3 -m pytest -q 2>&1 | tail -3
exit "${PIPESTATUS[0]}"

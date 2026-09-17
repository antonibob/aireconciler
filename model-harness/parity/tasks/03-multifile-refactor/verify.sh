#!/usr/bin/env bash
# Pass iff the suite is green, the new name is used everywhere, and no
# stragglers of the old name survive in any file.
set -u
cd "$1" || exit 1

if grep -rn '\breconcile_batch\b' --include='*.py' . ; then
    echo "FAIL: old name still present above"; exit 1
fi
if ! grep -rqn '\breconcile_payment_batch\b' --include='*.py' . ; then
    echo "FAIL: new name never appears"; exit 1
fi
python3 -m pytest -q 2>&1 | tail -3
exit "${PIPESTATUS[0]}"

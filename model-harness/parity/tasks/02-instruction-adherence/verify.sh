#!/usr/bin/env bash
# Pass iff the function exists, the tests are green, and the CLAUDE.md rules
# were actually followed. The rules are the whole point: a model that writes a
# working function using floats has failed this task.
set -u
cd "$1" || exit 1
fail=0

python3 -m pytest -q >/dev/null 2>&1 || { echo "FAIL: tests not green"; fail=1; }

python3 - <<'PY' || fail=1
import ast, sys, pathlib

src = pathlib.Path("discounts.py").read_text()
tree = ast.parse(src)

fn = next((n for n in ast.walk(tree)
           if isinstance(n, ast.FunctionDef)
           and n.name == "apply_early_payment_discount"), None)
if fn is None:
    print("FAIL: apply_early_payment_discount not defined"); sys.exit(1)

# Rule 1: no float literals anywhere in the new function.
floats = [n for n in ast.walk(fn)
          if isinstance(n, ast.Constant) and isinstance(n.value, float)]
if floats:
    print(f"FAIL: rule 1 -- float literal(s) in money code: "
          f"{[n.value for n in floats]}")
    sys.exit(1)

# Rule 1: Decimal() must never be constructed from a float literal.
for call in (n for n in ast.walk(fn) if isinstance(n, ast.Call)):
    name = getattr(call.func, "id", getattr(call.func, "attr", ""))
    if name == "Decimal" and call.args:
        a = call.args[0]
        if isinstance(a, ast.Constant) and isinstance(a.value, float):
            print(f"FAIL: rule 1 -- Decimal({a.value!r}) built from a float")
            sys.exit(1)

# Rule 2: explicit ROUND_HALF_UP quantization.
if "ROUND_HALF_UP" not in ast.dump(fn):
    print("FAIL: rule 2 -- no explicit ROUND_HALF_UP rounding")
    sys.exit(1)

print("rules followed")
PY

exit $fail

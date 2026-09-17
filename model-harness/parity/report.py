#!/usr/bin/env python3
"""Summarise a parity run: who finished the job, for how much.

    python report.py results.json
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


def mean(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    return sum(vals) / len(vals) if vals else None


def fmt(v, spec=".2f", dash="-"):
    return dash if v is None else format(v, spec)


def main(argv) -> int:
    path = Path(argv[1] if len(argv) > 1 else "results.json")
    if not path.exists():
        print(f"no results at {path}", file=sys.stderr)
        return 1
    runs = json.loads(path.read_text())
    if not runs:
        print("no runs recorded")
        return 1

    profiles = sorted({r["profile"] for r in runs})
    tasks = sorted({r["task"] for r in runs})
    cell = defaultdict(list)
    for r in runs:
        cell[(r["profile"], r["task"])].append(r)

    width = max(len(t) for t in tasks) + 2
    print(f"\n{'task'.ljust(width)}" + "".join(p.ljust(14) for p in profiles))
    print("-" * (width + 14 * len(profiles)))
    for task in tasks:
        row = task.ljust(width)
        for p in profiles:
            rs = cell[(p, task)]
            if not rs:
                row += "-".ljust(14)
                continue
            passed = sum(1 for r in rs if r["passed"])
            row += f"{passed}/{len(rs)}".ljust(14)
        print(row)

    print(f"\n{'':<{width}}" + "".join(p.ljust(14) for p in profiles))
    for label, key, spec in (("pass rate", None, None),
                             ("avg $/task", "cost_usd", ".4f"),
                             ("avg turns", "turns", ".1f"),
                             ("avg secs", "duration_s", ".0f")):
        row = label.ljust(width)
        for p in profiles:
            rs = [r for r in runs if r["profile"] == p]
            if key is None:
                pct = 100.0 * sum(1 for r in rs if r["passed"]) / len(rs) if rs else 0
                row += f"{pct:.0f}%".ljust(14)
            else:
                row += fmt(mean([r.get(key) for r in rs]), spec).ljust(14)
        print(row)

    baseline = "claude" if "claude" in profiles else profiles[0]
    base_cost = mean([r.get("cost_usd") for r in runs if r["profile"] == baseline])
    if base_cost:
        print(f"\ncost relative to {baseline}:")
        for p in profiles:
            c = mean([r.get("cost_usd") for r in runs if r["profile"] == p])
            if c:
                print(f"  {p:10} {base_cost / c:5.1f}x cheaper" if c < base_cost
                      else f"  {p:10} baseline" if p == baseline
                      else f"  {p:10} {c / base_cost:5.1f}x dearer")

    failures = [r for r in runs if not r["passed"]]
    if failures:
        print(f"\nfailures ({len(failures)}) -- each one is a skill to write:")
        for r in failures:
            why = r["error"] or r["verify_output"].splitlines()[0] if (
                r["error"] or r["verify_output"]) else "no detail"
            print(f"  {r['profile']:10} {r['task']:26} {why[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

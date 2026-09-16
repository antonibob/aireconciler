#!/usr/bin/env python3
"""Check whether the runner is in a state where it may type. Read-only.

Run this first when setting up the runner, and whenever the watchdog starts
refusing work: it prints the same verdict the driver acts on, with every reason
at once rather than one per round-trip.

    python tools/preflight.py --profile profiles/vendor_invoicing.json --host AP-BOT-01
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from seradex_ingress.calibration import CalibrationProfile  # noqa: E402
from seradex_ingress.geometry import Point  # noqa: E402
from seradex_ingress.guards import SessionPolicy, WindowPolicy, preflight  # noqa: E402
from seradex_ingress.ocr import screen_text  # noqa: E402
from seradex_ingress.retarget import describe, retarget, search_region  # noqa: E402
from seradex_ingress.win32_adapters import (  # noqa: E402
    foreground_window_facts,
    frame_stats,
    grab,
    session_facts,
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True, type=Path)
    ap.add_argument("--host", action="append", default=[], metavar="NAME",
                    help="designated runner hostname (repeatable)")
    args = ap.parse_args(argv)

    profile = CalibrationProfile.load(args.profile)
    window = foreground_window_facts()
    image = grab(bbox=search_region(window.rect) if window.rect.width > 0 else None)
    stats = frame_stats(image)
    session = session_facts()

    origin = Point(*(search_region(window.rect)[:2] if window.rect.width > 0 else (0, 0)))
    lines = screen_text(image, origin=origin)
    result = retarget(profile, lines, window_rect=window.rect)

    targets = list(result.targets.all_points()) if result.targets else []
    verdict = preflight(
        session,
        SessionPolicy(allowed_hostnames=tuple(args.host)),
        stats,
        window,
        WindowPolicy(title_pattern=profile.window_title_pattern),
        targets,
    )

    print(f"host      : {session.hostname}  session {session.session_id} "
          f"({session.connection_state}{', locked' if session.locked else ''})")
    print(f"idle      : {session.idle_seconds:.1f}s")
    print(f"window    : {window.title!r}")
    print(f"frame     : {stats.width}x{stats.height} stddev {stats.stddev_luma:.1f}")
    print(f"ocr       : {len(lines)} lines")
    print(describe(result))

    if verdict.ok and result.ok:
        print("\nPASS - the runner may type.")
        return 0

    print("\nREFUSED:")
    for reason in list(verdict.reasons) + list(result.reasons):
        print(f"  - {reason}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

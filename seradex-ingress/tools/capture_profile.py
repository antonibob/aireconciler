#!/usr/bin/env python3
"""Capture a calibration profile. Run once per Seradex screen, on the runner.

This is the last time anyone parks a cursor. The session records two things:
the anchors you park on, and the OCR landmarks that let every later run find
those anchors again wherever the window has moved to. Re-run it only when
Seradex ships a build that changes the form's layout.

    python tools/capture_profile.py ^
        --screen vendor_invoicing ^
        --title "Vendor Invoicing" ^
        --out profiles/vendor_invoicing.json ^
        --anchor po_field --anchor invoice_date_mm --anchor save_button
"""

from __future__ import annotations

import argparse
import ctypes
import sys
import time
from ctypes import wintypes
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from seradex_ingress.calibration import Anchor, CalibrationProfile  # noqa: E402
from seradex_ingress.geometry import Point  # noqa: E402
from seradex_ingress.ocr import screen_text  # noqa: E402
from seradex_ingress.registration import propose_landmarks  # noqa: E402
from seradex_ingress.retarget import search_region  # noqa: E402
from seradex_ingress.win32_adapters import (  # noqa: E402
    foreground_window_facts,
    frame_stats,
    grab,
)


def cursor_position() -> Point:
    pt = wintypes.POINT()
    if not ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)):
        raise ctypes.WinError(ctypes.get_last_error())
    return Point(float(pt.x), float(pt.y))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screen", required=True, help="profile name, e.g. vendor_invoicing")
    ap.add_argument("--title", required=True, help="regex the window title must match")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--anchor", action="append", default=[], metavar="NAME",
                    help="anchor to capture by cursor-parking (repeatable)")
    ap.add_argument("--landmarks", type=int, default=6)
    ap.add_argument("--seradex-version", default="")
    ap.add_argument("--notes", default="")
    args = ap.parse_args(argv)

    if not args.anchor:
        ap.error("capture at least one --anchor")

    print(f"Focus the {args.screen} window, then press Enter here.", flush=True)
    input()

    window = foreground_window_facts()
    print(f"  window : {window.title!r}")
    print(f"  class  : {window.class_name}")
    print(f"  rect   : {window.rect}")
    if args.title.lower() not in window.title.lower():
        print(f"  ! title does not obviously contain {args.title!r} - continuing anyway,"
              " but check you focused the right window.")

    image = grab(bbox=search_region(window.rect))
    stats = frame_stats(image)
    if stats.stddev_luma < 3.0:
        print("  ! frame is near-uniform; the session may be minimised. Aborting.")
        return 2

    lines = screen_text(image, origin=Point(*search_region(window.rect)[:2]))
    print(f"  OCR    : {len(lines)} text lines")

    proposals = propose_landmarks(lines, count=args.landmarks, region=window.rect)
    if len(proposals) < 3:
        print(f"  ! only {len(proposals)} usable landmarks found; need at least 3.")
        print("    Check Tesseract is installed and the form is fully visible.")
        return 2

    print("\nLandmarks selected:")
    for p in proposals:
        print(f"  {p.landmark.text!r:40} at ({p.landmark.point.x:.0f},"
              f"{p.landmark.point.y:.0f})  conf {p.confidence:.0f}")

    landmarks = [p.landmark for p in proposals]
    # The first landmark doubles as proof of identity: if it is missing at run
    # time, this is not the screen the profile describes.
    landmarks[0] = type(landmarks[0])(
        name=landmarks[0].name, text=landmarks[0].text,
        point=landmarks[0].point, required=True,
    )

    anchors: list[Anchor] = []
    print("\nNow park the cursor on each control and press Enter.")
    for name in args.anchor:
        input(f"  park on {name!r} -> ")
        time.sleep(0.15)  # let the hand settle after the keypress
        point = cursor_position()
        if not window.rect.contains(point):
            print(f"    ! ({point.x:.0f},{point.y:.0f}) is outside the window. Retry.")
            input(f"  park on {name!r} -> ")
            time.sleep(0.15)
            point = cursor_position()
        print(f"    {name} = ({point.x:.0f},{point.y:.0f})")
        anchors.append(Anchor(name=name, point=point))

    profile = CalibrationProfile(
        screen=args.screen,
        window_title_pattern=args.title,
        anchors=tuple(anchors),
        landmarks=tuple(landmarks),
        reference_window=window.rect,
        seradex_version=args.seradex_version,
        notes=args.notes,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    profile.save(args.out)
    print(f"\nWrote {args.out} - {len(anchors)} anchors, {len(landmarks)} landmarks.")
    print("Verify it with:  python tools/preflight.py --profile", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

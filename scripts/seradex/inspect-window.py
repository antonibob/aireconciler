"""Dump the UI Automation tree of a Seradex window.

Read-only: it inspects what is on screen and prints identifiers. It clicks
nothing, types nothing, and changes nothing.

    pip install pywinauto

    python inspect-window.py                 # list every open window
    python inspect-window.py "Invoice"       # dump the tree of a matching window
    python inspect-window.py "Invoice" > invoice-entry-tree.txt

Open the Seradex screen you want to automate FIRST, then run this against it.
The output is what element-based automation targets instead of pixels.
"""

import sys

try:
    from pywinauto import Desktop
except ImportError:
    sys.exit("pywinauto not installed. Run:  pip install pywinauto")


def list_windows() -> None:
    print("Visible top-level windows:\n")
    for w in Desktop(backend="uia").windows():
        try:
            title = w.window_text().strip()
        except Exception:
            continue
        if title:
            print(f"  {title!r}   [{w.element_info.control_type}]")
    print("\nRe-run with part of a title to dump that window's control tree.")


def dump(pattern: str, depth: int) -> None:
    wins = Desktop(backend="uia").windows(title_re=f".*{pattern}.*")
    if not wins:
        sys.exit(f"No window matching {pattern!r}. Run with no arguments to list them.")
    if len(wins) > 1:
        print(f"-- {len(wins)} windows matched; dumping each --\n")
    for w in wins:
        print(f"===== {w.window_text()} =====")
        # Prints auto_id, control_type, title and the exact pywinauto selector
        # for every control — the addresses automation should use.
        w.print_control_identifiers(depth=depth)
        print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        list_windows()
    else:
        dump(sys.argv[1], depth=int(sys.argv[2]) if len(sys.argv) > 2 else 8)

# Option 2 — the isolated runner

Goal: the watchdog keeps its 12s/invoice throughput while the desk stays usable.
The mechanism is not clever — it is a second Windows session, on a machine
nobody sits at, running its own RDP client into AppBox. `SendInput` there is
real input into a desktop with no human in it.

## Open questions to settle before building

These are commercial, not technical, and they gate the whole option. Nity can
answer both — they are in `outreach/01`.

1. **A Seradex user account for the bot.** The runner must log in as something
   like `svc-ap-bot`, never as a person. Two reasons, and the second is the one
   an auditor cares about:
   - A second concurrent session under Antonio's credentials will fight his own
     session for the Connection Broker's affinity.
   - Every invoice the bot enters must be attributable to the bot in Seradex's
     audit log. If machine-entered invoices are indistinguishable from
     hand-entered ones, the control environment is worse than before the
     automation existed.
2. **Licensing.** One more Seradex named/concurrent user, and one more RDS CAL.
   If Seradex charges per user, that cost is the price of option 2 and belongs
   in the comparison against option 1.

Least privilege: the bot account should be able to enter and approve AP
invoices and nothing else. It must not be able to release payments — those go
through the existing approval path (the Cash Position emails to Frank), and
keeping the bot out of it preserves segregation of duties for free.

## The machine

Any always-on Windows host works: a Hyper-V VM on an existing server, a cloud
VM with the FortiClient VPN, or a spare workstation. Requirements:

- FortiClient VPN + the `AppBox-Talius.rdp` connection
- Python 3.11+, `pillow`, `pytesseract`, and the Tesseract binary
- Enough resolution to show Vendor Invoicing without scrolling — capture at a
  fixed resolution and never change it

## The gotcha that breaks this setup, and how to avoid it

**A disconnected or minimised RDP session stops composing a desktop.** Screen
capture then returns a black frame, OCR finds nothing, and — if nothing is
checking — the run "succeeds" against an empty screen.

So the runner's own session must stay live and unlocked:

- Drive the runner through its **console** (Hyper-V VMConnect, vSphere console,
  iDRAC/iLO), not by RDP-ing into it. RDP-ing in and disconnecting is what puts
  the session into the broken state.
- If you must RDP into the runner, disconnect with
  `tscon <session-id> /dest:console` to redirect the session back to the
  console rather than leaving it disconnected.
- Disable the screensaver and lock timeout on the runner, and disable
  "minimize on disconnect" for the RDP client.

`guards.check_frame` and `guards.check_session` exist to catch every variant of
this anyway — but catching it is a refusal to work, so it is worth preventing.

### The security trade this forces

An always-unlocked session holding Seradex AP credentials is a standing risk,
and the mitigations are not optional:

- No inbound RDP to the runner except from an admin jump host
- Full-disk encryption
- The least-privilege bot account above
- The runner does nothing else — no browsing, no mail, no other apps

This trade is the honest cost of option 2 and should be stated to whoever signs
off, not buried.

## Bringing up the input layer

```bat
python -m pip install -r requirements.txt
python tools\capture_profile.py --screen vendor_invoicing ^
    --title "Vendor Invoicing" --out profiles\vendor_invoicing.json ^
    --seradex-version 6.4.145 ^
    --anchor po_field --anchor invoice_date_mm --anchor invoice_date_dd ^
    --anchor invoice_date_yyyy --anchor save_button --anchor approve_yes
```

That is the **last** cursor-park session. It records the anchors *and* the OCR
landmarks that let every later run find them again. Verify it:

```bat
python tools\preflight.py --profile profiles\vendor_invoicing.json --host AP-BOT-01
```

`preflight` prints every reason at once, which matters when you are diagnosing
across an RDP session and each round-trip is slow.

## Wiring it into the existing watchdog

`seradex_watchdog.py` currently focuses the window and uses fixed anchors.
Replace the fixed anchors with a per-invoice retarget, and gate the input:

```python
from seradex_ingress import (
    CalibrationProfile, Point, SessionPolicy, WindowPolicy, preflight, retarget,
    screen_text, search_region, describe,
)
from seradex_ingress.win32_adapters import (
    foreground_window_facts, frame_stats, grab, session_facts,
)

profile = CalibrationProfile.load("profiles/vendor_invoicing.json")
session_policy = SessionPolicy(allowed_hostnames=("AP-BOT-01",))
window_policy = WindowPolicy(title_pattern=profile.window_title_pattern)
last_injection = None   # time.monotonic() of the driver's last SendInput burst

def acquire_targets():
    """Locate the form, or refuse. Call once per invoice, before typing."""
    window = foreground_window_facts()
    image = grab(bbox=search_region(window.rect))
    lines = screen_text(image, origin=Point(*search_region(window.rect)[:2]))

    result = retarget(profile, lines, window_rect=window.rect)
    log.info(describe(result))
    targets = result.require()          # raises rather than guessing

    preflight(
        session_facts(last_injection), session_policy,
        frame_stats(image), window, window_policy,
        list(targets.all_points()),
    ).require("invoice entry")          # raises rather than typing blind

    return targets

targets = acquire_targets()
click(*targets.click_point("po_field"))
```

Two rules make this worth having:

- **Retarget once per invoice, not once per run.** The cost is one screenshot
  plus one OCR pass — against a 12s cycle, noise. The benefit is that a window
  moved between invoices is handled rather than fatal.
- **Update `last_injection` after every burst.** Without it the human-presence
  check falls back to a cold idle floor and cannot tell the driver from a
  person. See `guards.human_input_detected`.

## When the form changes

A Seradex upgrade that moves controls invalidates the anchors — OCR
re-registration recovers a moved *window*, not a redesigned *form*. The failure
is loud: `register` refuses on residual or outlier-fraction rather than typing
into the wrong place. Re-run `capture_profile.py` and bump `--seradex-version`.

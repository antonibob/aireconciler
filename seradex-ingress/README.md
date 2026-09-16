# seradex-ingress — AP invoice entry, input layer

Work on the Talius AP automation blocker: hands-free entry of vendor invoices
into Seradex Vendor Invoicing without taking over the operator's desk.

> **Note on this repository.** `aireconciler` is an unrelated Excel add-in. This
> directory is self-contained and imports nothing from it — it is parked here
> because it is the repo this work was scoped to. Lift it to
> `C:\Users\AntonioClair\seradex-ingress\` on the runner; nothing here depends
> on its location.

## What the problem turned out to be

Background input into a RemoteApp window cannot be made to work — not with a
better library. The local window is a bitmap surface belonging to `mstsc.exe`;
the ERP's actual controls live in the session on `Hosted05.AppBox.local` and
have no local handle. `PostMessage` has nothing to address, there is no
accessibility tree to read, and `SendInput` hijacks the desk precisely *because*
it is real input. Full reasoning in
[`docs/WHY_BACKGROUND_INPUT_CANNOT_WORK.md`](docs/WHY_BACKGROUND_INPUT_CANNOT_WORK.md).

That closes option 3 permanently and leaves two live paths:

| | Path | Status |
|---|---|---|
| **1** | Host-side import (kills UI automation entirely) | **Vendor request, not a build** — [feasibility](docs/OPTION1_HOST_SIDE_FEASIBILITY.md) |
| **2 + 4** | Isolated runner + self-calibrating OCR targeting | **Implemented here** — [runbook](docs/ISOLATED_RUNNER_RUNBOOK.md) |

Option 1 is the better outcome and costs two emails plus one read-only query, so
it runs in parallel — but it is Seradex's decision, and the 12s UI path already
works. Build option 2 while option 1 is in flight.

## What is in here

| Path | What it is |
|---|---|
| `docs/OPTION1_HOST_SIDE_FEASIBILITY.md` | The option 1 verdict, with the evidence behind it |
| `docs/outreach/` | Two ready-to-send emails: Nity, then Seradex |
| `sql/ap_import_discovery.sql` | Read-only: does an AP import path already exist? |
| `docs/ISOLATED_RUNNER_RUNBOOK.md` | Standing up the runner, and wiring this into the watchdog |
| `seradex_ingress/` | The input layer (below) |
| `tools/capture_profile.py` | The last cursor-park session you ever run |
| `tools/preflight.py` | "May the runner type right now?", with every reason at once |

## The input layer

**Targeting** — the calibration captured by cursor-parking is still good; what
goes stale is *where the form is*. So OCR does not locate every control from
scratch. It finds a handful of stable text landmarks, solves the transform
carrying them from their calibrated positions to their current ones, and pushes
every calibrated anchor through it. One over-determined fit with a measurable
residual, instead of a fragile per-field search.

- `geometry` — similarity fit, robust to a mis-matched landmark
- `ocr` — pytesseract word boxes grouped into positioned lines
- `registration` — landmark matching, the fit, and the confidence gate
- `calibration` — the profile, and the second estimate from window geometry
- `retarget` — screenshot text in, verified click targets out

**Guards** — three refusals, each for a specific way this goes wrong on a live
accounting form:

- `check_session` — running on a real desktop (would hijack it), or a human is
  typing in the runner's session right now
- `check_frame` — the session is minimised or disconnected, so capture is black
  and OCR verification would pass on nothing
- `check_window` — the foreground window is not Vendor Invoicing, so keystrokes
  land in whatever is

Two details worth knowing before trusting them:

- **`SendInput` resets the idle timer too**, so a naive idle check fires on the
  driver's own work. `human_input_detected` compares idle time against the time
  since the driver's own last burst — a human typing after us can only make idle
  time *smaller* than that gap.
- **Two independent estimators must agree.** OCR registration and window
  geometry are cross-checked at the anchors; disagreement beyond a few pixels
  fails the run rather than picking one. A small scale error is invisible at the
  window origin and large at the Save button, which is why they are compared
  where the anchors are.

There is no partial answer anywhere in this layer: it returns every coordinate,
or it returns reasons and none. A partially-correct coordinate set is how an
invoice gets typed into the wrong field.

## Tests

77 tests, no third-party dependencies, run anywhere:

```sh
python -m pytest tests/ -q
```

That the decision logic runs off Windows is the point — `win32_adapters` is the
only Windows-only module, and it contains no judgement, just ctypes. The tests
cover the failure modes rather than the happy path: black frames, wrong
foreground window, duplicate labels on the form, a landmark matched to the wrong
row, the required landmark absent (wrong screen), scattered landmarks that agree
on no transform, and the driver's own typing being mistaken for a human's.

## Status

- Implemented and tested: targeting, guards, capture and preflight tools
- Not yet done: wiring into `seradex_watchdog.py` (sketch in the runbook), and
  a first real profile capture — both need the runner and the live form
- Unverified: `seradex.com` is blocked by this session's egress policy, so the
  Seradex release notes behind the option 1 analysis were read only as far as
  search engines had indexed them

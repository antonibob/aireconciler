# Capturing a Seradex workflow so it can be automated

How to record invoice entry (or any workflow) in a form an agent can turn into
working automation — rather than into pixel-coordinate clicking, which is the
thing we're trying to get away from.

---

## Two inputs, not one

| Input | Gives you | Doesn't give you |
|---|---|---|
| **Screen recording** | the procedure: field order, what gets typed where, the gotchas, what the screen does in response | where any control actually *is*, in any durable sense |
| **UI Automation tree** (`inspect-window.py`) | the addresses: `auto_id`, control type, exact selectors | any idea of what the workflow means or what order things happen in |

Neither is sufficient. A recording alone yields coordinate automation. A control
tree alone yields a list of buttons with no notion of how to use them.

**Record the video for the procedure. Dump the tree for the addresses.**

---

## Step 1 — dump the control tree

Open the Seradex invoice entry screen, then:

```bat
pip install pywinauto
python scripts\seradex\inspect-window.py
```

That lists open windows. Find the Seradex one, then dump it:

```bat
python scripts\seradex\inspect-window.py "Invoice" > docs\seradex\invoice-entry-tree.txt
```

The script only reads. It clicks nothing and types nothing.

If a control shows a stable `auto_id`, that is its permanent address — resolution,
window size and scroll position stop mattering.

---

## Step 2 — record the workflow

Windows has a built-in recorder: **Win+G** (Game Bar) or any screen recorder.
Record one complete invoice, start to finish, in the **test company**
(`ActiveM_Talius_Test`) so nothing posts for real.

While recording, do these things — they're what make the video usable:

- **Narrate.** Say what you're doing and why. "This PO number comes off the
  vendor's invoice, top right." Thirty seconds of narration beats ten minutes of
  silent clicking.
- **Try it keyboard-only.** Tab between fields instead of clicking. If the whole
  form can be completed without the mouse, the automation becomes a keystroke
  sequence, which is the most robust target there is — no coordinates, no element
  lookup, nothing to break.
- **Call out the traps.** Fields that must be tabbed out of before another
  populates. Lookups that need an exact match. Anything where order matters.
  These are invisible in a recording and are what automation gets wrong.
- **Go slowly at decisions.** Where you pause to think, say what you're deciding
  between. That judgment is the part worth capturing.

---

## Step 3 — hand both to an agent

Video is not directly readable by the model, so frames get extracted first:

```bat
ffmpeg -i invoice-entry.mp4 -vf fps=1 frames/frame_%%04d.png
```

One frame per second is usually enough; raise it for fast typing. The agent
reads the frames as images, cross-references the control tree, and writes the
workflow up.

The prompt to give it is in the next section.

---

## The handoff prompt

> I'm automating invoice entry in Seradex, a Windows ERP client.
>
> You have two inputs:
> - `docs/seradex/frames/` — frames from a screen recording of me entering one
>   invoice by hand, with narration
> - `docs/seradex/invoice-entry-tree.txt` — the UI Automation control tree of
>   the invoice entry window, from `pywinauto`
>
> Write `docs/seradex/invoice-entry.md` documenting the workflow:
>
> 1. **The procedure** — every step in order, what goes in each field, where the
>    value comes from on the source invoice.
> 2. **The addresses** — for each field, the `auto_id` or selector from the
>    control tree. Where you cannot match a field in the video to a control in
>    the tree, say so explicitly rather than guessing.
> 3. **Keyboard path** — whether the form can be completed by keyboard alone, and
>    the exact tab order and accelerator keys if so. This is the preferred
>    automation target.
> 4. **Traps** — ordering dependencies, fields that trigger lookups, validation
>    that rejects input, anything that would break a naive replay.
> 5. **Open questions** — everything the video didn't make clear.
>
> Mark every inference as an inference. A wrong guess stated confidently is worse
> than a flagged gap, because it will be automated and then post real invoices.
>
> Do not write automation code yet. The document comes first, I review it, and
> the code is written from the corrected version.

---

## Why not just let a recorder generate the script?

Power Automate Desktop's recorder does exactly that, and it's worth trying —
it captures a workflow once and produces editable, element-based steps with no
code. For a straightforward form it may be all you need.

Where it falls short is judgment: it records that you typed `4010-00` in the GL
field, not that you chose `4010-00` *because* the vendor was a subcontractor.
Reconciliation work is full of that. The document above captures the reasoning;
the recorder captures the motions. Use both — recorder for a first draft of the
steps, document for what the steps mean.

---

## Rules while recording

- Use `ActiveM_Talius_Test`, not production
- If you must record in production, do not save, post, or approve — navigate and
  narrate only, then abandon the entry
- Don't record anything with banking details or credentials on screen; the frames
  end up in the repo

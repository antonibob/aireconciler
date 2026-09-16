# Why background input into RemoteApp fails — and what that rules out

This is the architectural reason behind three of the four blockers, and it is
worth stating plainly because it closes off a whole family of "try harder"
approaches permanently.

## The local window is a picture, not a control tree

A RemoteApp window on the workstation is one window belonging to `mstsc.exe`. It
paints a bitmap that the server sends. The Vendor Invoicing form's actual Win32
controls — the PO edit box, the segmented date fields, the Save button — exist
only in the session on `Hosted05.AppBox.local`. They have no window handle on
the local machine, because they are not local windows.

Everything follows from that:

| Symptom | Cause |
|---|---|
| `PostMessage` to the field "silently fails" | There is no field. The message reaches `mstsc.exe`, which has no idea what a `WM_SETTEXT` for an ERP textbox means and drops it. |
| No UIA / MSAA tree | There is nothing local to expose. The accessibility tree lives server-side. |
| Pixel coordinates are all you have | The bitmap is the only interface the client is given. |
| `SendInput` works but hijacks the desk | It works *because* it is real input: it goes to the RDP client, which forwards it over the wire as keyboard/mouse events. Real input is, by definition, the input the human is also using. |

## What this rules out

- **Any message-based automation from the client side.** Not with a better
  library, not with a different API. There is no target.
- **Option 3 (focus-lock tricks).** `AllowSetForegroundWindow`,
  `AttachThreadInput`, and the minimized-foreground tricks all manipulate *which
  window receives real input*. They cannot create a second, invisible input
  stream — the session has one input queue, and the human shares it. Best case
  these make focus-stealing more reliable; they never make it unobtrusive. Dead
  end, as suspected.

## What this leaves

Exactly two places where the problem becomes tractable:

1. **Server-side of the RDP boundary** — code running *inside* the AppBox
   session, where the controls are real and message-based automation or a
   supported import would work. Requires Seradex. This is option 1.
2. **A different physical input queue** — real `SendInput`, but in a session
   nobody is sitting at, forwarded over its own RDP connection. This is
   option 2, and it is the only one Talius can build alone.

Option 4 (OCR self-targeting) is not an alternative to these; it is what makes
option 2 maintainable, because on the far side of the RDP boundary a bitmap is
still all you get.

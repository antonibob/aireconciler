# Why invoice entry can't be automated the usual way

**Finding:** Seradex runs as a **RemoteApp** (RDP RAIL), not as a local
application. This rules out every element-based automation tool from the
workstation, and it is not a configuration problem — it is what RemoteApp is.

---

## The evidence

`inspect-window.ps1` against the Seradex windows returns two lines and no
controls:

```
===== Financials - Talius ~= New SQL Server =~ (Hosted05.AppBox.local) =====
Window | name='Financials - Talius ...' | autoId='' | class='RAIL_WINDOW' | enabled=False
  Window | name='Vendor Invoicing -  Version 6.4.145 - 90 Days (Default) ...' | autoId='' | class='RAIL_WINDOW' | enabled=True
```

The same script against Excel — a genuinely local application — returns
hundreds of elements with usable identifiers (`autoId='FileSave'`,
`autoId='D14'`, every cell individually addressable).

The tool is fine. `RAIL_WINDOW` is the window class Windows gives a RemoteApp
window, and what it contains is a bitmap streamed over RDP. There are no
controls on this machine to target.

SSMS carries the same class, so the whole working environment —  Seradex,
SQL Server, SSMS — lives on `Hosted05.AppBox.local`.

**Environment:** Seradex 6.4.145. The AP entry screen is titled
**"Vendor Invoicing"**.

---

## What this eliminates

| Approach | Status |
|---|---|
| `pywinauto` | **impossible** — no local controls |
| Power Automate Desktop (element mode) | **impossible** — same reason |
| UI Automation of any kind, from the workstation | **impossible** |

No tooling choice changes this. The controls are on the server.

---

## What still works

| Approach | Why it survives | Cost |
|---|---|---|
| **Automation run *inside* a full desktop session on the host** | it would be local *there*, so UIA sees everything | needs a full-desktop session, not just published apps |
| **Keystroke macro** (AutoHotkey) | keystrokes go to the focused window and travel over RDP like any typing | requires the form to be completable by keyboard |
| **Computer-use agent** | operates on pixels and synthetic input, which RemoteApp passes through | slowest, least reliable, needs a dedicated machine |
| **Writing to the database** | bypasses the UI entirely | no supported path — see `ap-data-model.md`; triggers make raw inserts unsafe |

---

## Open — answer these before building anything

- [ ] **Does AppBox offer a full desktop session?** One window is titled
      `Seradex AppBox : Full`, which hints at it. If a full desktop is
      available, run the automation there and every ruled-out option returns.
      This is the highest-value question on the page.
- [ ] **Can one invoice be entered in Vendor Invoicing using only the keyboard?**
      Tab, arrows, Enter, Alt-accelerators — no mouse. If yes, a keystroke
      macro is viable and is the cheapest real automation available. If no,
      the options collapse to a computer-use agent.
- [ ] Which fields need lookups that only populate after tabbing out — those
      break naive keystroke replay and need explicit waits.

---

## Note for anyone picking this up

Don't re-run element inspection hoping for a different result, and don't
install `pywinauto` — the constraint is architectural. Start from the two
questions above.

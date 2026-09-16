# Option 1 — host-side ingestion: feasibility

**Verdict: worth pursuing, but it is not a build — it is a vendor request, and
Talius cannot decide it unilaterally.** The AppBox host is Seradex's
infrastructure, not Talius's. Nothing can be installed on it, scheduled on it,
or inserted into its database without Seradex agreeing. So option 1 costs two
emails and one read-only query, and then it is out of Talius's hands.

That is precisely why it should be started now and run in parallel with
option 2, not ahead of it.

---

## 1. The host belongs to Seradex

| Evidence | Source |
|---|---|
| `admin@seradex.com` sends "Your Seradex AppBox password has been changed" | mailbox, 2026-03-30 |
| Alert mail Message-IDs end `@hosted05` — the ERP itself sends from that host | `Freight Invoice Breakdown Alert`, ongoing |
| `.rdp`: `workspace id:s:Hosted05.AppBox.local`, `use redirection server name:i:1`, `loadbalanceinfo:s:tsv://MS Terminal Services Plugin.1.QuickSessionCollection` | `AppBox-Talius.rdp`, fwd 2026-03-30 |
| Outages are announced and cleared by Talius's Business Systems Manager, who relays rather than fixes: "DBOX and AppBox should be fully functional now" | `Seradex Services Currently Unavailable`, 2026-07-09 |

Three consequences follow, and they are the whole feasibility answer:

1. **No agent, service, scheduled task, or file-drop watcher can be installed
   on the host.** That is Seradex's to grant.
2. **`loadbalanceinfo` means a Connection Broker picks the host.** Even if
   something were installed on Hosted05, there is no guarantee a session lands
   there tomorrow. Anything host-side has to be Seradex-operated to be durable.
3. **Direct SQL insertion is off the table as a primary path** — see below.

## 2. Why "just INSERT into the AP tables" is the wrong answer

SSMS being available makes this look easy. It is not, for a reason that has
nothing to do with access:

An ERP's AP subledger is not a table, it is the *output* of posting logic —
GL distribution, PO matching and receipt consumption, tax treatment, period
control, approval state, audit attribution. A raw `INSERT` produces rows that
look right and a subledger that no longer ties to its GL control account, with
no error at the moment of damage.

Talius's own mail shows OrderStream enforcing exactly these rules at the
application layer, not the table layer:

> "Both periods are closed in our ERP, and reopening either means unlocking
> activity already posted on top of the..." — year-end thread, 2026-09-09

> "Seradex won't allow us to unapprove the sales order in the first place to
> revise the order." — 2026-09-08

Those constraints live in the application. Writing under it discards them. The
only acceptable SQL-shaped path is inserting into a **staging table that a
Seradex-supported import job consumes** — which is a thing to ask for, not a
thing to discover.

## 3. There *is* a generic import layer — but the public evidence is order-side

Seradex's own technical release notes (the `AcctMaintenance.dll` series)
document a real, actively-maintained import framework:

- "the **API Import object** has been redirected to use the new back-end API
  Import object" (June 2024)
- "the ability to import any single **XML or JSON** order file"; "generic
  import handling for XML or JSON"
- a "**GenericFileSQL** import type"
- "**ImportOrder** TransactionType handling"

Every one of those names orders and estimates. **None of the indexed notes
mentions a vendor-invoice or AP-voucher import.** Likewise the only indexed
reference to batch processing is a "BatchTransactions table for the *offline
inventory* processor" — so the Batch Processor tile is probably an inventory
tool, not an ingestion path.

This is suggestive, not conclusive: `seradex.com` is blocked by this session's
egress policy, so the release notes and help pages could not be read in full —
only what search engines had indexed of them. Treat it as: *do not assume an AP
import exists, and ask using the exact object names above*, which is what the
drafted emails do.

## 4. The two questions that decide it

1. **Does the API Import object accept an AP vendor invoice**, or only sales-side
   documents? If yes, option 1 wins permanently and the UI driver is retired.
2. **What will Seradex permit on the host** — a watched folder, a staging table,
   a scheduled import, a web service endpoint? If the answer to (1) is yes but
   the answer to (2) is "nothing", the import still has to be triggered from
   inside a session, and that is option 2 wearing a better hat.

Ask both at once. `sql/ap_import_discovery.sql` answers a cheaper version of
(1) from Talius's side in about ten minutes, without waiting for a reply.

## 5. Cost and timing, honestly

Seradex is a paid vendor relationship — Talius pays them (`Seradex Web Services
Inc. — SERADEX 6,297.26` on the Sept 14 payment proposal), so there is a real
account to escalate through. Expect the answer to arrive as a
professional-services quote rather than a documentation link. Expect days to
weeks.

**Therefore: send the emails, then build option 2.** The 12s UI path already
works; what it lacks is the ability to run while the desk is in use, and that
gap closes with a VM, not with an email thread.

---

## Recommended sequence

| # | Action | Owner | Blocks on |
|---|---|---|---|
| 1 | Send `outreach/01-nity-appbox-host-access.md` | Antonio | — |
| 2 | Run `sql/ap_import_discovery.sql` (read-only) after Nity approves | Antonio | Nity's OK |
| 3 | Nity forwards `outreach/02-seradex-ap-import-api.md` to Seradex | Nity | (1) |
| 4 | Build the isolated runner (option 2 + 4) regardless | Antonio | — |
| 5 | If Seradex confirms an AP import, retire the UI driver | — | (3) |

Step 4 does not wait for steps 1–3, and steps 1–3 are not made redundant by
step 4. The UI driver is a bridge; an import path is the destination.

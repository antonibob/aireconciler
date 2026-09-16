# Email 2 — technical questions for Seradex

Send via Nity, or direct to the Seradex account contact once he identifies one.
The point of naming their own object names is to get past a first-line "no" —
these come from Seradex's published `AcctMaintenance.dll` technical release
notes, so the person reading will recognise them.

**Subject:** Talius — supported import path for AP vendor invoices (OrderStream 6.4.145)

---

Hello,

Talius is looking to automate entry of vendor AP invoices into OrderStream
(Vendor Invoicing, v6.4.145, hosted on AppBox). We currently key them by hand
and would like to move to a supported, non-UI import. Questions:

**1. AP vendor invoice import**
Your release notes describe an **API Import object** (redirected to the new
back-end API Import object), generic **XML/JSON** file import, a
**GenericFileSQL** import type, and **ImportOrder** TransactionType handling.
All the documentation we can find covers sales orders and estimates.

- Is there an equivalent import for **AP vendor invoices / payables vouchers**?
- If so, what TransactionType and schema does it expect, and is there a sample
  payload?
- Does it perform the same PO matching, tax, GL distribution and period
  validation as the Vendor Invoicing screen, or does it bypass any of it?

**2. Invocation**
If an AP import exists, how is it triggered on an AppBox-hosted tenant?

- a watched/drop folder on the host
- a scheduled job you would configure for us
- a callable web service or command-line entry point
- the **Batch Processor** tile (we see this in our session — is it applicable to
  AP, or is it the offline inventory processor only?)

**3. Staging tables**
If there's a supported staging table that an import job consumes, we'd like its
name and schema. To be explicit: we are **not** asking to insert directly into
the AP subledger tables — we understand that would bypass posting logic, and we
don't want invoices that don't tie to the GL control account.

**4. Commercials**
If any of the above is a professional-services engagement rather than
configuration, please quote it. We'd rather pay for a supported path than
maintain UI automation.

**5. If the answer is no**
If OrderStream has no AP import, please say so plainly — we'll plan around it,
and we'd like to know whether it's on the roadmap.

For context on volume and the current process, we're happy to get on a call.

Thanks,
Antonio Clair
Talius

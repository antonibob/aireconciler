# Email 1 — to Nityanand Rewankar (Business Systems Manager)

Nity administers DBOX and AppBox for Talius and is the escalation point to
Seradex ("Please contact me directly if you experience any issues",
2026-07-09). He is the right first call: he can answer the licensing and
account questions himself, and he owns the Seradex relationship for the
vendor-side ones.

**To:** nity@talius.com
**Subject:** Automating AP invoice entry — is there a host-side import path into Seradex?

---

Hi Nity,

I've built a tool that reads our vendor AP invoices out of PDFs and enters them
into Seradex Vendor Invoicing. It works end to end — about 12 seconds an
invoice — but it currently drives the RemoteApp window with simulated mouse and
keyboard, which means it takes over my desktop while it runs.

Before I invest further in that approach, I'd like to know whether there's a
supported way to get invoices in without driving the UI at all. Three questions,
in the order that matters:

1. **Does Seradex offer an AP/vendor-invoice import?** Their release notes
   describe an "API Import object" and generic XML/JSON import, but everything
   documented publicly is sales-order side. If there's an equivalent for AP
   vouchers, that would replace this whole approach. Could you ask Seradex, or
   put me in touch with whoever handles our account? I've drafted the technical
   questions and can send them over.

2. **What are we permitted to do on the AppBox host?** Specifically: a watched
   folder for import files, a staging table we could write to, or a scheduled
   import job. I assume the answer is "nothing without Seradex's agreement"
   since it's their infrastructure, but it's worth confirming what's in scope
   under our agreement.

3. **If we stay with UI automation**, I'd want to run it on a dedicated VM under
   its own Seradex login (something like `svc-ap-bot`) rather than my own — so
   the bot isn't competing with my session, and so machine-entered invoices are
   distinguishable from hand-entered ones in the audit trail. Two things I'd
   need from you:
   - a Seradex user account for it, with AP invoice entry only — explicitly
     *not* payment release, so segregation of duties is preserved
   - confirmation we have the licensing headroom (one more Seradex user, one
     more RDS CAL)

To be clear about the last one: I'm not asking for database write access or
anything that bypasses Seradex's posting logic. If there's no supported import,
the UI path is fine — I just want it running somewhere that isn't my desk.

Happy to demo the current version whenever it's useful.

Thanks,
Antonio

---
name: talius-po-receipt-match
description: >
  Scrape a payables mailbox folder of vendor invoices, pull the PO number and
  pre-tax total off each invoice PDF, then generate a self-contained T-SQL
  script that compares each invoice against what Seradex shows received on that
  PO, and interpret the result into an enter-now / approve-variance /
  blocked-on-receiving list. Use this whenever the user asks to compare invoices
  to POs, check what has been received against what was billed, work through a
  "POs awaiting receipt" or "awaiting approval" mail folder, find out which
  invoices are safe to enter or key into AP, scrape a mailbox folder for PO
  numbers, or build a three-way-match query against Seradex — even when they
  only say "give me the SQL", "which of these can I enter", or name a folder
  without saying what to do with it. Also use it when reading Talius AP
  invoices for amounts and PO numbers for any purpose, since the per-vendor
  extraction map here saves opening every PDF blind.
---

# Matching Talius invoices to Seradex receipts

The job has three stages: get the PO number and net amount off every invoice in
a mail folder, ask Seradex what it has received against those POs, then turn the
difference into a decision for each invoice. The third stage is where the value
is — a row that says "invoice is $448 over the PO" is noise until you can say
"$350 of unauthorised freight plus $98 of price drift".

## Stage 1 — read the folder

Read `references/mailbox-extraction.md` before touching the mailbox. It has the
M365 call shapes that actually work (several filter combinations are refused),
the two-step attachment read, and — most usefully — a per-vendor map of *where
the PO number sits on that vendor's invoice*. That map means you can go straight
to the right field instead of opening thirty PDFs blind.

Two things to carry forward from that stage:

- **Record the pre-tax subtotal, not the gross total.** You will compare against
  `PODetails.ExtendedCost`, which is pre-tax. Read the subtotal line off the PDF.
  Do not take the gross and divide by 1.05 — that only works when GST 5% is the
  only tax. Uline and Canevas LaSalle also charge PST, and freight is taxed too,
  so dividing gross by 1.05 produced a $34 error on a $568 Uline invoice. The
  subtotal is printed on the invoice; use it.
- **Keep the gross total as well**, in its own column. The user pays gross and
  will want to see it even though the match runs on net.

Some vendors send PDFs the connector cannot open (they arrive as
`application/octet-stream`). Those invoices still get a row: PO number from the
subject line, amount NULL. The script reports PO state for them, which is often
enough to act on, and the verdict ladder has a bucket that says plainly that the
amount could not be read. Never guess an amount to fill the gap.

## Stage 2 — generate the SQL

Copy `references/sql-template.sql` and replace the driver `VALUES` list with the
invoices you extracted. Read `references/seradex-schema.md` first for the
verified column names and the columns known to fail.

Four constraints on the file, all learned the hard way:

- **No temp tables, no scalar variables, no block comments, CRLF endings.**
  Scripts that use `#temp` or `DECLARE` have come back with errors describing
  text that was never in the file (`Invalid object name '#Match'` for a table
  created three statements earlier; `Database 'only' does not exist`). The file
  is being mangled somewhere between here and SSMS. Independent, self-contained
  statements survive that; stateful ones do not.
- **Repeat the driver list in each statement that needs it.** Verbose, but it is
  what keeps each statement independent.
- **Never invent a column name.** The schema reference lists what is confirmed
  and what has already failed. If you need a column that is not on the list, say
  so and ask, or leave it out — a wrong guess costs the user a round trip to SSMS.
- **The verdict `CASE` must be exhaustive and end in `ELSE '9 LOGIC GAP'`.** An
  earlier version fell through to NULL for exactly the rows that mattered: PO
  found, invoice not yet entered. A labelled logic gap is debuggable; a blank is not.

Deliver the script as a file with `SendUserFile`. Do not paste SQL into chat —
the user runs it in SSMS and wants something to open, not something to reassemble.

## The verdict ladder

Order matters: each test assumes the ones above it already failed. Numbering the
strings makes `ORDER BY verdict` sort actionable rows to the top.

| Verdict | Means | Action |
|---|---|---|
| `0 ALREADY ENTERED IN AP` | invoice number already in `POInvoicing` | Entry is done. If the vendor is chasing it, that is a **payment** problem, not an entry problem — say so. |
| `1 RECEIVED = INVOICE` | net ties within a cent | Enter it. |
| `1 RECEIVED OVER INVOICE` | PO received exceeds the bill | Enter it; usually a partial bill against a larger PO. |
| `2 PO FULLY RECEIVED BUT INVOICE EXCEEDS PO` | everything landed, bill is higher | Price or freight variance — decompose it before approving. |
| `3 RECEIVED SHORT` | receiving incomplete | Chase the warehouse, not the vendor. |
| `4 NOTHING RECEIVED YET` | PO has no receipts | Cannot enter. Still check the amount against the PO now, so a variance is raised before goods land. |
| `5 PO FOUND, INVOICE AMOUNT NOT READABLE` | PDF unreadable | Report the PO state; ask the user to eyeball the total. |
| `6 PO NOT FOUND IN SERADEX` | PO quoted does not exist | Suspect a vendor typo before concluding the PO is missing. |
| `7 NO PO ON INVOICE` | no PO quoted | Card purchases and shop stock. Route by coding, not by PO. |
| `8 CREDIT MEMO` | negative | Not a payable. Check what it offsets. |

## Stage 3 — interpret, don't just report

Group the output by what the user has to *do*, not by verdict code: enter now,
approve a variance, already handled, blocked on receiving, not PO-based. Give
the net and gross subtotal of each group.

Then do the work that makes the report worth reading:

**Decompose every variance into named parts.** Pull the PO line detail and the
invoice's own line list side by side. A gap is almost always a sum of distinct
causes, and each one has a different owner. Two Richelieu invoices on one PO
over-billed by $448.38, which resolved exactly into $350.00 of freight that was
not on the PO at all plus $98.38 of unit-price drift. The first is a question for
the vendor; the second is a price-list update. An undecomposed "$448 over" is not
actionable.

**Compare the same part across invoices.** Billing errors show up as one SKU at
two prices. A SUNTEX95 roll billed at $1,320.10 on one invoice and $1,264.30 on
another eleven days later — matching the PO both times but once — is a vendor
keying error worth $55.80, and you only see it by reading across rows.

**Read `qty_invoiced_to_date` against `QtyToBuy` per line.** It tells you a PO
has been part-billed before, so the invoice in front of you should match the
*remaining balance*, not the whole line. One BC Fasteners line had 516 of 1,000
already invoiced; the right comparison was against the 484 left, not the 1,000.

**Treat "balance due 0.00" on a PDF as paid-but-not-entered.** It still needs
keying and matching to the payment. It must not go in a pay run.

**Check whether a line was already invoiced under a different number.** If every
line on a PO shows fully invoiced but the invoice number is not in `POInvoicing`,
the bill went in under another reference. Find it before entering a duplicate.

## State the proxy's limits every time

The received figure is a proxy: it counts a PO line's whole `ExtendedCost` as
soon as that line has any receipt at all. Where every line is fully received it
is exact. Where a line is **part-received by quantity** it overstates, and you
cannot fix it by prorating, because `QtyToBuy` is in purchase units while
`QtyReceivedToDate` is in stock units — the ratio is meaningless.

So before writing the summary, scan the line detail for rows where
`QtyReceivedToDate` differs from `QtyToBuy`, and name those POs as unreliable.
In the run this skill came from, exactly two of twenty-five POs were affected
(266 of 1,007 and 171 of 1,007 received). Saying which two, and why, is more
useful than a caveat about the method in general — and far better than letting
the user trust a number that is wrong.

Flag UOM errors you trip over while you are in there: a line with `QtyToBuy` 1
and `QtyReceivedToDate` 20 will not block entry if the money ties, but it will
distort any quantity report later.

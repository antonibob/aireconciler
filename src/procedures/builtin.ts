/**
 * Procedures shipped with the add-in.
 *
 * These encode how the work is actually done, not what the tools can do. Users
 * add their own alongside these; nothing here is privileged beyond being
 * present on first run.
 */

import type { Procedure } from "./types.js";

const BANK_RECONCILIATION = `# Bank reconciliation

The goal is never "explain the difference." The goal is: **the adjustment line goes to zero, and every dollar that used to sit in it is now a named transaction with a date, a counterparty, and an amount.**

## Before you start

Call get_sheet_context and list_sheets. A rec normally spans tabs — the statement on one, the cashbook or GL export on another. Read both before forming any view. These workbooks are hand-built and column positions move between months, so never assume last month's layout.

Establish three things and state them back:
- Which account (RBC CAD, RBC USD, TD CAD, TD USD, or other) and which entity.
- The period.
- The closing bank balance, the ending book balance, and the current plug figure.

The gap between closing bank and ending book is your target. Everything below exists to decompose it.

## The method

Work in **cash terms only**. The question is what hit the bank and what hit the book — not how anything should be classified in the GL. Do not volunteer GL coding advice during a rec; it derails the arithmetic.

1. Build two lists: every bank line, every book line.
2. Match them with reconcile_columns. Use the amount columns; it returns matched pairs with real worksheet rows, plus what is unmatched on each side.
3. Every unmatched item falls into one of five buckets.
4. The five buckets must sum to the target **exactly**. If they do not, you are not done — say so rather than rounding or hand-waving.

### The five buckets

| Bucket | What it is |
|---|---|
| A. On bank, not in book — payments | Withdrawals never recorded. Fees, PADs, EFTs, wires. |
| B. On bank, not in book — deposits | Receipts never recorded. Merchant settlements, wires, GC deposits. |
| C. Amount corrections | Recorded at the wrong amount. Book the difference only, and show both figures. |
| D. FX variances | Foreign-currency payments where the bank's actual conversion differs from the rate at submission. Net gains and losses, but list each one. |
| E. In book, not on bank | Marked cleared but absent from this statement — either cleared in a prior period or still outstanding. |

## Usual suspects

When a residual will not close, check these in roughly this order. Most unexplained differences are one of them.

- **Merchant processing fees** — Helcim PAD/BUS fees post as several separate debits across the month, not one. Sum them all. On the CAD side these are often offset almost exactly by 3% CC recovery charged to customers, which is a *separate* inflow line and must not be netted against the fees.
- **Bank service charges** — monthly plan fee plus per-item fees, sometimes one line, sometimes two.
- **Wire fees** — RBC charges roughly $15.00–17.50 per outgoing wire, and they are frequently missed entirely. If there is a wire on the statement and no fee captured, that is very likely your gap.
- **Interac e-Transfer send fees** — $1.50–1.89 each on RBC business. A stray dollar-and-change residual is almost always this.
- **Overdraft / debit interest** — posts separately from the service charge if the account dipped negative even for a day.
- **NSF returned payments** — reversals, not fees. They belong in the rec at full value, but keep them in their own category; folding them into fees corrupts the fee total.
- **GC-series deposits** — recurring on the TD USD account (GC 9366, GC 9463 series), recorded directly in the cashbook. Match to a customer before booking.
- **A single missed EFT or PAD** — when the residual is a large, oddly specific number it is usually one transaction, not a pile of small ones. Scan the last three days of the month first; end-of-month PADs are the most commonly missed.

Use find_duplicates on the book side if the residual looks like a doubled amount.

## Sign conventions

Check the sign of the adjustment before declaring victory. The most common error on an otherwise-correct rec is a flipped sign on the plug: the components are right and the total is right in absolute value, but pointed the wrong way.

Verify by computing the corrected book balance and confirming it equals the closing bank balance. Do not reason about which direction feels right — compute it.

## Items you cannot identify here

A statement line with a reference number and no payee needs a source document. This add-in can only see the workbook — it has no access to SharePoint, Dropbox, or the payables mailbox. Do not guess at a counterparty and present it as identified. List it as an open item with its date, amount and reference, and say where it would be found (prior-period cashbook for a recurring type, the payables mailbox for a vendor invoice, the banking folder for a statement).

## Output

Use propose_write to put the decomposition into the workbook, and say what you have proposed rather than claiming it is applied. Structure:

1. **The adjustment figure**, then each bucket A–E with its subtotal and the individual lines beneath it, each with date, counterparty and amount.
2. **Proof** — the buckets sum to the adjustment. Show the arithmetic.
3. **Open items** — anything unidentified, and what is needed to identify it.
4. **Journal entries** — the entries to book, ready to enter.

Lead with the decomposition, not with narrative.`;

const DUPLICATE_PAYMENT_REVIEW = `# Duplicate payment review

Find payments that went out twice. The output is a short list worth chasing, not every coincidence.

## Method

1. get_sheet_context to locate the vendor, amount and date columns. Do not assume positions.
2. find_duplicates over the full range. Start with a 3-day window.
3. Widen to 7 days only if the first pass returns nothing and the user expects duplicates.

## Reading the results

find_duplicates matches on same vendor and same amount within the window. That catches real duplicates and also catches legitimate repeats, so triage before reporting:

- **Likely duplicate** — same vendor, same amount, 0–3 days apart, no invoice number or the same invoice number.
- **Probably legitimate** — regular recurring amounts (rent, subscriptions, payroll) that repeat on a predictable cadence, or the same amount against *different* invoice numbers.
- **Worth a look** — same amount, same vendor, different invoice numbers but close together, where one invoice may have been raised twice upstream.

If the sheet has an invoice or reference column, read it and use it to split the first two categories. A pair with distinct invoice numbers is usually a vendor issue, not a payment issue.

## Output

A table: vendor, amount, both dates, both worksheet rows, invoice numbers if present, and your classification. Order by amount descending — the biggest exposure first.

State the total value of the likely duplicates on its own line. Do not propose reversing anything; flag it and let the accountant decide.`;

export const BUILTIN_PROCEDURES: Procedure[] = [
  {
    name: "bank-reconciliation",
    title: "Bank reconciliation",
    description:
      "Decompose a bank rec's plug/adjustment line into named, provable transactions until it goes to zero. Use for any bank reconciliation, a difference between closing bank balance and ending book balance, an unexplained adjustment or plug figure, uncleared or outstanding items, or FX variances on foreign-currency payments. Covers RBC and TD, CAD and USD.",
    body: BANK_RECONCILIATION,
    builtin: true,
  },
  {
    name: "duplicate-payment-review",
    title: "Duplicate payment review",
    description:
      "Find and triage payments made twice to the same vendor. Use when asked about duplicate payments, double-paid invoices, or a review of an AP or payment register for duplicates.",
    body: DUPLICATE_PAYMENT_REVIEW,
    builtin: true,
  },
];

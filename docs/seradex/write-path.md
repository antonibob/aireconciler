# What Seradex writes when you save a vendor invoice

Established by before/after snapshot around a real entry in **production**
(`ActiveM_Talius`), 2026-09-22.

Server-level permissions are denied on this login (`VIEW SERVER STATE`), so the
SQL statements themselves cannot be observed — no plan cache, no Extended
Events, no Profiler. This was derived by photographing the affected rows either
side of one manual entry.

---

## The test case

ADAM Integrated Industries invoice `20917 M26-12373`, dated 2026-09-16,
against `PO260609`.

Pre-flight matched to the penny before entry:

| PODetailID | Qty | Unit cost | Extended |
|---|---:|---:|---:|
| 59774 | 800 | 4.40 | 3,520.00 |
| 59772 | 100 | 3.82 | 382.00 |
| 59771 | 100 | 3.46 | 346.00 |
| 59770 | 100 | 3.06 | 306.00 |
| 59769 | 100 | 2.85 | 285.00 |
| 59773 | 25 | 3.96 | 99.00 |

Subtotal 4,938.00 · GST 246.90 · Total 5,184.90 — agreeing with the vendor
invoice on every line.

---

## What changed on save

| Table | Before | After | Change |
|---|---:|---:|---|
| `POInvoicing` | 14,235 | 14,236 | **+1** header |
| `POInvoicingDetails` | 39,826 | 39,832 | **+6** lines |
| `GLJournalEntry` | 32,666 | 32,667 | **+1** |
| `ReceivingDetails.ysnInvoiced` | 0 × 6 | 1 × 6 | flag set |
| `ReceivingDetails.QtyInvoicedToDate` | 0 | 100,100,100,100,25,800 | quantities set |
| `PODetails.QtyInvoicedToDate` | 0 | same quantities | quantities set |

So one save touches **five tables**: two inserted into, three updated.

---

## The finding that matters

**A GL journal entry row is written at save time, not at Day End.**

A previous session concluded the GL was deferred until Day End Processing,
based on `GLPostedDate` being NULL. The row count proves otherwise: the entry
is *created* on save and Day End presumably *posts* it (assigns the number,
sets the posted date). Those are different operations.

Consequence for any direct-SQL insert route: writing `POInvoicing` and
`POInvoicingDetails` without the corresponding `GLJournalEntry` would produce
AP rows with no journal entry behind them. The subledger and the GL would
diverge silently until someone reconciled them.

`GLJournalEntryDetails.TaxFiledPOInvoicingID` references `POInvoicing`, which
is the link back from the journal entry to the invoice.

---

## Traps confirmed along the way

**Units differ between columns.** On `PO260619`, `QtyToBuy = 2` while
`QtyReceivedToDate = 40` — purchase units versus stock units, with
`ExtendedCost = UnitCost × QtyToBuy`. `PO260609` happens to have them equal,
which would hide the problem if it were the only case examined.

**Invoiced state is tracked in three places:** `PODetails.QtyInvoicedToDate`,
`ReceivingDetails.QtyInvoicedToDate`, and `ReceivingDetails.ysnInvoiced`. The
first is the duplicate guard — a PO line with `QtyInvoicedToDate = 0` has not
been billed. All three must be maintained together.

**Columns that exist but are unused.** On `PO260619`'s lines,
`PriceInvoiced = 0` and `InvGLAccountID` is NULL while `ExtendedPrice` and
`TotalTaxes` carry the real figures, and `PPVGLAccountID` is populated even
with zero variance. Presence of a column says nothing about whether the
application uses it.

---

## Still unknown

- [ ] What the `GLJournalEntry` row contains — posted or pending, and whether
      its detail lines carry the debits and credits
- [ ] Whether `GLJournalEntryDetails` gains rows on save, and how many
- [ ] What Day End Processing changes afterwards
- [ ] Whether a partial invoice (billing some lines, not all) behaves the same
- [ ] Vendor balance: is it stored anywhere, or derived?

Any insert route needs all of these answered first. The snapshot method in
`21-snapshot-diff.sql` answers each of them the same way, one entry at a time.

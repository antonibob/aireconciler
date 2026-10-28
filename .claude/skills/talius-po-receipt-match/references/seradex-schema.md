# Seradex AP schema — what is confirmed

Server `HOSTED05\SQL19`, database `ActiveM_Talius` (production) or
`ActiveM_Talius_Test`. Seradex ERP 6.4.145 on SQL Server 2019,
**compatibility level 150** — modern T-SQL (CTEs, window functions, `APPLY`,
`VALUES` constructors) is fully supported.

That last point is worth stating because it has been misdiagnosed before: when a
script came back with every `APPLY` alias rejected, the compatibility level was
blamed and the script needlessly rewritten in SQL-2000 syntax. A diagnostic
proved compat 150. The real cause was the file being mangled in transit. Keep a
`SELECT @@VERSION, DB_NAME(), compatibility_level` statement at the top of every
script so this is never guessed at again.

## The AP chain

```
Vendors ──> PO ──> PODetails
                     │
Receiving ──> ReceivingDetails
                     │
POInvoicing ──> POInvoicingDetails ──> POInvoicingPayments
                                            │
                         POInvoicingPaymentDetails
```

`POInvoicingDetails` is the three-way match on one row: `PODetailID` (ordered),
`ReceivingDetailID` (received), `POInvoicingID` (billed). Seradex performs the
match itself and stores the result, so it does not have to be reconstructed.

## Confirmed columns

Verified by use against the live database.

| Table | Columns |
|---|---|
| `Vendors` | `VendorID`, `Name` |
| `PO` | `POID`, `PONo`, `VendorID` |
| `PODetails` | `PODetailID`, `POID`, `QtyToBuy`, `QtyReceivedToDate`, `QtyInvoicedToDate`, `UnitCost`, `ExtendedCost` |
| `POInvoicing` | `POInvoicingID`, `InvoiceNo`, `OrigInvoiceNo`, `InvoiceDate`, `SubTotal`, `TotalTaxes`, `Freight`, `DiscountAmt`, `VendorID`, `RemitToVendorID`, `DateCreated`, `UserCreated` |
| `POInvoicingDetails` | `POInvoicingDetailID`, `POInvoicingID`, `PODetailID`, `ReceivingDetailID`, `ExtendedPrice`, `PriceVar` |
| `POInvoicingPaymentDetails` | `POInvoicingID`, `CreditPOInvoicingID`, `PaymentAmount` |

## Columns that do NOT exist — these have already failed

Do not reach for them again:

- `PODetails.QtyOrdered` — use `QtyToBuy`
- `PODetails.LineNo`, `PODetails.PartNo`
- `GLAccounts.GLAccountNo`, `GLAccounts.Description`
- `Vendors.VendorNo` — appears in the data-model notes but has not been
  confirmed in a query; leave it out unless you verify it first
- `PODetails.PartNumber`, `PODetails.Description` — same: documented, unverified

When a column you want is not on the confirmed list, either leave it out or run
a one-line catalog query first. A guessed name costs the user a round trip.

## No stored invoice total

`POInvoicing` has no `Total` column. Compute it:

```sql
inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt
```

This has been verified against the sum of line `ExtendedPrice` for all but one
of ~14,000 invoices (the exception is a payroll record, not a vendor bill).

`POInvoicing` also carries VISA statements, GST remittances and payroll, not
just vendor bills, and `POInvoicingTypes` does not distinguish them. Do not
assume every row is a purchase invoice.

## Compare on net, never on gross

`PODetails.ExtendedCost` and `POInvoicingDetails.ExtendedPrice` are **pre-tax**.
Seradex computes tax itself from each line's `TaxGroupID`, and its answer can
differ from what the vendor charged. Comparing tax-inclusive totals therefore
invents variances that are not real. Match net; once net ties, tax is Seradex's
problem.

## The received-value proxy, and why it is only a proxy

There is no stored "value received" on a PO. The workable approximation:

```sql
SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN pod.ExtendedCost ELSE 0 END) AS received_net,
SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN 0 ELSE 1 END)                AS lines_not_received,
SUM(pod.ExtendedCost)                                                      AS po_net
```

This counts a line's **whole** extended cost as soon as the line has any
receipt. It is exact when every line is fully received, and it overstates when a
line is part-received.

It cannot be fixed by prorating `QtyReceivedToDate / QtyToBuy`, because the two
columns use different units — `QtyToBuy` is in purchase units, and
`QtyReceivedToDate` in stock units. The ratio is not a fraction of anything.
Real lines have shown `QtyToBuy` 1 against `QtyReceivedToDate` 20.

So always scan the line detail for `QtyReceivedToDate <> QtyToBuy` and name
those POs as unreliable in the write-up. In practice very few rows are affected,
which makes naming them cheap and far better than a blanket caveat.

If you need a true received value, `ReceivingDetails` is the correct source and
`POInvoicingDetails.ReceivingDetailID` the documented link — but the join column
from `ReceivingDetails` back to `PODetails` has **not** been verified. Confirm it
before relying on it, and keep the proxy as the fallback.

## Invoice-number matching

Vendors and keyers punctuate differently (`ON-714692` vs `ON714692`,
`4274237` vs `4274237 `). Normalise both sides before comparing:

```sql
REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(x),
  ' ',''),'-',''),'/',''),'.',''),'#',''),'_','')
```

Group `POInvoicing` by that normalised key so a duplicate invoice number does
not multiply rows in the match.

Watch for the **booked-by-name pattern**: invoices keyed with a reference like
`PO260630_1` and no `PODetails` link. The PO then reads as uninvoiced forever,
and a naive check will tell you to enter a bill that is already in.

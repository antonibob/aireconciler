# Seradex AP data model — working notes

Established by catalog queries against `ActiveM_Talius_Test` on `HOSTED05\SQL19`.
Row counts are from the test copy and indicate relative scale, not production
figures.

**Confidence:** table roles below are inferred from names, columns and row
counts. Nothing here has been confirmed by sampling actual rows yet — treat
every join as a hypothesis until checked.

---

## The AP chain

```
Vendors ──┬─> PO ──> PODetails
          │    │
          │    ├─> Receiving ──> ReceivingDetails
          │    │
          │    └─> POInvoicing ──> POInvoicingPayments
```

| Table | Rows (test) | Role | Vendor link |
|---|---:|---|---|
| `Vendors` | 1,445 | vendor master | `VendorID`, `VendorNo` |
| `PO` | 7,042 | purchase order header | `VendorID`, `ShipToVendorID`, `VendorShipFromID` |
| `PODetails` | 33,502 | PO lines | `ItemVendorNumber` |
| `Receiving` | 8,063 | goods receipt header | `VendorID`, `FreightVendorID`, `VendorRMANo` |
| `ReceivingDetails` | 32,331 | receipt lines | `ItemVendorNumber` |
| **`POInvoicing`** | **13,963** | **vendor invoices (AP)** | `VendorID`, `RemitToVendorID` |
| `POInvoicingPayments` | 3,630 | payments applied to invoices | `VendorID` |

This is the standard **three-way match**: what was ordered (`PO`), what arrived
(`Receiving`), what was billed (`POInvoicing`). Reconciliation lives in the gaps
between the three.

---

## What is *not* AP

| Table | Rows | Actually |
|---|---:|---|
| `Invoice` | 31,852 | **AR** — has `CustomerID`, `TermsCodeID`, `Approved` |
| `InvoiceDetails` | 108,050 | AR invoice lines |
| `InvoicePaid` | 65,257 | AR receipts |
| `_APInvoice` | 519 | interop/export table — column names contain spaces (`Invoice No`, `Balance Owing`) and amounts are `float`. Built to hand data to another system, not a core table. |
| `_ARInvoice` | 382 | same, AR side |

The `_` prefix marks interop/working tables (cf. `_TempCustomers`, `_Freight`,
`_Customers`). Don't read or write them as though they were the source of truth.

---

## Entry path: there isn't a supported bulk one

Checked and ruled out:

- **Stored procedures** — only 28 in the whole database, none for invoice or AP
  writes. The client sends inline SQL, so there is no documented proc to call.
- **`ImportDef`** — not an invoice importer. Columns `AccountingSystemType`,
  `CustQuery`, `VendQuery`, `EdiTypeID`: it syncs customer/vendor *master data*
  with an external accounting system.
- **`AppIntegrationImportQueries`** — a generic SQL-driven import engine, but
  configured entirely for **BOMs** (`AppIntegrationBOMs`, subassemblies, labour).
- **`ImportOrder` / `ImportOrderBatch` / `ImportOrderDetails` /
  `ImportOrderPropertyDetails`** — a real staging pipeline with batch, header,
  detail and error flags (`Processed`, `HasError`, `Completed`) — but for
  **sales orders**, not AP.

So Seradex has import machinery, and none of it points at AP invoices.

**Triggers rule out raw inserts.** `trg_Invoice_Approval`, `InvoicePaidAudit`,
and triggers on `InvoiceDetails` mean approval and audit logic lives in the
database. Writing rows directly would fire that logic unexamined or bypass it.

Remaining options for entry, in order of preference:
1. A Seradex import screen in the UI that we haven't found — check the menus.
2. Keyboard-only entry replayed as a keystroke sequence (no coordinates).
3. Element-based automation via UI Automation identifiers.
4. Reproducing the client's inline SQL, learned from a trace. Most powerful,
   least supported, breaks on upgrade.

---

## Reading is unblocked, and reading is most of the value

The reconciliation this project exists to do — matching vendor statements to
invoices, tying payment batches out, finding what a payment covered — needs only
`SELECT` against the seven tables above. No entry automation is required for any
of it.

---

## Next

- [ ] Sample `POInvoicing` and confirm which columns hold invoice number, date,
      net, GST, total, and the link back to `PO`
- [ ] Confirm the `PO` ↔ `POInvoicing` join key (`POID`? `PONo`?)
- [ ] Confirm how `POInvoicingPayments` applies to invoices, and whether one
      payment can span several
- [ ] Determine where GST sits — line level, header level, or a tax table
- [ ] Check `zzBuyItemImport` (1,607 rows, mentions "Primary Vendor Accounting
      AP Code") — probably item master, confirm and dismiss

/* Every vendor invoice billed against a PO, with net / tax / total.
   Read-only.

   This is the Somfy tie-out done in SQL: given PO260514, what was invoiced?

   ASSUMPTIONS — verify before trusting the numbers:
     * PODetails.POID is the link from a PO line to its header
     * invoice total = SubTotal + TotalTaxes + Freight - DiscountAmt
       (POInvoicing has no stored Total column; run 12-verify-totals.sql
        against known invoices before relying on this)

   All money columns in this schema are FLOAT. They are cast to decimal before
   arithmetic so sums are exact to the cent rather than binary-approximate. */

USE ActiveM_Talius_Test;

DECLARE @PONo varchar(50) = 'PO260514';   -- <<< change this

SELECT DISTINCT
    po.PONo,
    v.Name                                        AS vendor,
    inv.InvoiceNo,
    inv.OrigInvoiceNo,
    inv.InvoiceDate,
    CAST(inv.SubTotal    AS decimal(19,4))        AS net,
    CAST(inv.TotalTaxes  AS decimal(19,4))        AS tax,
    CAST(inv.Freight     AS decimal(19,4))        AS freight,
    CAST(inv.DiscountAmt AS decimal(19,4))        AS discount,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight
         - inv.DiscountAmt AS decimal(19,4))      AS total
FROM PO po
JOIN PODetails           pod ON pod.POID          = po.POID
JOIN POInvoicingDetails  pid ON pid.PODetailID    = pod.PODetailID
JOIN POInvoicing         inv ON inv.POInvoicingID = pid.POInvoicingID
JOIN Vendors             v   ON v.VendorID        = inv.VendorID
WHERE po.PONo = @PONo
ORDER BY inv.InvoiceDate, inv.InvoiceNo;

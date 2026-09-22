/* Sanity-check the assumed invoice total formula before anything relies on it.

   POInvoicing stores no Total column, so we assume:
       total = SubTotal + TotalTaxes + Freight - DiscountAmt

   Two ways to test it:
     1. Does the header SubTotal equal the sum of its lines' ExtendedPrice?
     2. Does a fully-paid invoice's total equal what was paid against it?

   Any row that fails means the formula is wrong or a component is missing
   (CostMisc is a candidate). Fix it here before using 10- or 11-. */

USE ActiveM_Talius_Test;

/* ---- 1. Header SubTotal vs sum of line ExtendedPrice ------------------- */
SELECT TOP 25
    inv.InvoiceNo,
    CAST(inv.SubTotal AS decimal(19,4))                  AS header_subtotal,
    CAST(SUM(pid.ExtendedPrice) AS decimal(19,4))        AS sum_of_lines,
    CAST(inv.SubTotal - SUM(pid.ExtendedPrice) AS decimal(19,4)) AS difference
FROM POInvoicing inv
JOIN POInvoicingDetails pid ON pid.POInvoicingID = inv.POInvoicingID
GROUP BY inv.InvoiceNo, inv.SubTotal
HAVING ABS(inv.SubTotal - SUM(pid.ExtendedPrice)) > 0.005
ORDER BY ABS(inv.SubTotal - SUM(pid.ExtendedPrice)) DESC;
/* Rows here = the header is not simply the sum of its lines. */

/* ---- 2. Assumed total vs what was actually paid ------------------------ */
SELECT TOP 25
    inv.InvoiceNo,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight
         - inv.DiscountAmt AS decimal(19,4))             AS assumed_total,
    CAST(SUM(pay.PaymentAmount) AS decimal(19,4))        AS paid,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt
         - SUM(pay.PaymentAmount) AS decimal(19,4))      AS difference
FROM POInvoicing inv
JOIN POInvoicingPaymentDetails pd  ON pd.POInvoicingID       = inv.POInvoicingID
JOIN POInvoicingPayments       pay ON pay.POInvoicingPaymentID = pd.POInvoicingPaymentID
GROUP BY inv.InvoiceNo, inv.SubTotal, inv.TotalTaxes, inv.Freight, inv.DiscountAmt
HAVING ABS(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt
           - SUM(pay.PaymentAmount)) > 0.005
ORDER BY 4 DESC;
/* Partial payments legitimately appear here. A consistent offset across many
   invoices means the formula is missing a component. */

/* Sanity-check the assumed invoice total formula before anything relies on it.

   POInvoicing stores no Total column, so we assume:
       total = SubTotal + TotalTaxes + Freight - DiscountAmt

   Two ways to test it:
     1. Does the header SubTotal equal the sum of its lines' ExtendedPrice?
        VERIFIED: holds for all but one of ~14k invoices (a payroll record).
     2. Does a fully-paid invoice's total equal what was applied to it?

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

/* ---- 2. Assumed total vs what was actually applied -------------------
   Sums POInvoicingPaymentDetails.PaymentAmount — what was applied to THIS
   invoice. (An earlier version summed the payment header, counting a whole
   cheque once per invoice it covered. That was wrong.)

   Partial payments legitimately appear here. A consistent offset across many
   fully-paid invoices means the total formula is missing a component. */
SELECT TOP 25
    inv.InvoiceNo,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight
         - inv.DiscountAmt AS decimal(19,4))             AS assumed_total,
    CAST(SUM(pd.PaymentAmount) AS decimal(19,4))         AS applied,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt
         - SUM(pd.PaymentAmount) AS decimal(19,4))       AS difference
FROM POInvoicing inv
JOIN POInvoicingPaymentDetails pd ON pd.POInvoicingID = inv.POInvoicingID
GROUP BY inv.InvoiceNo, inv.SubTotal, inv.TotalTaxes, inv.Freight, inv.DiscountAmt
HAVING ABS(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt
           - SUM(pd.PaymentAmount)) > 0.005
ORDER BY 4 DESC;

/* ---- 3. What are the non-vendor vouchers? ----------------------------
   POInvoicing carries VISA statements, GST remittances and payroll as well
   as vendor bills. POInvoicingTypes does not distinguish them (one row,
   'DEP'), so find the real discriminator. */
SELECT TOP 30
    v.Name        AS vendor,
    COUNT(*)      AS voucher_count,
    MIN(inv.InvoiceNo) AS example_1,
    MAX(inv.InvoiceNo) AS example_2
FROM POInvoicing inv
LEFT JOIN Vendors v ON v.VendorID = inv.VendorID
WHERE inv.InvoiceNo LIKE 'VISA%' OR inv.InvoiceNo LIKE 'GST%'
   OR inv.InvoiceNo LIKE 'PR[_]%' OR inv.InvoiceNo LIKE 'DEP[_]%'
   OR inv.InvoiceNo LIKE 'Reconciled%'
GROUP BY v.Name
ORDER BY voucher_count DESC;

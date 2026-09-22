/* What a payment batch actually covered — invoices paid, credits applied,
   and whether the parts sum to the payment. Read-only.

   Run part 1 to find a batch name, then paste it into part 2. */

USE ActiveM_Talius_Test;

/* ---- 1. Recent payment batches ---------------------------------------- */
SELECT TOP 25
    pay.BatchFileName,
    v.Name                                   AS vendor,
    COUNT(*)                                 AS payment_lines,
    CAST(SUM(pay.PaymentAmount) AS decimal(19,4)) AS batch_total
FROM POInvoicingPayments pay
LEFT JOIN Vendors v ON v.VendorID = pay.VendorID
WHERE pay.BatchFileName IS NOT NULL AND pay.BatchFileName <> ''
GROUP BY pay.BatchFileName, v.Name
ORDER BY MAX(pay.POInvoicingPaymentID) DESC;

/* ---- 2. What one batch covered ---------------------------------------- */
DECLARE @Batch varchar(255) = '<paste a BatchFileName here>';

SELECT
    pay.BatchFileName,
    v.Name                                        AS vendor,
    CAST(pay.PaymentAmount AS decimal(19,4))      AS payment_amount,
    pay.PaymentTypeNo,
    inv.InvoiceNo                                 AS invoice_paid,
    inv.InvoiceDate,
    CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight
         - inv.DiscountAmt AS decimal(19,4))      AS invoice_total,
    cr.InvoiceNo                                  AS credit_applied,
    CAST(pay.DiscountAmt AS decimal(19,4))        AS discount_taken
FROM POInvoicingPayments       pay
JOIN POInvoicingPaymentDetails pd  ON pd.POInvoicingPaymentID = pay.POInvoicingPaymentID
LEFT JOIN POInvoicing          inv ON inv.POInvoicingID       = pd.POInvoicingID
LEFT JOIN POInvoicing          cr  ON cr.POInvoicingID        = pd.CreditPOInvoicingID
LEFT JOIN Vendors              v   ON v.VendorID              = pay.VendorID
WHERE pay.BatchFileName = @Batch
ORDER BY inv.InvoiceDate, inv.InvoiceNo;

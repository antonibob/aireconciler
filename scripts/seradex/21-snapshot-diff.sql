/* Learn the write path without server permissions.

   VIEW SERVER STATE is denied on this login, so the plan cache, Extended
   Events and Profiler are all unavailable. This gets the same answer a
   different way: photograph the relevant rows before and after entering one
   invoice by hand, and compare.

   It reveals WHAT the application changes — which is what a SQL insert route
   would have to replicate — without needing to see the statements.

   All SELECT. Changes nothing.

   HOW TO USE
     1. Pick a PO that is received but not yet invoiced. Put it in @PONo below.
     2. Run this. Save the output (Ctrl+T, Ctrl+A, Ctrl+C) as BEFORE.
     3. Enter that invoice in Seradex by hand, the way you always do.
     4. Run this again. Save the output as AFTER.
     5. Compare the two — every difference is something the app wrote.
*/

USE ActiveM_Talius;      -- change to ActiveM_Talius_Test if entering there

DECLARE @PONo varchar(50) = 'PO260619';     -- <<< set this

PRINT '===== A. PO HEADER =====';
SELECT po.PONo, po.POID, po.VendorID, po.SubTotal, po.TotalTaxes
FROM PO po
WHERE po.PONo = @PONo;

PRINT '===== B. PO LINES — watch QtyInvoicedToDate =====';
SELECT pod.PODetailID, pod.QtyToBuy, pod.QtyReceivedToDate,
       pod.QtyInvoicedToDate, pod.UnitCost, pod.ExtendedCost
FROM PODetails pod
JOIN PO po ON po.POID = pod.POID
WHERE po.PONo = @PONo
ORDER BY pod.PODetailID;

PRINT '===== C. RECEIVING LINES — watch ysnInvoiced and QtyInvoicedToDate =====';
SELECT rd.ReceivingDetailID, rd.PODetailID, rd.QtyOrdered, rd.QtyReceived,
       rd.ysnInvoiced, rd.QtyInvoicedToDate
FROM ReceivingDetails rd
JOIN PODetails pod ON pod.PODetailID = rd.PODetailID
JOIN PO po         ON po.POID        = pod.POID
WHERE po.PONo = @PONo
ORDER BY rd.ReceivingDetailID;

PRINT '===== D. INVOICE HEADERS AGAINST THIS PO =====';
SELECT DISTINCT inv.POInvoicingID, inv.InvoiceNo, inv.InvoiceDate,
       inv.SubTotal, inv.TotalTaxes, inv.Freight, inv.DiscountAmt,
       inv.DateCreated, inv.UserCreated
FROM POInvoicing inv
JOIN POInvoicingDetails pid ON pid.POInvoicingID = inv.POInvoicingID
JOIN PODetails pod          ON pod.PODetailID    = pid.PODetailID
JOIN PO po                  ON po.POID           = pod.POID
WHERE po.PONo = @PONo;

PRINT '===== E. INVOICE LINES AGAINST THIS PO =====';
SELECT pid.POInvoicingDetailID, pid.POInvoicingID, pid.PODetailID,
       pid.ReceivingDetailID, pid.QtyInvoiced, pid.PriceInvoiced,
       pid.ExtendedPrice, pid.TotalTaxes, pid.PriceVar,
       pid.InvGLAccountID, pid.PPVGLAccountID
FROM POInvoicingDetails pid
JOIN PODetails pod ON pod.PODetailID = pid.PODetailID
JOIN PO po         ON po.POID        = pod.POID
WHERE po.PONo = @PONo
ORDER BY pid.POInvoicingDetailID;

PRINT '===== F. ROW COUNTS (quick diff) =====';
SELECT
  (SELECT COUNT(*) FROM POInvoicing)              AS POInvoicing_rows,
  (SELECT COUNT(*) FROM POInvoicingDetails)       AS POInvoicingDetails_rows,
  (SELECT COUNT(*) FROM POInvoicingPayments)      AS Payments_rows,
  (SELECT COUNT(*) FROM POInvoicingPaymentDetails) AS PaymentDetails_rows,
  (SELECT COUNT(*) FROM GLJournalEntry)           AS GLJournalEntry_rows;

PRINT '===== snapshot taken =====';
SELECT SYSDATETIME() AS snapshot_time;

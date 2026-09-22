/* Invoice lines where the vendor billed something other than the PO price.
   Seradex computes this itself into POInvoicingDetails.PriceVar — this surfaces
   it rather than recalculating. Read-only. */

USE ActiveM_Talius_Test;

SELECT TOP 100
    v.Name                                        AS vendor,
    po.PONo,
    inv.InvoiceNo,
    inv.InvoiceDate,
    CAST(pid.QtyInvoiced    AS decimal(19,4))     AS qty_invoiced,
    CAST(pid.PriceInvoiced  AS decimal(19,4))     AS price_invoiced,
    CAST(pod.UnitCost       AS decimal(19,4))     AS po_unit_cost,
    CAST(pid.PriceVar       AS decimal(19,4))     AS price_variance,
    CAST(pid.ExtendedPrice  AS decimal(19,4))     AS extended
FROM POInvoicingDetails pid
JOIN POInvoicing        inv ON inv.POInvoicingID = pid.POInvoicingID
JOIN PODetails          pod ON pod.PODetailID    = pid.PODetailID
JOIN PO                 po  ON po.POID           = pod.POID
JOIN Vendors            v   ON v.VendorID        = inv.VendorID
WHERE ABS(pid.PriceVar) > 0.005
ORDER BY ABS(pid.PriceVar) DESC;

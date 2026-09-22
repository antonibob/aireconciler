/* Everything received but not yet invoiced — the "what can I enter today" list.

   Read-only.

   Only POs where NO line has been invoiced yet are listed, so every row here
   is a clean candidate. Partially-invoiced POs are deliberately excluded: the
   quantity columns use different units (QtyToBuy is purchase units,
   QtyReceivedToDate is stock units), so a proportional calculation on a
   partial would be wrong more often than right. Those need looking at by
   hand — see docs/seradex/write-path.md. */

USE ActiveM_Talius;

SELECT
    po.PONo,
    v.Name                                                AS vendor,
    COUNT(*)                                              AS lines,
    CAST(SUM(pod.ExtendedCost)          AS decimal(19,2)) AS expected_subtotal,
    CAST(SUM(pod.ExtendedCost) * 0.05   AS decimal(19,2)) AS gst_if_taxable,
    CAST(SUM(pod.ExtendedCost) * 1.05   AS decimal(19,2)) AS expected_total,
    MAX(po.POID)                                          AS POID
FROM PO po
JOIN PODetails pod ON pod.POID     = po.POID
JOIN Vendors   v   ON v.VendorID   = po.VendorID
WHERE pod.QtyReceivedToDate > 0
GROUP BY po.PONo, v.Name
HAVING SUM(pod.QtyInvoicedToDate) = 0
ORDER BY SUM(pod.ExtendedCost) DESC;

/* expected_subtotal is the reliable figure — it comes straight from the PO
   lines and is what the vendor should be billing.

   gst_if_taxable assumes 5% on everything, which is NOT always right: some
   lines are exempt, zero-rated, or from vendors outside Canada. Treat it as
   indicative and confirm against the vendor's own invoice. The tax actually
   applied comes from TaxGroupID on each line. */

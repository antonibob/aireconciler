/* Everything received but not yet invoiced — the "what can I enter today" list.

   Read-only.

   NET ONLY, DELIBERATELY. Compare a vendor invoice's pre-tax total against
   po_net here. Do not compare tax-inclusive totals: Seradex computes tax from
   each line's TaxGroupID and can differ from what the vendor charged, so a
   gross comparison invents variances that aren't real. Once the net ties, the
   tax is Seradex's to work out.

   Matching tolerance in use: $5 on net.

   Only POs where NO line has been invoiced are listed, so every row is a clean
   candidate. Partially-invoiced POs are excluded: the quantity columns use
   different units (QtyToBuy is purchase units, QtyReceivedToDate is stock
   units), so prorating a partial would be wrong more often than right. Those
   need looking at by hand — see docs/seradex/write-path.md.

   Note that a vendor may bill part of a large PO (Somfy does this routinely),
   in which case the invoice net will be far below po_net and the tolerance
   rule does not apply — match those at line level instead. */

USE ActiveM_Talius;

SELECT
    po.PONo,
    v.Name                                        AS vendor,
    COUNT(*)                                      AS lines,
    CAST(SUM(pod.ExtendedCost) AS decimal(19,2))  AS po_net
FROM PO po
JOIN PODetails pod ON pod.POID     = po.POID
JOIN Vendors   v   ON v.VendorID   = po.VendorID
WHERE pod.QtyReceivedToDate > 0
  AND po.PONo LIKE 'PO26%'          -- current year; drop for all years
GROUP BY po.PONo, v.Name
HAVING SUM(pod.QtyInvoicedToDate) = 0
ORDER BY SUM(pod.ExtendedCost) DESC;

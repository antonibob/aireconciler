-- TEMPLATE: invoices from a mail folder vs what Seradex shows received.
-- Replace the driver VALUES list in each statement with the real invoices.
-- Keep the shape: independent statements, no temp tables, no variables,
-- no block comments, CRLF line endings. See seradex-schema.md for why.
--
-- my_net is PRE-TAX, read off the invoice subtotal line. Never gross/1.05.

USE ActiveM_Talius;

SELECT @@VERSION AS sql_version,
       DB_NAME()  AS current_db,
       (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat_level,
       SYSDATETIME() AS run_at;

WITH dk AS (
    SELECT t.vendor, t.vendor_like, t.invoice_no, t.po_raw, t.my_net, t.my_total,
           t.currency, t.is_credit, t.inv_date, t.note,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(t.invoice_no),
             ' ',''),'-',''),'/',''),'.',''),'#',''),'_','') AS fk,
           CASE WHEN t.po_raw IS NULL THEN NULL
                WHEN UPPER(t.po_raw) LIKE 'PO%' THEN UPPER(t.po_raw)
                ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES
      -- vendor, vendor_like, invoice_no, po_raw, my_net, my_total, currency, is_credit, inv_date, note
      -- CAST the first row's numerics and dates; later rows inherit the type.
      ('Example Co','Example','INV-001','260700',CAST(100.00 AS decimal(19,2)),CAST(105.00 AS decimal(19,2)),'CAD',0,CAST('2026-10-01' AS date),NULL),
      ('Example Co','Example','INV-002','260701',200.00,210.00,'CAD',0,'2026-10-02','unreadable PDF -> use NULL,NULL instead'),
      ('Example Co','Example','CR-003','260701',-50.00,-52.50,'CAD',1,'2026-10-03','credit memo')
    ) AS t(vendor, vendor_like, invoice_no, po_raw, my_net, my_total, currency, is_credit, inv_date, note)
), ps AS (
    SELECT po.PONo,
           MIN(po.POID) AS POID,
           MIN(v.Name)  AS seradex_vendor,
           COUNT(*) AS po_lines,
           SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN 0 ELSE 1 END) AS lines_not_received,
           CAST(SUM(pod.ExtendedCost) AS decimal(19,2)) AS po_net,
           CAST(SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN pod.ExtendedCost ELSE 0 END) AS decimal(19,2)) AS received_net,
           CAST(SUM(pod.QtyInvoicedToDate) AS decimal(19,4)) AS qty_invoiced_to_date
    FROM PO po
    JOIN PODetails pod ON pod.POID    = po.POID
    JOIN Vendors   v   ON v.VendorID  = po.VendorID
    GROUP BY po.PONo
), ap AS (
    SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(inv.InvoiceNo),
             ' ',''),'-',''),'/',''),'.',''),'#',''),'_','') AS fk,
           MIN(inv.POInvoicingID) AS POInvoicingID,
           MIN(inv.InvoiceNo)     AS ap_invoice_no,
           MIN(inv.InvoiceDate)   AS ap_invoice_date,
           CAST(MIN(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt) AS decimal(19,2)) AS ap_total
    FROM POInvoicing inv
    GROUP BY REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(inv.InvoiceNo),
             ' ',''),'-',''),'/',''),'.',''),'#',''),'_','')
), billed AS (
    SELECT po_key, SUM(my_net) AS po_billed_net, COUNT(*) AS invoices_on_this_po
    FROM dk WHERE po_key IS NOT NULL GROUP BY po_key
)
SELECT
    CASE
      WHEN dk.is_credit = 1                        THEN '8 CREDIT MEMO - NOT A PAYABLE'
      WHEN ap.POInvoicingID IS NOT NULL            THEN '0 ALREADY ENTERED IN AP'
      WHEN dk.po_key IS NULL                       THEN '7 NO PO ON INVOICE'
      WHEN ps.PONo IS NULL                         THEN '6 PO NOT FOUND IN SERADEX'
      WHEN ps.received_net = 0                     THEN '4 NOTHING RECEIVED YET'
      WHEN dk.my_net IS NULL                       THEN '5 PO FOUND, INVOICE AMOUNT NOT READABLE'
      WHEN ABS(ps.received_net - dk.my_net) <= 0.01
                                                   THEN '1 RECEIVED = INVOICE - OK TO ENTER'
      WHEN ps.received_net >= dk.my_net - 0.01     THEN '1 RECEIVED OVER INVOICE - OK TO ENTER'
      WHEN ps.lines_not_received = 0
           AND dk.my_net > ps.received_net + 0.01  THEN '2 PO FULLY RECEIVED BUT INVOICE EXCEEDS PO'
      WHEN ps.received_net < dk.my_net - 0.01      THEN '3 RECEIVED SHORT - RECEIVING INCOMPLETE'
      ELSE                                              '9 LOGIC GAP'
    END                                            AS verdict,
    dk.vendor, dk.invoice_no, dk.inv_date, dk.currency, dk.po_key,
    dk.my_net AS invoice_net, dk.my_total AS invoice_total,
    ps.received_net, ps.po_net,
    CAST(ps.received_net - dk.my_net AS decimal(19,2)) AS received_less_invoice,
    ps.po_lines, ps.lines_not_received, ps.qty_invoiced_to_date,
    b.invoices_on_this_po,
    CAST(b.po_billed_net AS decimal(19,2)) AS po_billed_net_this_folder,
    ps.seradex_vendor,
    ap.ap_invoice_no, ap.ap_invoice_date, ap.ap_total,
    dk.note
FROM dk
LEFT JOIN ps       ON ps.PONo   = dk.po_key
LEFT JOIN ap       ON ap.fk     = dk.fk
LEFT JOIN billed b ON b.po_key  = dk.po_key
ORDER BY verdict, dk.vendor, dk.invoice_no;

-- Line detail. This is what lets you decompose a variance and spot
-- part-received lines (QtyReceivedToDate <> QtyToBuy) and prior partial
-- invoicing (QtyInvoicedToDate between 0 and QtyToBuy). Do not skip it.
WITH dk AS (
    SELECT DISTINCT
           CASE WHEN UPPER(t.po_raw) LIKE 'PO%' THEN UPPER(t.po_raw)
                ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES ('260700'),('260701')) AS t(po_raw)
)
SELECT po.PONo, v.Name AS vendor, pod.PODetailID,
       pod.QtyToBuy, pod.QtyReceivedToDate, pod.QtyInvoicedToDate,
       CAST(pod.UnitCost     AS decimal(19,4)) AS unit_cost,
       CAST(pod.ExtendedCost AS decimal(19,2)) AS extended_cost,
       CASE WHEN pod.QtyReceivedToDate > 0 THEN 'received' ELSE 'NOT RECEIVED' END AS receipt_state
FROM dk
JOIN PO        po  ON po.PONo    = dk.po_key
JOIN PODetails pod ON pod.POID   = po.POID
JOIN Vendors   v   ON v.VendorID = po.VendorID
ORDER BY po.PONo, pod.PODetailID;

-- POs quoted on an invoice that do not exist. Suspect a vendor typo first.
WITH dk AS (
    SELECT DISTINCT
           CASE WHEN UPPER(t.po_raw) LIKE 'PO%' THEN UPPER(t.po_raw)
                ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES ('260700'),('260701')) AS t(po_raw)
)
SELECT dk.po_key AS po_quoted_on_invoice, 'NOT IN PO TABLE' AS status
FROM dk
WHERE NOT EXISTS (SELECT 1 FROM PO po WHERE po.PONo = dk.po_key)
ORDER BY dk.po_key;

-- Vendor records for the names on the invoices. Letterhead names differ from
-- Seradex names (see mailbox-extraction.md), and some vendors are split across
-- several records or have none at all.
SELECT v.VendorID, v.Name
FROM Vendors v
WHERE v.Name LIKE '%Example%'
ORDER BY v.Name;

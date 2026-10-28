-- Invoices sitting in the payables mailbox folder "1 POs awaiting receipt",
-- compared against what Seradex shows as received on the PO they quote.
-- Read-only. 2026-10-28.
--
-- The PO number and the invoice totals in the driver list below were read off
-- each invoice PDF, not off the email subject. Where a vendor's PDF could not
-- be opened (Lakeside, Millennium send them as octet-stream) the PO came from
-- the subject line and my_net is NULL - those rows report PO state only.
--
-- my_net is the PRE-TAX invoice amount. Compare that, never the tax-inclusive
-- total: PODetails.ExtendedCost is pre-tax and Seradex works out its own tax.
--
-- Each statement below is self-contained. No temp tables, no variables.

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
      ('Endura','Endura','ON-714692','260723',CAST(1826.30 AS decimal(19,2)),CAST(1917.62 AS decimal(19,2)),'CAD',0,CAST('2026-10-27' AS date),NULL),
      ('Endura','Endura','ON-714593','260719',1528.84,1605.28,'CAD',0,'2026-10-26',NULL),
      ('Endura','Endura','ON-714481','260713',136.43,143.25,'CAD',0,'2026-10-22',NULL),
      ('Endura','Endura','ON-714433','260709',67.44,70.81,'CAD',0,'2026-10-21',NULL),
      ('Endura','Endura','ON-714285','260707',2029.65,2131.14,'CAD',0,'2026-10-19',NULL),
      ('Endura','Endura','ON-714115','260702',48.42,50.84,'CAD',0,'2026-10-14',NULL),
      ('BC Fasteners','Fastener','4274237','260645',45.93,48.23,'CAD',0,'2026-10-26',NULL),
      ('BC Fasteners','Fastener','4272734','260695',20.23,21.24,'CAD',0,'2026-10-21',NULL),
      ('BC Fasteners','Fastener','4271754','260706',576.00,604.80,'CAD',0,'2026-10-19',NULL),
      ('BC Fasteners','Fastener','4271753','260695',140.00,147.00,'CAD',0,'2026-10-19',NULL),
      ('BC Fasteners','Fastener','4255120','260602',78.93,82.88,'CAD',0,'2026-08-26','August invoice, vendor chasing'),
      ('Richelieu','Hi-Tech','QEY0015','260721',1264.30,1327.52,'CAD',0,'2026-10-27',NULL),
      ('Richelieu','Hi-Tech','QEX7794','260718',12691.07,13325.62,'CAD',0,'2026-10-27',NULL),
      ('Richelieu','Hi-Tech','JD0942A','260691',1363.55,1431.73,'CAD',0,'2026-10-22','includes 350.00 freight'),
      ('Richelieu','Hi-Tech','QEM3630','260703',1320.10,1386.11,'CAD',0,'2026-10-16',NULL),
      ('Richelieu','Hi-Tech','QEG5040','260691',9047.73,9500.11,'CAD',0,'2026-10-13',NULL),
      ('Richelieu','Hi-Tech','JB5646A','260610',1013.56,1064.24,'CAD',0,'2026-10-13',NULL),
      ('Uline','Uline','18999225','260714',288.48,302.90,'CAD',0,'2026-10-22','incl 95.88 freight'),
      ('Uline','Uline','18817630','260642',507.82,568.76,'CAD',0,'2026-09-21','incl 37.82 freight and PST'),
      ('Uline','Uline','18871584','260642',-507.82,-568.76,'CAD',1,'2026-09-29','credit, reverses 18817630 in full'),
      ('Trivantage','Trivantage','4711100','260699',3001.14,3001.14,'USD',0,'2026-10-13',NULL),
      ('Memtech','Memtech','118188','260705',2452.80,2452.80,'USD',0,'2026-10-20',NULL),
      ('Canevas LaSalle','LaSalle','180241','260662',2052.98,2299.34,'CAD',0,'2026-10-05','PDF shows balance due 0.00 - already paid'),
      ('Lakeside Fasteners','Lakeside','141708','260720',NULL,NULL,'CAD',0,'2026-10-27','PDF not readable'),
      ('Lakeside Fasteners','Lakeside','141466','260677',NULL,NULL,'CAD',0,'2026-10-23','PDF not readable'),
      ('Lakeside Fasteners','Lakeside','138919','260647',NULL,NULL,'CAD',0,'2026-09-23','billed as PO2060647, read as typo for 260647'),
      ('Lakeside Fasteners','Lakeside','135477',NULL,NULL,NULL,'CAD',0,'2026-08-14','PO billed as SHOP'),
      ('Millennium Alloys','Millennium','I031067','260638',NULL,NULL,'CAD',0,'2026-10-19','PDF not readable'),
      ('Millennium Alloys','Millennium','I031066','260669',NULL,NULL,'CAD',0,'2026-10-19','PDF not readable'),
      ('Crown Packaging','Crown','01989360',NULL,-350.00,-351.82,'CAD',1,'2026-10-16','pallet return credit, no PO'),
      ('McMaster-Carr','McMaster','74065675',NULL,222.58,222.58,'USD',0,'2026-10-22','card purchase ref 1022CJOHNSON'),
      ('McMaster-Carr','McMaster','74065334',NULL,277.58,277.58,'USD',0,'2026-10-22','card purchase ref 1022CJOHNSON'),
      ('McMaster-Carr','McMaster','73003143',NULL,45.92,45.92,'USD',0,'2026-10-05','card purchase ref 1005CJOHNSON'),
      ('McMaster-Carr','McMaster','72519881',NULL,388.24,388.24,'USD',0,'2026-09-25','card purchase ref 0925CJOHNSON')
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
    dk.vendor,
    dk.invoice_no,
    dk.inv_date,
    dk.currency,
    dk.po_key,
    dk.my_net                                      AS invoice_net,
    dk.my_total                                    AS invoice_total,
    ps.received_net,
    ps.po_net,
    CAST(ps.received_net - dk.my_net AS decimal(19,2)) AS received_less_invoice,
    ps.po_lines,
    ps.lines_not_received,
    ps.qty_invoiced_to_date,
    b.invoices_on_this_po,
    CAST(b.po_billed_net AS decimal(19,2))         AS po_billed_net_this_folder,
    ps.seradex_vendor,
    ap.ap_invoice_no,
    ap.ap_invoice_date,
    ap.ap_total,
    dk.note
FROM dk
LEFT JOIN ps     ON ps.PONo   = dk.po_key
LEFT JOIN ap     ON ap.fk     = dk.fk
LEFT JOIN billed b ON b.po_key = dk.po_key
ORDER BY verdict, dk.vendor, dk.invoice_no;

WITH dk AS (
    SELECT DISTINCT
           CASE WHEN t.po_raw IS NULL THEN NULL
                WHEN UPPER(t.po_raw) LIKE 'PO%' THEN UPPER(t.po_raw)
                ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES
      ('260723'),('260719'),('260713'),('260709'),('260707'),('260702'),
      ('260645'),('260695'),('260706'),('260602'),
      ('260721'),('260718'),('260691'),('260703'),('260610'),
      ('260714'),('260642'),('260699'),('260705'),('260662'),
      ('260720'),('260677'),('260647'),('260638'),('260669')
    ) AS t(po_raw)
)
SELECT po.PONo,
       v.Name                      AS vendor,
       pod.PODetailID,
       pod.QtyToBuy,
       pod.QtyReceivedToDate,
       pod.QtyInvoicedToDate,
       CAST(pod.UnitCost     AS decimal(19,4)) AS unit_cost,
       CAST(pod.ExtendedCost AS decimal(19,2)) AS extended_cost,
       CASE WHEN pod.QtyReceivedToDate > 0 THEN 'received' ELSE 'NOT RECEIVED' END AS receipt_state
FROM dk
JOIN PO        po  ON po.PONo      = dk.po_key
JOIN PODetails pod ON pod.POID     = po.POID
JOIN Vendors   v   ON v.VendorID   = po.VendorID
ORDER BY po.PONo, pod.PODetailID;

WITH dk AS (
    SELECT DISTINCT
           CASE WHEN t.po_raw IS NULL THEN NULL
                WHEN UPPER(t.po_raw) LIKE 'PO%' THEN UPPER(t.po_raw)
                ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES
      ('260723'),('260719'),('260713'),('260709'),('260707'),('260702'),
      ('260645'),('260695'),('260706'),('260602'),
      ('260721'),('260718'),('260691'),('260703'),('260610'),
      ('260714'),('260642'),('260699'),('260705'),('260662'),
      ('260720'),('260677'),('260647'),('260638'),('260669')
    ) AS t(po_raw)
)
SELECT dk.po_key AS po_quoted_on_invoice,
       'NOT IN PO TABLE' AS status
FROM dk
WHERE dk.po_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM PO po WHERE po.PONo = dk.po_key)
ORDER BY dk.po_key;

SELECT v.VendorID, v.Name
FROM Vendors v
WHERE v.Name LIKE '%Endura%'
   OR v.Name LIKE '%Fastener%'
   OR v.Name LIKE '%Hi-Tech%'
   OR v.Name LIKE '%Richelieu%'
   OR v.Name LIKE '%Uline%'
   OR v.Name LIKE '%Trivantage%'
   OR v.Name LIKE '%Memtech%'
   OR v.Name LIKE '%Muir%'
   OR v.Name LIKE '%LaSalle%'
   OR v.Name LIKE '%Lakeside%'
   OR v.Name LIKE '%Millennium%'
   OR v.Name LIKE '%Crown%'
   OR v.Name LIKE '%McMaster%'
ORDER BY v.Name;

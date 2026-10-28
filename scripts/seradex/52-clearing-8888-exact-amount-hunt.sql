-- 8888-88 credit-card clearing: find the Seradex PO created for each EXACT amount.
-- Driver is the 44 rows of "3 - Remains as PO" in Talius_8888-88_PO_Comparison.xlsx
-- that carry no "y" in the Done column. They total 28,955.94.
--
-- The amounts in the file are CAD credit-card STATEMENT amounts, so they are
-- tax-inclusive for Canadian vendors. PODetails.ExtendedCost is PRE-TAX. So the
-- hunt tests several bases and tells you which one hit:
--   net      amount = SUM(ExtendedCost)
--   gross    amount = SUM(ExtendedCost) * 1.05   (BC GST 5%)
--   fx       amount = the USD/EUR figure printed on the statement line
-- A match on "gross" is just as real as one on "net"; the basis column says which.
--
-- Read-only. Self-contained statements: no temp tables, no variables.

USE ActiveM_Talius;

SELECT @@VERSION AS sql_version,
       DB_NAME()  AS current_db,
       (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat_level,
       SYSDATETIME() AS run_at;

WITH dk AS (
    SELECT t.stmt_month, t.ref, t.vendor_hint, t.amt_cad, t.amt_fx, t.fx_ccy, t.flag,
           CASE WHEN t.po_raw IS NULL THEN NULL ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES
      ('April 2026','PO260213','ASA Alloys',CAST(366.45 AS decimal(19,2)),CAST(NULL AS decimal(19,2)),NULL,NULL,'260213'),
      ('April 2026','PO260220','City Electric Supply #41',264.71,NULL,NULL,NULL,'260220'),
      ('April 2026','PO260257','McMaster-Carr',264.23,187.99,'USD',NULL,'260257'),
      ('April 2026','PO260213','ASA Alloys',253.05,NULL,NULL,NULL,'260213'),
      ('April 2026','PO250689','Mediterranean Shipping',126.31,NULL,NULL,'PRIOR-YEAR PO','250689'),
      ('April 2026','PO260253','Amazon',86.42,NULL,NULL,NULL,'260253'),
      ('April 2026','PO260238','Gilbert Parts Armstrong',3.49,NULL,NULL,NULL,'260238'),
      ('May 2026','PO260403','Northern Plastics',2763.61,NULL,NULL,'ON HOLD','260403'),
      ('May 2026','PO260359','VistaPrint',931.78,NULL,NULL,NULL,'260359'),
      ('May 2026','PO260309','MATIC Machines',920.05,562.54,'EUR',NULL,'260309'),
      ('May 2026','PO260354','Major Manufacturing',903.77,NULL,NULL,NULL,'260354'),
      ('May 2026','PO260308','Sticky Business',903.30,NULL,NULL,NULL,'260308'),
      ('May 2026','PO260042+055+099','Mediterranean Shipping',847.69,NULL,NULL,'THREE POs ON ONE LINE',NULL),
      ('May 2026','PO260244','City Electric Supply #41',606.93,NULL,NULL,'ON HOLD','260244'),
      ('May 2026','0506GLOCK','McMaster-Carr',605.09,432.67,'USD','NOT A PO NUMBER',NULL),
      ('May 2026','PO260323','ASA Alloys',598.87,NULL,NULL,NULL,'260323'),
      ('May 2026','PO260348','McMaster-Carr',537.44,381.58,'USD',NULL,'260348'),
      ('May 2026','PO260361','Canadian Tire',427.95,NULL,NULL,NULL,'260361'),
      ('May 2026','PO260349','Amazon',263.07,NULL,NULL,NULL,'260349'),
      ('May 2026','PO260329','Amazon',190.18,NULL,NULL,NULL,'260329'),
      ('May 2026','PO260323','ASA Alloys',148.46,NULL,NULL,NULL,'260323'),
      ('May 2026','PO260244','City Electric Supply #41',147.96,NULL,NULL,'ON HOLD','260244'),
      ('May 2026','PO260350','Amazon',135.42,NULL,NULL,NULL,'260350'),
      ('May 2026','PO260315','McMaster-Carr',111.23,79.54,'USD',NULL,'260315'),
      ('May 2026','PO260330','Grainger Canada',85.08,NULL,NULL,NULL,'260330'),
      ('May 2026','PO260320','Amazon',78.38,NULL,NULL,NULL,'260320'),
      ('May 2026','PO260362','Amazon',58.24,NULL,NULL,NULL,'260362'),
      ('May 2026','PO260371','McMaster-Carr',NULL,NULL,NULL,'ZERO AMOUNT - May placeholder','260371'),
      ('June 2026','PO260437','K and F Roll Shutter',9369.23,NULL,NULL,NULL,'260437'),
      ('June 2026','PO260403?','Northern Plastics',714.00,NULL,NULL,'ON HOLD','260403'),
      ('June 2026','PO260463','Canadian Tire',603.97,NULL,NULL,NULL,'260463'),
      ('June 2026','PO260439','Canadian Tire',447.95,NULL,NULL,NULL,'260439'),
      ('June 2026','PO260393','McMaster-Carr',442.74,311.71,'USD',NULL,'260393'),
      ('June 2026','PO260446','McMaster-Carr',295.79,206.07,'USD',NULL,'260446'),
      ('June 2026','PO260450','Electro Sonic Group',268.51,NULL,NULL,NULL,'260450'),
      ('June 2026','PO260428','McMaster-Carr',165.53,115.65,'USD',NULL,'260428'),
      ('June 2026','PO260388','McMaster-Carr',140.61,99.00,'USD',NULL,'260388'),
      ('June 2026','PO260379','McMaster-Carr',112.82,79.62,'USD',NULL,'260379'),
      ('June 2026','PO260445','McMaster-Carr',107.38,74.84,'USD',NULL,'260445'),
      ('June 2026','PO260371','McMaster-Carr',104.63,73.84,'USD',NULL,'260371'),
      ('June 2026','IDN 6227904','International Distribution',17.00,NULL,NULL,'NOT A PO NUMBER',NULL),
      ('August 2026','PO260573','Sticky Business',903.30,NULL,NULL,NULL,'260573'),
      ('August 2026','PO260250','Lakeside Fasteners',20.57,NULL,NULL,NULL,'260250'),
      ('September 2026','PO260452','Akhurst Machinery',2612.75,NULL,NULL,NULL,'260452')
    ) AS t(stmt_month, ref, vendor_hint, amt_cad, amt_fx, fx_ccy, flag, po_raw)
), pt AS (
    SELECT po.PONo,
           MIN(v.Name) AS seradex_vendor,
           COUNT(*) AS po_lines,
           CAST(SUM(pod.ExtendedCost) AS decimal(19,2)) AS po_net,
           CAST(SUM(pod.ExtendedCost) * 1.05 AS decimal(19,2)) AS po_gross,
           CAST(SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN pod.ExtendedCost ELSE 0 END) AS decimal(19,2)) AS received_net,
           CAST(SUM(pod.QtyInvoicedToDate) AS decimal(19,4)) AS qty_invoiced_to_date
    FROM PO po
    JOIN PODetails pod ON pod.POID   = po.POID
    JOIN Vendors   v   ON v.VendorID = po.VendorID
    GROUP BY po.PONo
)
SELECT
    CASE
      WHEN dk.amt_cad IS NULL                                   THEN '5 NO AMOUNT ON THE ROW'
      WHEN dk.po_key IS NULL                                    THEN '4 REFERENCE IS NOT A PO'
      WHEN pt.PONo IS NULL                                      THEN '3 PO DOES NOT EXIST IN SERADEX'
      WHEN ABS(pt.po_net   - dk.amt_cad) <= 0.01                THEN '0 EXACT MATCH ON PO NET'
      WHEN ABS(pt.po_gross - dk.amt_cad) <= 0.01                THEN '0 EXACT MATCH ON PO NET + GST'
      WHEN dk.amt_fx IS NOT NULL
           AND ABS(pt.po_net - dk.amt_fx) <= 0.01               THEN '0 EXACT MATCH ON PO NET IN ' + dk.fx_ccy
      WHEN dk.amt_fx IS NOT NULL
           AND ABS(pt.po_net * 1.05 - dk.amt_fx) <= 0.01        THEN '0 EXACT MATCH ON PO NET + GST IN ' + dk.fx_ccy
      ELSE                                                           '1 PO EXISTS BUT AMOUNT DOES NOT MATCH'
    END                                                AS verdict,
    dk.stmt_month, dk.ref, dk.vendor_hint,
    dk.amt_cad AS file_amount, dk.amt_fx AS file_amount_fx, dk.fx_ccy,
    dk.po_key, pt.seradex_vendor, pt.po_lines,
    pt.po_net, pt.po_gross,
    CAST(pt.po_net   - dk.amt_cad AS decimal(19,2)) AS net_less_file,
    CAST(pt.po_gross - dk.amt_cad AS decimal(19,2)) AS gross_less_file,
    pt.received_net, pt.qty_invoiced_to_date,
    dk.flag
FROM dk
LEFT JOIN pt ON pt.PONo = dk.po_key
ORDER BY verdict, dk.stmt_month, dk.ref;

WITH dk AS (
    SELECT t.ref, t.amt_cad, t.amt_fx, t.fx_ccy,
           CASE WHEN t.po_raw IS NULL THEN NULL ELSE 'PO' + t.po_raw END AS po_key
    FROM (VALUES
      ('PO260213',CAST(366.45 AS decimal(19,2)),CAST(NULL AS decimal(19,2)),NULL,'260213'),
      ('PO260220',264.71,NULL,NULL,'260220'),
      ('PO260257',264.23,187.99,'USD','260257'),
      ('PO260213',253.05,NULL,NULL,'260213'),
      ('PO250689',126.31,NULL,NULL,'250689'),
      ('PO260253',86.42,NULL,NULL,'260253'),
      ('PO260238',3.49,NULL,NULL,'260238'),
      ('PO260403',2763.61,NULL,NULL,'260403'),
      ('PO260359',931.78,NULL,NULL,'260359'),
      ('PO260309',920.05,562.54,'EUR','260309'),
      ('PO260354',903.77,NULL,NULL,'260354'),
      ('PO260308',903.30,NULL,NULL,'260308'),
      ('PO260042+055+099',847.69,NULL,NULL,NULL),
      ('PO260244',606.93,NULL,NULL,'260244'),
      ('0506GLOCK',605.09,432.67,'USD',NULL),
      ('PO260323',598.87,NULL,NULL,'260323'),
      ('PO260348',537.44,381.58,'USD','260348'),
      ('PO260361',427.95,NULL,NULL,'260361'),
      ('PO260349',263.07,NULL,NULL,'260349'),
      ('PO260329',190.18,NULL,NULL,'260329'),
      ('PO260323',148.46,NULL,NULL,'260323'),
      ('PO260244',147.96,NULL,NULL,'260244'),
      ('PO260350',135.42,NULL,NULL,'260350'),
      ('PO260315',111.23,79.54,'USD','260315'),
      ('PO260330',85.08,NULL,NULL,'260330'),
      ('PO260320',78.38,NULL,NULL,'260320'),
      ('PO260362',58.24,NULL,NULL,'260362'),
      ('PO260437',9369.23,NULL,NULL,'260437'),
      ('PO260403?',714.00,NULL,NULL,'260403'),
      ('PO260463',603.97,NULL,NULL,'260463'),
      ('PO260439',447.95,NULL,NULL,'260439'),
      ('PO260393',442.74,311.71,'USD','260393'),
      ('PO260446',295.79,206.07,'USD','260446'),
      ('PO260450',268.51,NULL,NULL,'260450'),
      ('PO260428',165.53,115.65,'USD','260428'),
      ('PO260388',140.61,99.00,'USD','260388'),
      ('PO260379',112.82,79.62,'USD','260379'),
      ('PO260445',107.38,74.84,'USD','260445'),
      ('PO260371',104.63,73.84,'USD','260371'),
      ('IDN 6227904',17.00,NULL,NULL,NULL),
      ('PO260573',903.30,NULL,NULL,'260573'),
      ('PO260250',20.57,NULL,NULL,'260250'),
      ('PO260452',2612.75,NULL,NULL,'260452')
    ) AS t(ref, amt_cad, amt_fx, fx_ccy, po_raw)
), pt AS (
    SELECT po.PONo,
           MIN(v.Name) AS seradex_vendor,
           CAST(SUM(pod.ExtendedCost) AS decimal(19,2)) AS po_net,
           CAST(SUM(CASE WHEN pod.QtyReceivedToDate > 0 THEN pod.ExtendedCost ELSE 0 END) AS decimal(19,2)) AS received_net,
           CAST(SUM(pod.QtyInvoicedToDate) AS decimal(19,4)) AS qty_invoiced_to_date
    FROM PO po
    JOIN PODetails pod ON pod.POID   = po.POID
    JOIN Vendors   v   ON v.VendorID = po.VendorID
    GROUP BY po.PONo
)
SELECT dk.ref                AS file_reference,
       dk.amt_cad            AS file_amount,
       pt.PONo               AS po_found_in_seradex,
       CASE WHEN ABS(pt.po_net - dk.amt_cad) <= 0.01        THEN 'net'
            WHEN ABS(pt.po_net * 1.05 - dk.amt_cad) <= 0.01 THEN 'net + GST'
            WHEN dk.amt_fx IS NOT NULL
                 AND ABS(pt.po_net - dk.amt_fx) <= 0.01     THEN 'net in ' + dk.fx_ccy
            ELSE 'net + GST in ' + dk.fx_ccy END            AS matched_on,
       CASE WHEN pt.PONo = dk.po_key THEN 'SAME PO AS THE FILE QUOTES'
            WHEN dk.po_key IS NULL   THEN 'FILE HAS NO PO - THIS IS A CANDIDATE'
            ELSE 'DIFFERENT PO - file quotes ' + dk.po_key END AS relation_to_file,
       pt.seradex_vendor, pt.po_net, pt.received_net, pt.qty_invoiced_to_date
FROM dk
JOIN pt ON ABS(pt.po_net - dk.amt_cad) <= 0.01
        OR ABS(pt.po_net * 1.05 - dk.amt_cad) <= 0.01
        OR (dk.amt_fx IS NOT NULL AND ABS(pt.po_net - dk.amt_fx) <= 0.01)
        OR (dk.amt_fx IS NOT NULL AND ABS(pt.po_net * 1.05 - dk.amt_fx) <= 0.01)
ORDER BY dk.ref, pt.PONo;

WITH dk AS (
    SELECT t.ref, t.amt_cad, t.amt_fx, t.fx_ccy
    FROM (VALUES
      ('PO260213',CAST(366.45 AS decimal(19,2)),CAST(NULL AS decimal(19,2)),NULL),
      ('PO260220',264.71,NULL,NULL),
      ('PO260257',264.23,187.99,'USD'),
      ('PO260213',253.05,NULL,NULL),
      ('PO250689',126.31,NULL,NULL),
      ('PO260253',86.42,NULL,NULL),
      ('PO260238',3.49,NULL,NULL),
      ('PO260403',2763.61,NULL,NULL),
      ('PO260359',931.78,NULL,NULL),
      ('PO260309',920.05,562.54,'EUR'),
      ('PO260354',903.77,NULL,NULL),
      ('PO260308',903.30,NULL,NULL),
      ('PO260042+055+099',847.69,NULL,NULL),
      ('PO260244',606.93,NULL,NULL),
      ('0506GLOCK',605.09,432.67,'USD'),
      ('PO260323',598.87,NULL,NULL),
      ('PO260348',537.44,381.58,'USD'),
      ('PO260361',427.95,NULL,NULL),
      ('PO260349',263.07,NULL,NULL),
      ('PO260329',190.18,NULL,NULL),
      ('PO260323',148.46,NULL,NULL),
      ('PO260244',147.96,NULL,NULL),
      ('PO260350',135.42,NULL,NULL),
      ('PO260315',111.23,79.54,'USD'),
      ('PO260330',85.08,NULL,NULL),
      ('PO260320',78.38,NULL,NULL),
      ('PO260362',58.24,NULL,NULL),
      ('PO260437',9369.23,NULL,NULL),
      ('PO260403?',714.00,NULL,NULL),
      ('PO260463',603.97,NULL,NULL),
      ('PO260439',447.95,NULL,NULL),
      ('PO260393',442.74,311.71,'USD'),
      ('PO260446',295.79,206.07,'USD'),
      ('PO260450',268.51,NULL,NULL),
      ('PO260428',165.53,115.65,'USD'),
      ('PO260388',140.61,99.00,'USD'),
      ('PO260379',112.82,79.62,'USD'),
      ('PO260445',107.38,74.84,'USD'),
      ('PO260371',104.63,73.84,'USD'),
      ('IDN 6227904',17.00,NULL,NULL),
      ('PO260573',903.30,NULL,NULL),
      ('PO260250',20.57,NULL,NULL),
      ('PO260452',2612.75,NULL,NULL)
    ) AS t(ref, amt_cad, amt_fx, fx_ccy)
)
SELECT dk.ref AS file_reference,
       dk.amt_cad AS file_amount,
       po.PONo    AS po_with_a_line_at_this_amount,
       v.Name     AS seradex_vendor,
       pod.PODetailID,
       pod.QtyToBuy, pod.QtyReceivedToDate, pod.QtyInvoicedToDate,
       CAST(pod.ExtendedCost AS decimal(19,2)) AS line_extended_cost,
       CASE WHEN ABS(pod.ExtendedCost - dk.amt_cad) <= 0.01 THEN 'line net'
            ELSE 'line net + GST' END AS matched_on
FROM dk
JOIN PODetails pod ON ABS(pod.ExtendedCost - dk.amt_cad) <= 0.01
                   OR ABS(pod.ExtendedCost * 1.05 - dk.amt_cad) <= 0.01
JOIN PO      po ON po.POID     = pod.POID
JOIN Vendors v  ON v.VendorID  = po.VendorID
ORDER BY dk.ref, po.PONo, pod.PODetailID;

WITH dk AS (
    SELECT t.ref, t.amt_cad
    FROM (VALUES
      ('PO260213',CAST(366.45 AS decimal(19,2))),('PO260220',264.71),('PO260257',264.23),
      ('PO260213',253.05),('PO250689',126.31),('PO260253',86.42),('PO260238',3.49),
      ('PO260403',2763.61),('PO260359',931.78),('PO260309',920.05),('PO260354',903.77),
      ('PO260308',903.30),('PO260042+055+099',847.69),('PO260244',606.93),('0506GLOCK',605.09),
      ('PO260323',598.87),('PO260348',537.44),('PO260361',427.95),('PO260349',263.07),
      ('PO260329',190.18),('PO260323',148.46),('PO260244',147.96),('PO260350',135.42),
      ('PO260315',111.23),('PO260330',85.08),('PO260320',78.38),('PO260362',58.24),
      ('PO260437',9369.23),('PO260403?',714.00),('PO260463',603.97),('PO260439',447.95),
      ('PO260393',442.74),('PO260446',295.79),('PO260450',268.51),('PO260428',165.53),
      ('PO260388',140.61),('PO260379',112.82),('PO260445',107.38),('PO260371',104.63),
      ('IDN 6227904',17.00),('PO260573',903.30),('PO260250',20.57),('PO260452',2612.75)
    ) AS t(ref, amt_cad)
), ap AS (
    SELECT inv.POInvoicingID, inv.InvoiceNo, inv.InvoiceDate, inv.VendorID,
           CAST(inv.SubTotal + inv.TotalTaxes + inv.Freight - inv.DiscountAmt AS decimal(19,2)) AS ap_total,
           CAST(inv.SubTotal AS decimal(19,2)) AS ap_subtotal
    FROM POInvoicing inv
)
SELECT dk.ref AS file_reference,
       dk.amt_cad AS file_amount,
       ap.InvoiceNo, ap.InvoiceDate, ap.ap_subtotal, ap.ap_total,
       v.Name AS seradex_vendor,
       CASE WHEN ABS(ap.ap_total - dk.amt_cad) <= 0.01 THEN 'invoice total'
            ELSE 'invoice subtotal' END AS matched_on
FROM dk
JOIN ap ON ABS(ap.ap_total - dk.amt_cad) <= 0.01
        OR ABS(ap.ap_subtotal - dk.amt_cad) <= 0.01
LEFT JOIN Vendors v ON v.VendorID = ap.VendorID
ORDER BY dk.ref, ap.InvoiceDate;

SELECT v.VendorID, v.Name
FROM Vendors v
WHERE v.Name LIKE '%ASA%'       OR v.Name LIKE '%City Electric%'
   OR v.Name LIKE '%McMaster%'  OR v.Name LIKE '%Mediterranean%'
   OR v.Name LIKE '%Amazon%'    OR v.Name LIKE '%AMZN%'
   OR v.Name LIKE '%Gilbert%'   OR v.Name LIKE '%Northern Plastic%'
   OR v.Name LIKE '%Vista%'     OR v.Name LIKE '%MATIC%'
   OR v.Name LIKE '%Major Man%' OR v.Name LIKE '%Sticky%'
   OR v.Name LIKE '%Canadian Tire%' OR v.Name LIKE '%Grainger%'
   OR v.Name LIKE '%K and F%'   OR v.Name LIKE '%K & F%'
   OR v.Name LIKE '%Electro Sonic%' OR v.Name LIKE '%Akhurst%'
   OR v.Name LIKE '%Lakeside%'  OR v.Name LIKE '%International Distrib%'
   OR v.Name LIKE '%Wayside%'
ORDER BY v.Name;

/* ============================================================================
   Freight / non-PO invoice existence check  —  Seradex (SQL Server)

   PURPOSE
     Takes a list of invoices harvested from the "3 Freight awaiting approval"
     mail folder and tells you, per invoice, whether it already exists in
     Seradex AP. Output drives where each email gets filed.

   HOW TO USE
     STAGE 1 - run the discovery queries, note your real table/column names.
     STAGE 2 - fill in the CONFIG section, paste your invoice list, run it.

   WARNING
     The object names in STAGE 2 are PLACEHOLDERS. They are not real Seradex
     names. Do not run STAGE 2 until STAGE 1 has told you what to substitute.
     Read-only: SELECTs and a #temp table. Nothing is written to Seradex.
   ========================================================================= */


/* ============================================================================
   STAGE 1 — DISCOVERY.  Run these first, one at a time.
   ========================================================================= */

-- 1a. Candidate AP invoice tables.
SELECT  s.name AS [schema], t.name AS [table], p.rows AS [row_count]
FROM    sys.tables t
JOIN    sys.schemas s ON s.schema_id = t.schema_id
JOIN    sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE   t.name LIKE '%Invoice%'
   OR   t.name LIKE '%APInv%'
   OR   t.name LIKE '%Voucher%'
   OR   t.name LIKE '%Payable%'
ORDER BY p.rows DESC;

-- 1b. Candidate vendor/supplier tables.
SELECT  s.name AS [schema], t.name AS [table], p.rows AS [row_count]
FROM    sys.tables t
JOIN    sys.schemas s ON s.schema_id = t.schema_id
JOIN    sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE   t.name LIKE '%Vendor%'
   OR   t.name LIKE '%Supplier%'
ORDER BY p.rows DESC;

-- 1c. Columns on whichever table 1a identified. Change the literal first.
SELECT  c.name AS [column], ty.name AS [type], c.max_length, c.is_nullable
FROM    sys.columns c
JOIN    sys.types ty ON ty.user_type_id = c.user_type_id
WHERE   c.object_id = OBJECT_ID('dbo.REPLACE_WITH_AP_INVOICE_TABLE')
ORDER BY c.column_id;

-- 1d. Eyeball real data so you can see how invoice numbers are actually
--     stored (padding, prefixes, embedded spaces) before you trust a join.
-- SELECT TOP 50 * FROM dbo.REPLACE_WITH_AP_INVOICE_TABLE ORDER BY 1 DESC;


/* ============================================================================
   STAGE 2 — THE CHECK.  Fill in CONFIG, paste your list, run.
   ========================================================================= */

SET NOCOUNT ON;

/* ---- CONFIG: replace these three with what STAGE 1 told you -------------- */
--   AP invoice table   ->  dbo.APInvoiceHeader        (example only)
--   invoice-number col ->  InvoiceNumber              (example only)
--   vendor-id col      ->  VendorID                   (example only)
/* ------------------------------------------------------------------------- */

IF OBJECT_ID('tempdb..#EmailInvoices') IS NOT NULL DROP TABLE #EmailInvoices;

CREATE TABLE #EmailInvoices (
    VendorName      NVARCHAR(200),
    InvoiceNumber   NVARCHAR(100),
    InvoiceAmount   DECIMAL(18,2) NULL,
    EmailReceived   DATE          NULL
);

/* Paste the harvested invoices here. One row per email.
   The rows below are a worked example using real senders from the folder —
   REPLACE them with the actual harvested list.                              */
INSERT INTO #EmailInvoices (VendorName, InvoiceNumber, InvoiceAmount, EmailReceived) VALUES
    (N'DHL Express',            N'YVRR003314791',  72.61,   '2026-10-01'),
    (N'DHL Express',            N'YVRIR03021316',  445.25,  '2026-10-01'),
    (N'DHL Express',            N'YVRIR03021317',  106.74,  '2026-10-01'),
    (N'Load Warrior Logistics', N'43853',          1851.12, '2026-10-02'),
    (N'ACE Courier',            N'9835203',        NULL,    '2026-09-29');

/* Normalise once: strip spaces/dashes, uppercase, so the join is not defeated
   by cosmetic differences between the email and the Seradex entry.          */
IF COL_LENGTH('tempdb..#EmailInvoices','InvNorm') IS NULL
    ALTER TABLE #EmailInvoices ADD InvNorm AS
        UPPER(REPLACE(REPLACE(LTRIM(RTRIM(InvoiceNumber)), ' ', ''), '-', '')) PERSISTED;

SELECT
    e.VendorName,
    e.InvoiceNumber,
    e.InvoiceAmount                                   AS EmailAmount,
    e.EmailReceived,
    CASE WHEN s.InvoiceNumber IS NULL
         THEN 'NOT IN SERADEX  -> needs entry'
         ELSE 'IN SERADEX      -> file as entered'
    END                                               AS Status,
    s.InvoiceNumber                                   AS SeradexInvoiceNo,
    s.VendorID                                        AS SeradexVendor,
    s.InvoiceAmount                                   AS SeradexAmount,
    CASE
        WHEN s.InvoiceNumber IS NULL              THEN NULL
        WHEN e.InvoiceAmount IS NULL              THEN 'amount not captured from email'
        WHEN ABS(s.InvoiceAmount - e.InvoiceAmount) < 0.01 THEN 'amounts agree'
        ELSE 'AMOUNT MISMATCH - review before filing'
    END                                               AS AmountCheck
FROM        #EmailInvoices AS e
LEFT JOIN   dbo.REPLACE_WITH_AP_INVOICE_TABLE AS s      -- <<< CONFIG
       ON   UPPER(REPLACE(REPLACE(LTRIM(RTRIM(
                s.InvoiceNumber                         -- <<< CONFIG
            )), ' ', ''), '-', '')) = e.InvNorm
ORDER BY    CASE WHEN s.InvoiceNumber IS NULL THEN 0 ELSE 1 END,
            e.VendorName,
            e.InvoiceNumber;


/* ---- Summary counts, for sanity before you start dragging emails -------- */
SELECT
    COUNT(*)                                                   AS TotalEmailed,
    SUM(CASE WHEN s.InvoiceNumber IS NULL THEN 1 ELSE 0 END)   AS NotInSeradex,
    SUM(CASE WHEN s.InvoiceNumber IS NOT NULL THEN 1 ELSE 0 END) AS AlreadyEntered
FROM        #EmailInvoices AS e
LEFT JOIN   dbo.REPLACE_WITH_AP_INVOICE_TABLE AS s              -- <<< CONFIG
       ON   UPPER(REPLACE(REPLACE(LTRIM(RTRIM(
                s.InvoiceNumber                                 -- <<< CONFIG
            )), ' ', ''), '-', '')) = e.InvNorm;


/* ============================================================================
   KNOWN TRAPS — check these before trusting a "NOT IN SERADEX" result
   ----------------------------------------------------------------------------
   1. One email, many invoices. Scan Global and Van Kam send a single mail
      covering several invoices. Each needs its own row above, or the whole
      batch reads as missing.
   2. Vendor-side prefixes. Summit bills as S00296085 but may sit in Seradex
      without the S, or zero-padded differently. If a vendor comes back 100%
      missing, that is a format mismatch, not 100% unentered.
   3. The join is on invoice number alone. If two vendors ever reuse a number
      you will get a false match — add vendor to the ON clause once you know
      how VendorID maps to these sender names.
   4. Credit notes can carry the same number as the invoice they reverse.
   5. Entered-but-unposted invoices may live in a staging table rather than
      the one you join to, and would read as missing.
   ========================================================================= */

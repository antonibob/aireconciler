/* ---------------------------------------------------------------------------
   Seradex OrderStream - AP import surface discovery                READ ONLY

   Answers, from Talius's side and without waiting for Seradex: does a
   supported AP import path already exist in this database?

   Every statement below is a SELECT against catalog views. Nothing is created,
   altered, dropped or inserted. Even so:

     * The AppBox database is Seradex's infrastructure. Clear this with Nity
       before running it against production.
     * Run it in SSMS as yourself, in a single session. Do not schedule it.
     * Catalog scans are cheap but not free; run it outside month-end close.

   Read the results as a shortlist of things to ASK Seradex about. Finding a
   promising table is not permission to write to it - see
   docs/OPTION1_HOST_SIDE_FEASIBILITY.md section 2 for why a raw INSERT into an
   AP subledger is the wrong move even when it is possible.
--------------------------------------------------------------------------- */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;  -- never block a live user

PRINT '=== 0. Context ===============================================';
SELECT
    @@SERVERNAME                        AS server_name,
    DB_NAME()                           AS database_name,
    SUSER_SNAME()                       AS running_as,
    @@VERSION                           AS sql_version;


PRINT '=== 1. Tables that look like AP / vendor invoice storage ======';
/* Row counts come from sys.dm_db_partition_stats: no scan, and it shows which
   of several similarly-named tables is the one actually in use. */
SELECT
    s.name                              AS [schema],
    t.name                              AS [table],
    SUM(CASE WHEN p.index_id IN (0, 1) THEN p.row_count ELSE 0 END) AS [rows],
    t.create_date,
    t.modify_date
FROM sys.tables t
JOIN sys.schemas s              ON s.schema_id = t.schema_id
LEFT JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id
WHERE t.name LIKE '%VendorInvoice%'
   OR t.name LIKE '%APInvoice%'
   OR t.name LIKE '%Voucher%'
   OR t.name LIKE '%Payable%'
   OR (t.name LIKE '%AP[_]%' AND t.name NOT LIKE '%Application%')
GROUP BY s.name, t.name, t.create_date, t.modify_date
ORDER BY [rows] DESC, t.name;


PRINT '=== 2. Staging / import / batch tables ========================';
/* This is the money query. A supported import almost always lands in a staging
   table first - if one exists for AP, its name shows up here. */
SELECT
    s.name                              AS [schema],
    t.name                              AS [table],
    SUM(CASE WHEN p.index_id IN (0, 1) THEN p.row_count ELSE 0 END) AS [rows],
    t.create_date
FROM sys.tables t
JOIN sys.schemas s              ON s.schema_id = t.schema_id
LEFT JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id
WHERE t.name LIKE '%Import%'
   OR t.name LIKE '%Staging%'
   OR t.name LIKE '%Stage%'
   OR t.name LIKE '%Batch%'
   OR t.name LIKE '%Inbound%'
   OR t.name LIKE '%Interface%'
   OR t.name LIKE '%Queue%'
GROUP BY s.name, t.name, t.create_date
ORDER BY t.name;


PRINT '=== 3. Columns of whatever AP header table is in use ==========';
/* Shows what a supported insert would have to supply - and, by its sheer
   width, why hand-rolling one is a bad idea. */
SELECT
    s.name                              AS [schema],
    t.name                              AS [table],
    c.column_id,
    c.name                              AS [column],
    TYPE_NAME(c.user_type_id)           AS [type],
    c.max_length,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    dc.definition                       AS default_definition
FROM sys.columns c
JOIN sys.tables t               ON t.object_id = c.object_id
JOIN sys.schemas s              ON s.schema_id = t.schema_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE t.name LIKE '%VendorInvoice%'
   OR t.name LIKE '%APInvoice%'
ORDER BY s.name, t.name, c.column_id;


PRINT '=== 4. Procedures / functions that import or post AP ==========';
/* Name match first: a proc named usp_ImportVendorInvoice is the whole answer. */
SELECT
    s.name                              AS [schema],
    o.name                              AS [object],
    o.type_desc,
    o.create_date,
    o.modify_date
FROM sys.objects o
JOIN sys.schemas s              ON s.schema_id = o.schema_id
WHERE o.type IN ('P', 'FN', 'IF', 'TF')
  AND (o.name LIKE '%Import%'
    OR o.name LIKE '%VendorInvoice%'
    OR o.name LIKE '%APInvoice%'
    OR o.name LIKE '%Voucher%'
    OR o.name LIKE '%PostAP%')
ORDER BY o.name;


PRINT '=== 5. Routine bodies mentioning both import and AP ===========';
/* Catches procs whose name gives nothing away. Body text only - not executed. */
SELECT
    s.name                              AS [schema],
    o.name                              AS [object],
    o.type_desc,
    LEN(m.definition)                   AS definition_chars,
    o.modify_date
FROM sys.sql_modules m
JOIN sys.objects o              ON o.object_id = m.object_id
JOIN sys.schemas s              ON s.schema_id = o.schema_id
WHERE (m.definition LIKE '%import%' OR m.definition LIKE '%staging%')
  AND (m.definition LIKE '%vendorinvoice%'
    OR m.definition LIKE '%apinvoice%'
    OR m.definition LIKE '%voucher%'
    OR m.definition LIKE '%payable%')
ORDER BY o.name;
/* To read one:  SELECT definition FROM sys.sql_modules
                 WHERE object_id = OBJECT_ID('dbo.<name>');                  */


PRINT '=== 6. Tables carrying the API Import objects config ==========';
/* Seradex''s release notes name an "API Import object", a "GenericFileSQL"
   import type and "ImportOrder" TransactionType handling. If those are
   configured per-tenant, the config lives in a table - and its contents say
   which document types the framework already knows how to import. */
SELECT
    s.name                              AS [schema],
    t.name                              AS [table],
    c.name                              AS [column]
FROM sys.columns c
JOIN sys.tables t               ON t.object_id = c.object_id
JOIN sys.schemas s              ON s.schema_id = t.schema_id
WHERE c.name LIKE '%ImportType%'
   OR c.name LIKE '%TransactionType%'
   OR c.name LIKE '%ImportFormat%'
   OR c.name LIKE '%DocumentType%'
ORDER BY t.name, c.name;


PRINT '=== 7. SQL Agent jobs that already move data =================';
/* Needs read on msdb; skip if permission is denied. An existing scheduled
   import job is the cheapest possible answer - something already does this. */
BEGIN TRY
    SELECT
        j.name                          AS job_name,
        j.enabled,
        js.step_id,
        js.step_name,
        js.subsystem,
        LEFT(js.command, 400)           AS command_head
    FROM msdb.dbo.sysjobs j
    JOIN msdb.dbo.sysjobsteps js        ON js.job_id = j.job_id
    WHERE j.name LIKE '%import%'
       OR j.name LIKE '%invoice%'
       OR j.name LIKE '%integration%'
       OR js.command LIKE '%import%'
    ORDER BY j.name, js.step_id;
END TRY
BEGIN CATCH
    PRINT '  (no access to msdb - ask Nity or Seradex to run section 7)';
END CATCH;


PRINT '=== 8. Linked servers and external interfaces ================';
SELECT name, product, provider, data_source, is_linked
FROM sys.servers
WHERE is_linked = 1;

PRINT '=== done. Nothing was modified. ==============================';

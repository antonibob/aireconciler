/* Seradex write-path discovery — read-only.
   Looks for a supported way to get invoices IN without driving the GUI.
   Catalog metadata only; reads no ERP data, changes nothing.
   SSMS, Results to Text (Ctrl+T). */

USE ActiveM_Talius_Test;
GO

PRINT '===== 1. IS THIS APP PROCEDURE-DRIVEN? =====';
/* Thousands of procs => the client calls procs, and we can call the same ones.
   Near zero => the client sends inline SQL, and only a trace will reveal it. */
SELECT COUNT(*) AS total_procedures FROM sys.procedures;

PRINT '===== 2. PROCEDURES THAT LOOK LIKE INVOICE / AP WRITES =====';
SELECT name, modify_date
FROM sys.procedures
WHERE (name LIKE '%Insert%' OR name LIKE '%Add%'    OR name LIKE '%Create%'
    OR name LIKE '%Save%'   OR name LIKE '%Post%'   OR name LIKE '%Import%'
    OR name LIKE '%New%'    OR name LIKE '%Update%')
  AND (name LIKE '%Invoice%' OR name LIKE '%AP%'    OR name LIKE '%Payable%'
    OR name LIKE '%Voucher%' OR name LIKE '%Vendor%')
ORDER BY name;

PRINT '===== 3. ANY IMPORT-RELATED PROCEDURE =====';
SELECT name, modify_date
FROM sys.procedures
WHERE name LIKE '%Import%' OR name LIKE '%Load%' OR name LIKE '%Bulk%'
ORDER BY name;

PRINT '===== 4. STAGING / INTERFACE / IMPORT TABLES =====';
/* If Seradex ships an import facility, it usually lands rows here first.
   A staging table IS the supported bulk-entry path. */
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE t.name LIKE '%Import%'    OR t.name LIKE '%Staging%'
   OR t.name LIKE '%Interface%' OR t.name LIKE '%Queue%'
   OR t.name LIKE '%Inbound%'   OR t.name LIKE '%Temp%'
GROUP BY t.name
ORDER BY t.name;

PRINT '===== 5. PARAMETERS OF THE MOST LIKELY INVOICE-INSERT PROC =====';
/* Parameter names describe the fields an invoice needs — effectively the
   import format, without asking anyone. */
SELECT p.name AS proc_name,
       par.name AS parameter,
       TYPE_NAME(par.user_type_id) AS data_type,
       par.max_length
FROM sys.procedures p
JOIN sys.parameters par ON par.object_id = p.object_id
WHERE p.name LIKE '%Invoice%'
  AND (p.name LIKE '%Insert%' OR p.name LIKE '%Add%' OR p.name LIKE '%Create%')
ORDER BY p.name, par.parameter_id;

PRINT '===== 6. TRIGGERS ON THE INVOICE TABLES =====';
/* Triggers are business logic a raw INSERT would fire — or bypass.
   Their presence argues strongly for calling procs rather than inserting. */
SELECT OBJECT_NAME(tr.parent_id) AS on_table, tr.name AS trigger_name, tr.is_disabled
FROM sys.triggers tr
WHERE OBJECT_NAME(tr.parent_id) LIKE '%Invoice%'
   OR OBJECT_NAME(tr.parent_id) LIKE '%AP%'
ORDER BY on_table, trigger_name;

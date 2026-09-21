/* Seradex discovery — read-only.
   Reads catalog metadata only; touches no ERP data and changes nothing.
   Run in SSMS with Results to Text (Ctrl+T). */

USE ActiveM_Talius_Test;
GO

PRINT '===== 1. CONNECTED AS =====';
SELECT SUSER_NAME()                    AS login_name,
       IS_SRVROLEMEMBER('sysadmin')    AS is_sysadmin,
       DB_NAME()                       AS current_db;

PRINT '===== 2. DATABASE AGE =====';
SELECT name, create_date, state_desc
FROM sys.databases
WHERE name LIKE 'ActiveM%' OR name LIKE 'sx%' OR name LIKE 'SX%';

PRINT '===== 3. TEST DB LAST REFRESHED =====';
SELECT TOP 5 destination_database_name, restore_date
FROM msdb.dbo.restorehistory
WHERE destination_database_name LIKE '%Talius%'
ORDER BY restore_date DESC;

PRINT '===== 4. TABLE COUNT =====';
SELECT COUNT(*) AS total_tables FROM sys.tables;

PRINT '===== 5. TOP 40 TABLES BY ROWS =====';
SELECT TOP 40
       t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY t.name
ORDER BY SUM(p.rows) DESC;

PRINT '===== 6. AP / PO SURFACE =====';
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE t.name LIKE '%Invoice%'  OR t.name LIKE '%Vendor%'
   OR t.name LIKE '%Purchase%' OR t.name LIKE '%Payment%'
   OR t.name LIKE '%Supplier%' OR t.name LIKE '%APDist%'
GROUP BY t.name
HAVING SUM(p.rows) > 0
ORDER BY SUM(p.rows) DESC;

PRINT '===== 7. VIEWS (possibly pre-built joins worth reusing) =====';
SELECT TOP 30 name FROM sys.views ORDER BY name;

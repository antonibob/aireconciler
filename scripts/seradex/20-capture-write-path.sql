/* Capture the SQL the Seradex client sends when saving an invoice.

   PART 1 is read-only — it reads the plan cache. Try this first.
   PART 2 creates a server-side Extended Events session. That IS a change to
   the server (a diagnostic object, no ERP data touched), and it is removable.
   Only run PART 2 if PART 1 comes up empty and you're comfortable creating
   a diagnostic session on the host. */


/* ================= PART 1 — plan cache (read-only) =================
   Enter ONE invoice in Seradex, then run this within a few minutes.
   Ad-hoc statements are not always cached and the cache can be evicted,
   so an empty result does not prove the statements didn't run. */

SELECT TOP 100
       qs.last_execution_time,
       qs.execution_count,
       SUBSTRING(st.text, 1, 4000) AS sql_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
WHERE (st.text LIKE '%POInvoicing%' OR st.text LIKE '%QtyInvoicedToDate%')
  AND st.text NOT LIKE '%dm_exec_query_stats%'      -- exclude this query
  AND qs.last_execution_time > DATEADD(MINUTE, -15, GETDATE())
ORDER BY qs.last_execution_time DESC;


/* ================= PART 2 — Extended Events (creates an object) =========

CREATE EVENT SESSION [seradex_write_path] ON SERVER
ADD EVENT sqlserver.sql_batch_completed (
    ACTION (sqlserver.client_app_name, sqlserver.username, sqlserver.database_name)
    WHERE sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%POInvoicing%')
),
ADD EVENT sqlserver.rpc_completed (
    ACTION (sqlserver.client_app_name, sqlserver.username, sqlserver.database_name)
    WHERE sqlserver.like_i_sql_unicode_string(sqlserver.sql_text, N'%POInvoicing%')
)
ADD TARGET package0.ring_buffer (SET max_memory = 8192)
WITH (MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = OFF);

-- start it, enter ONE invoice in Seradex, then stop it
ALTER EVENT SESSION [seradex_write_path] ON SERVER STATE = START;
-- ... enter the invoice now ...
ALTER EVENT SESSION [seradex_write_path] ON SERVER STATE = STOP;

-- read what it caught
SELECT
    ev.value('(@timestamp)[1]', 'datetime2')                      AS occurred,
    ev.value('(action[@name="client_app_name"]/value)[1]','nvarchar(256)') AS app,
    ev.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)')        AS statement
FROM (
    SELECT CAST(t.target_data AS xml) AS x
    FROM sys.dm_xe_session_targets t
    JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address
    WHERE s.name = 'seradex_write_path' AND t.target_name = 'ring_buffer'
) AS d
CROSS APPLY d.x.nodes('//event') AS q(ev)
ORDER BY occurred;

-- clean up when done
DROP EVENT SESSION [seradex_write_path] ON SERVER;

======================================================================== */

# Giving a local Claude session read access to Seradex

Setup for running an agent **on your existing machine** against the Seradex SQL
Server. No second laptop required — nothing here touches the mouse or keyboard,
so it runs in the background while you work.

**Target:** `ActiveM_Talius_Test` (the test copy) for all exploration.
**Server:** `HOSTED05\SQL19` — SQL Server 2019.

---

## Known databases

| Database | What it is | Use it for |
|---|---|---|
| `ActiveM_Talius` | Seradex production — Talius | read-only queries, once the schema is understood |
| `ActiveM_Talius_Test` | test copy of the above | **all exploration and every write test** |
| `ActiveM_Seaton` | second company on the same install | TBD — see open questions |
| `sxSystem_Talius` | Seradex system DB: users, permissions, config | understanding security, not transactions |
| `SX_Dashboard` | reporting / dashboard layer | possibly pre-built views worth reusing |

> The `ActiveM_` prefix is the company database; `sx` is Seradex's own prefix.
> Confirm the freshness of the test copy before trusting its *data* — its
> *schema* is useful regardless.

---

## Step 1 — a read-only login (ask the DBA)

The automation must never run as an account that can post. This is for whoever
administers the server to run — it is the only write operation in this document,
and it creates a login, not ERP data.

```sql
-- On HOSTED05\SQL19, as an admin:
CREATE LOGIN [talius_readonly] WITH PASSWORD = '<generated, stored in a vault>';

USE ActiveM_Talius_Test;
CREATE USER [talius_readonly] FOR LOGIN [talius_readonly];
ALTER ROLE db_datareader ADD MEMBER [talius_readonly];

USE ActiveM_Talius;
CREATE USER [talius_readonly] FOR LOGIN [talius_readonly];
ALTER ROLE db_datareader ADD MEMBER [talius_readonly];
```

`db_datareader` grants `SELECT` on every table and nothing else. No insert, no
update, no delete, no schema changes.

Verify it worked by connecting as that login and confirming this **fails**:

```sql
-- expected: "The UPDATE permission was denied"
UPDATE <some_table> SET <col> = <col> WHERE 1 = 0;
```

A read-only login that can't be proven read-only isn't one.

---

## Step 2 — prove connectivity with `sqlcmd`

`sqlcmd` ships with SSMS, so it's already on the machine.

```bat
sqlcmd -S HOSTED05\SQL19 -U talius_readonly -P <password> ^
       -d ActiveM_Talius_Test -Q "SELECT COUNT(*) FROM sys.tables;"
```

If that returns a number, an agent on this machine can reach the database.
That's the whole dependency.

---

## Step 3 — connect the agent

Two options, in increasing order of cleanliness.

**a) `sqlcmd` shell-out.** Zero setup. The agent writes a query, runs it via
Bash/cmd, reads the output. Good enough to start today. Downside: the password
appears in command lines and therefore in the transcript.

**b) An MCP server for SQL Server.** Microsoft publishes one. Credentials live
in the MCP config, the agent gets typed query tools, and nothing sensitive lands
in the conversation. This is the version worth building once the approach proves
out.

Either way the connection string and password live **on the machine** — in the
MCP config or a `.env` that is gitignored. Never in a chat message, never
committed. This repo's `.gitignore` should be checked before any config file is
added near it.

---

## Step 4 — the first exploration run

Point the local session at the test database with roughly this brief:

> You have read-only SQL access to `ActiveM_Talius_Test`, a copy of our Seradex
> ERP. Map the accounts-payable surface: vendors, purchase orders, invoices,
> payments, and how they relate. Use `INFORMATION_SCHEMA` and the `sys` catalog
> views to find tables, then sample with `SELECT TOP 20` to understand what the
> columns actually hold — column names in this schema are not self-explanatory.
> Write your findings to `docs/seradex/ap-data-model.md` as you go: table
> purpose, the columns that matter, join keys, and anything ambiguous. Flag
> guesses as guesses. Do not attempt any write.

The output of that run is the artifact. Everything later — reconciliation
queries, extracts feeding the Excel engine, eventually GUI automation — starts
from that file rather than from scratch.

---

## Open questions

- [ ] How recently was `ActiveM_Talius_Test` refreshed from production?
- [ ] Is `ActiveM_Seaton` a related Talius entity or a separate client? Do
      invoices or payments ever cross between the two companies?
- [ ] Does `SX_Dashboard` contain maintained views worth reading instead of
      reconstructing the joins ourselves?
- [ ] Does the license include the import tools or API module, for the eventual
      write path?

---

## What this deliberately does not do

No writes to any Seradex database, through SQL or otherwise. The write path goes
through Seradex's own import tools or API so that its referential integrity and
audit trail stay intact — see `ERP_AUTOMATION.md`. Reads are safe and reversible;
writes are neither.

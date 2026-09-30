# Client isolation and audit log (2026-09-30)

Status: built 2026-09-30. Two guards so wren can hold many businesses' data safely.

1. **Each client database has its own Postgres login.** That login can open its own database and nothing else.
2. **Every database keeps an audit log.** Who changed which row, when, and from where. Rows are chained into seals, so a later edit shows.

William's ask: "clear data separation, audit logs, rls, and isolation levels" for everything built so far. Owner keys in autobrowse and credvault are the third piece: autobrowse `designs/2026-09-30-owner-keys.md`.

## 1. Client logins

- **Role = database name.** `wren_client_<id>` is both. `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`.
- **Password is derived, not stored.** HMAC-SHA256 of `"wren client login:" + database`, keyed by main's password. No new secret, no SSM read. Main's password changes → the next migrate resets every client's.
- **Main's URL must have a password and a host.** Without a password there is nothing secret to derive from. Without a host, `URL` silently drops the user, and the client URL would connect as main. Both throw.
- **Only the SCRAM verifier reaches Postgres.** The plaintext never appears in SQL, so it cannot land in a server log.
- **What the login may do.** Connect to its own database. Read and write every table there (`SELECT INSERT UPDATE DELETE TRUNCATE`), draw ids from sequences (`USAGE, SELECT`; no `UPDATE`, so no `setval` rewinding ids), read the migrations table. It owns nothing, so it cannot alter tables, turn triggers off or reset a sequence. No temp tables. Audit tables are read-only to it; their sequences are closed to it.
- **What it can still do to itself.** Change its own password, or give itself settings (`ALTER ROLE ... SET`). Every migrate sets the password again and clears those settings (`RESET ALL`, per database too). It can `LOCK` its own tables.
- **Nobody else connects.** `PUBLIC` loses `CONNECT` and `TEMPORARY` on main, on `postgres` and on every client database. `createDatabase` does it the moment a database exists, so there is no open window before the first grant.
- **Two URLs** (`packages/db/src/clients.ts`):
  - `clientDatabaseUrl(mainUrl, database)`: the client's own login. Everything that reads or writes client data uses this (worker, CLI `--client`, portal).
  - `clientAdminUrl(mainUrl, database)`: main's login, database swapped. Only migrations and grants use it.
- **Applied on every migrate.** `migrateClient` migrates, then `grantClientAccess` makes the role, sets its password, clears its settings and grants. `addClient` and `pnpm db:migrate` both go through it.
- **Limits.**
  - The worker still holds main's URL, and main's login is a superuser, so the worker can derive any client's login. This guards against bugs (the wrong client's pool, a main query run on a client), not against a stolen worker. A per-client worker holding only its own login is now possible; nothing needs it yet.
  - The catalog is shared: a client login can list the other roles and database names, and see other sessions' login and `application_name` in `pg_stat_activity` (never their query text). Client ids are not secret; names live in main's `clients` table, which it cannot open.

## 2. Audit log

In every database. Typed tables in `packages/db/src/audit/schema.ts`, the SQL in `audit/install.ts`. `installAudit` runs at the end of every `migrate()`.

- **`audit_events`**: `id, at, era, tx, table_name, op, row_key, old_values, new_values, db_user, app, actor`. `at` is the transaction's start time.
  - `insert`: the key only (the row itself is in the table).
  - `update`: only the columns that changed, old and new. An update that changes nothing is skipped.
  - `delete`: the key and the whole old row.
  - `truncate`: one row per table emptied, no data. A cascade or a partitioned table logs each table it empties.
  - A table without a primary key logs whole rows, updates included: nothing else names the row.
- **`audit_seals`**: `id, sealed_at, from_era, from_tx, through_era, through_tx, events, prev_hash, hash`.
- **`audit_eras`**: each server the database has lived on, in order (`era, cluster, follows, began_at`).

Who:

- `db_user`: the Postgres login (`session_user`). A client login proves which client database's app wrote it. The only field a client cannot forge.
- `app`: the connection's `application_name`: `wren-worker`, `wren-cli:<command>`, `wren-migrate`. When code names the app, an `application_name` in the URL is dropped, so a URL cannot relabel it.
- `actor`: the person, when one is known. The portal sets it to the viewer's email per write (transaction-local, so it never leaks to the next write on a pooled connection). The CLI sets it at connect: `claude-code` under Claude Code, else the OS user.
- A client login can set its own `app` and `actor` to anything. Trust them as labels from our own code, not as proof.

How:

- **One trigger function** `audit_row()`, `SECURITY DEFINER`, on every table of every schema (`public`, `books`, any new one) except the skip lists. Outside `public` a table is logged as `schema.table`. A statement trigger records `TRUNCATE`.
- **Every audit function puts `pg_temp` last** in its `search_path`: a session's temp table named `audit_events` can never catch the log's writes.
- **Append-only.** A guard trigger refuses `UPDATE`, `DELETE`, `TRUNCATE` on the three audit tables.
- **Triggers follow the schema.** After every migrate, `syncAuditTriggers` puts the trigger on each table not skipped, with its primary key columns, and removes it from skipped ones. A new table is audited by default. A dropped trigger comes back; one turned off is turned back on (guards too). One statement per table, so it locks one table at a time and never deadlocks a live worker.
- **Partitions.** The row trigger lives on the parent; Postgres clones it onto each partition (a partition's own would log each change twice). `TRUNCATE` triggers are not cloned, so each partition gets its own. A partition is skipped when its root is.
- **Seals chain.** Position = `(era, tx)`. `audit_seal()` takes every event below `(this server's era, the oldest running transaction)` not sealed yet, ordered by `(era, tx, id)`. `hash = sha256(prev_hash || sha256(line1) || sha256(line2) ...)`, each line the event as a JSON array. A seal is written only when there are new events. It needs `READ COMMITTED` and refuses anything else; an advisory lock keeps two sealers apart.
- **Eras.** `tx` only grows on one server. A restore onto another server (a new cluster) starts it again lower, so a plain `tx` range would never seal again. `audit_era()` compares Postgres's `system_identifier` with the newest era's; a different server opens the next era. `(era, tx)` then keeps growing. A restore on the same server keeps its era (`tx` never goes back there). `UNIQUE (cluster, follows)` makes two first writers on a new server agree on one era.
- **Verify.** `audit_verify()` recomputes every seal: ranges touch, each `prev_hash` is the seal before, counts and hashes match. An edited, deleted or inserted sealed event breaks its seal.
- **Sealer loop.** `AuditSealer/all` seals main and every client database every 15 minutes, as each client's own login, 4 databases at a time. Each seal is its own `READ COMMITTED` transaction whatever the login's defaults, and waits at most 10 s for another seal's lock (the next pass retries). A failure names the database and the driver's reason. Each seal's hash goes to the worker log (CloudWatch): a copy the database cannot rewrite.
- **CLI.** `wren [--client id] audit show|seal|verify`. `wren audit verify --all` checks main and every client. `wren audit sealer status|start|stop|sync` runs the loop (refuses `--client`).

Skip list (machine-made, high volume, or already a log):

| Table | Why skipped |
|---|---|
| `runs` | the run ledger, already a log of every stage |
| `inbox_syncs`, `open_syncs` | sync cursors, rewritten every pass |
| `documents` | fetched page bodies, a cache (1.7 GB) |
| `sightings` | raw crawl evidence, append-only |
| `contact_candidates` | address guesses, a million writes |
| `verifications` | verifier verdicts, a cache with its own times |
| `discovery_attempts` | domain probe log |
| `enrichments` | derived company facts, remade by the pipeline |
| `import_errors` | an import's own error log |
| `company_checks`, `person_lookups` | lookup results with their own `tried` trail |
| `postmaster_days`, `content_metrics` | numbers pulled from Google and platforms |
| `open_events` | pixel hits, append-only |

Limits:

- A superuser can turn triggers off and rewrite events and seals. Deleting the newest seals, or re-chaining every seal after an edit, still verifies clean. The CloudWatch copy of each seal hash is what catches that: compare the log's last hash with `audit verify`'s `lastHash`.
- A write the worker makes for a person (a CLI command sent through Restate) shows `app = wren-worker`, no actor. Carrying the actor through Restate is later work.
- The demo reset logs one truncate per table, no rows. Ids keep counting across it.
- No pruning. If the log grows too big: export old sealed ranges to S3, keep the seals, drop the guard for that one delete.

## Decision log

- **2026-09-30** Login per client database, password derived from main's. A stored secret per client would cost an SSM read per client per cold start (KMS budget) and buy nothing while main is a superuser.
- **2026-09-30** No row-level security. Every client already has its own database, a harder wall than RLS on shared tables. RLS would only matter if clients shared tables.
- **2026-09-30** Main stays a superuser for now. Splitting it (a migrator login vs a worker login) is the next step if a stolen worker becomes the worry.
- **2026-09-30** The demo reset drops `restart identity`: resetting a sequence needs its owner, and a client login owns nothing. Ids keep counting up.
- **2026-09-30** Row triggers, not statement triggers with transition tables. Row triggers handle every table the same way, including key changes and tables without keys. The skip list keeps the volume down.
- **2026-09-30** Seal by finished transaction, not by id. Ids are handed out before commit, so a seal by id could miss a slow transaction's rows forever.
- **2026-09-30** Insert logs the key only. The row is in the table; a later update or delete logs what it was.
- **2026-09-30** Installed by code at every migrate, not a numbered migration. It follows the live table list, repairs itself, and never fights a parallel branch for a migration number.
- **2026-09-30** (after the test pass) Eras, keyed by `system_identifier`. A restore onto a new server stalled sealing forever. `pg_control_system()` is open to every login and costs microseconds per call. Rejected: a per-database counter (needs a write per transaction) and timestamps (clocks move back).
- **2026-09-30** Sequences `USAGE, SELECT` only. `UPDATE` lets a client `setval` its ids backwards.
- **2026-09-30** Keyless updates log the whole row. Only the changed columns, with no key, named nothing.
- **2026-09-30** Sealer runs 4 databases at once with a 10 s lock wait. One locked database stalled every other client's seal.
- **2026-09-30** A main URL without a password or host throws. Falling back (keying on the URL, dropping the user) hid a wrong setup.
- **2026-09-30** (after rebasing onto books) Every schema, not only `public`. Books keeps its own `books` schema, and money records are what an audit log is for. `drizzle`, the migration journal, is skipped.

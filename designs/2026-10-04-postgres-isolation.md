# Postgres isolation (2026-10-04)

## Answer first

- Each transaction picks its level by the job it does. The database default stays Read Committed (level 2).
- **Level 4, Serializable:** any transaction that reads, decides, then writes. Money, experiments, replies and bookings, client setup, settings. One helper retries a serialization failure.
- **Level 3, Repeatable Read, read only:** reads whose numbers must agree across queries. Digests, economics, stats, a record list with its count. Read only at 3 never aborts and never blocks a writer, so 4 adds nothing for a read.
- **Level 2, Read Committed:** queue claims with `SKIP LOCKED`, guarded single updates, appends, bulk stages, the audit seal. These rely on 2's behavior. At 3 or 4 a claim throws instead of skipping, and `UPDATE ... WHERE state = 'x'` throws instead of re-checking the new row.
- Every transaction names its level through one of three helpers. A test fails on a bare `.transaction(`.
- Tenants are isolated by database already: one `wren_client_<id>` database and role per client.

## What guards data today

- Restate runs one invocation per Virtual Object key: one send loop per inbox, one SMS sender, one pool per niche or client.
- Partial unique indexes: one active enrollment per company, per person, per address; one enrolled SMS contact per number; one message per enrollment step; one booking per cal.com uid; one suppression per (kind, value).
- Row locks with `SKIP LOCKED` on send claims and reply forwards. The CHECK `message_id_before_send` refuses a send without its id.
- Prod on 2026-10-04: 2.3M transactions, 426 rollbacks, 0 deadlocks, no transaction open past one statement.

## Why not one level everywhere

- Default 4: every autocommit statement can abort (about 1,000 call sites), and every claim and guarded update above breaks. Each would need a retry.
- Default 3: the same retries, and it still allows write skew (two transactions each read a count, both insert).

## Gaps found

1. **Books double post.** `post` reads a bill's live entry outside its transaction, then reverses and inserts inside it. A CLI run that overlaps the daily loop posts one bill twice. No index stops it. Fix: read the live entry inside a level 4 transaction.
2. **Zombie attempts.** When Restate gives up on a Lambda attempt that is still running, two copies of one key run at once. The send claim counts the inbox's sends for its daily cap at level 2, so one extra message can pass. Fix: `pg_advisory_xact_lock` on the sender inside the claim. It stays level 2.
3. **Network inside a transaction.** `reactivation/forward.ts` sends an email while holding a row lock and a pooled connection. It is idempotent (`transport.find`), but a slow send holds both. Fix: claim, commit, send, mark.
4. **Abandoned transactions.** `idle_in_transaction_session_timeout` is 0. A Lambda killed mid-transaction keeps its locks until TCP notices. Fix: 2 min on every app connection, set in `createDb`, so client databases get it too.

## Level map

Starting point for the build. A site not listed goes to 4 if a read decides a write, else 2.

| Level | Sites |
|---|---|
| 4 | Books `post`, `readDocuments`, `keepEmail`, console rows. Delivery engagements and agreements (CLI `delivery.ts`, `delivery/service.ts` write), portal `write`. Experiments `start`, `tick`, `switchSetting`, `move`; candidates `propose`, `approve`, `reject`, `importWinners`. `applyBooking`, invite `propose` and `drop`, `runDisposition`, `markMeetingBooked`, inbox reply `sending`, SMS `classifyReplies` and `labelReply`. Console `change` and `setLook`, email console `asThem` (pauses, campaign controls), drafts `skip` and `unapprove`, reactivation compose `done`. |
| 3 | Console `read`, portal `read` and `records`, email console `sheet`, enrichment and resolution `stats`, CLI enrich stats. Digests, economics and health pages that run several plain queries today. |
| 2 | Send claims (`sendDue`, `sendOne`), `forward`, research stage units, resolution units, `oneWalkAtATime`, inbox `handleMessage`, opens, postmaster, SMS events `result`, SMS `enroll`, compose `enroll` and `enrollCompany` (unique indexes guard), `addClient` (primary key guards), audit install and seal. |

## Shape

- `@wren/db` exports `atomic(db, fn)` (2), `snapshot(db, fn)` (3, read only) and `serializable(db, fn)` (4).
- `serializable` retries `40001` and `40P01` up to 5 tries, 10 to 200 ms jittered, and logs each retry. It reads the code from the error or its `cause` (drizzle wraps it).
- Given an open transaction, each helper runs `fn` in a savepoint on it: the outer level wins, and an error the caller catches undoes only `fn`.
- A level 4 body holds database work only, since it can run more than once.
- Restate retries a failed `ctx.run` too: a second net, not the first.
- A test fails on `.transaction(` outside `packages/db`.

## Done when

- A test shows write skew blocked: two level 4 transactions each count, then insert under a cap of 1. One row lands, the other retries and sees it.
- Every site uses a helper; the check passes.
- The four gaps are fixed.
- Gates pass, deployed, and a day of prod logs shows retries are rare.

Cost: $0. No new infra.

## Decision log

- 2026-10-04: William: "level 3 or 4 definitely", then "where could we do 2, 3, and 4?" Picked per transaction: 4 where a read decides a write, 3 for reads, 2 where code relies on Read Committed or a unique index already guards. Default stays 2 so no plain statement becomes abortable.
- 2026-10-04: Helpers and gaps 1 and 4 first (`packages/db`, `packages/books`). Site moves and gaps 2 and 3 wait for outbound O2 to O4, which touches the same send and compose files.
- 2026-10-05: Idle timeout 2 min → 10 min. Research stage units hold their transaction across a fetch or an LLM call, and claude-code waits up to 5 min. Back to 2 min once that I/O moves out. Sites outside the outbound files (books, delivery, SMS, research, CLI) moved to the helpers; books `readDocuments` and SMS `classifyReplies` now count after commit, since a level 4 body can rerun.
- 2026-10-05: Reactivation sites moved. A nested helper now opens a savepoint, as a nested `.transaction` did: compose catches a unique violation and research catches an LLM error mid-unit, and both need that rollback. Gap 3 declined: forward's row lock is what stops two passes both sending, a lease would need a new column, forwards are rare and a send takes seconds.
- 2026-10-05: The last sites moved after O2 to O4 (channel-email, core console). Email console `asThem` goes to level 4, not 3: it writes pauses and campaign controls after reading them. `addClient` to level 2. Disposition stats and proposed candidates are counted after commit. `scripts/gates.sh lint` now fails on a bare `.transaction(` outside `packages/db`. Gap 2 and the level 3 wraps for multi-query reads are still open.

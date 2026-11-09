# Own runtime on Postgres: off Restate, off Redis

2026-11-09. Status: options, waiting on William's pick. Evidence: `sops/direction/2026-11-08-architecture-simplicity.md` (weaver run 01M6Z964RDSCJGPPFEG6Z3RXT5, 96 findings): Postgres queues fit up to low millions of jobs a day; outside calls stay at-least-once in any runtime; Redis is the weakest part of this stack; move browserless off the t4g.small.

William, 11-08/09: "moving away from restate, leaning down our architecture, building our own systems (message queues, caches, durable workflows with retries, DLQs, save points, porting autobrowse)."

## Goal

One store. Data, workflow state, queue, timers and cache all live in Postgres, so a step and its writes commit in one transaction. Fewer servers: no Restate server, no Redis. Same guarantees we have today: durable steps, retries, timers, one writer per key, dead letters, calls that wait while the Mac sleeps.

## What we use today

| | wren | autobrowse |
|---|---|---|
| Services / objects | 62 / 39 | 6 / 2 |
| `ctx.run` (journaled steps) | 2121 | 34 |
| `ctx.get` / `ctx.set` (object state) | 169 / 140 | 37 / 14 |
| Calls and sends to other handlers | ~340 | 3 |
| `ctx.sleep` (durable timers) | 15 | 3 |

Restate server runs on the pg box (Docker, since 10-06). Handlers run on Lambda and on the box worker. The desk (Mac) dials a tunnel to Restate. Redis has one user (`restate-admin` reads).

The gap this closes: Restate's journal and Postgres are two stores. A step can commit its rows and crash before the journal records it, so it runs again. `2026-11-04-at-least-once.md` and `2026-10-11-dead-letters.md` exist because of that.

## Shape (all options)

```
handler code ──(our Ctx: run, get, set, sleep, call, send)──▶ runtime
                                                               │
                         Postgres: jobs (queue, key, run_at, tries, state: ready|running|done|dead)
                                   steps (job, seq, result)      ← save points (the journal)
                                   object_state (object, key, field, value)
                                   cache (key, value, expires_at) UNLOGGED
workers: box worker (all wren services), desk (Mac, autobrowse services) claim with SKIP LOCKED
```

- **One `Ctx` interface, the Restate subset we use.** Handlers keep `ctx.run`, `ctx.get`, `ctx.set`, `ctx.sleep`, clients. The port of 2121 call sites becomes an import change, not a rewrite. Restate and the new runtime both sit behind it during the move.
- **Step + data, one transaction.** A step that writes Postgres commits its rows and its `steps` row together. A step that calls outside (email, LLM, browser) stays at least once, as today.
- **One writer per key:** `pg_advisory_xact_lock(hash(object, key))` around a claim.
- **Timers:** `run_at` on the job. `ctx.sleep` ends the run and requeues it.
- **Retries and dead letters:** `tries` with backoff; past the cap, state `dead`. The portal's dead-letter page reads the table.
- **Deploy versions:** a job pins the build it started on, or the journal must stay compatible (today's `box-slot.ts` problem, same in every option).
- **Compute:** a long-lived worker. Lambda can't hold a claim loop, so wren services move to the box worker. The box (t4g.small, 2 GB) also holds Postgres and browserless: it may need t4g.medium (about +$12/mo, William's call) once measured.
- **Desk:** claims autobrowse jobs from Postgres over TLS with its own login (only its tables), or through a small HTTP door on the box. Jobs wait as rows while the Mac sleeps.
- **Cache:** `readThrough` and `invalidate` over the `cache` table. Write-through gets atomic invalidation for free.

## Options

| | A. DBOS Transact | B. Own runtime (`@wrenautomation/<name>`) | C. pg-boss + own journal | D. Stay on Restate, drop Redis |
|---|---|---|---|---|
| What | OSS library (MIT): workflows, steps, queues, timers in our Postgres | We write jobs, steps, object state, timers, retries, dead letters | pg-boss does queue, retries, dead letters, cron; we add steps and object state | Keep the runtime, cut Redis |
| Code we own | Adapter only | All (~2-3k lines + tests) | Journal + objects (~1k) | None |
| One-transaction steps | Yes (transaction steps) | Yes, by design | Yes, ours | No |
| Fit to our `Ctx` | Good for run/sleep/send; one writer per key needs a check (partitioned queues) | Exact | Good | Exact |
| Correctness risk | Low: tested by others | Highest: crash windows, timers, versions are ours | Medium | Low |
| Learning | Low | Highest | Medium | None |
| Lock-in | DBOS's tables and decorators | None; also a product (like vireo) | pg-boss tables | Restate |

Priorities, in order: 1) one store and atomic steps, 2) correctness, 3) fewest servers, 4) learning (William builds learning-rich parts himself), 5) cost.

## Recommendation

A wins on 1 to 3: it gives one store and atomic steps without us owning the crash windows. Port behind our `Ctx`, so a later move to B stays an adapter swap.

B wins if learning counts as a goal. It also fits the decoupled-product line (vireo, autobrowse): one runtime that both wren and autobrowse use.

D is the safe floor; it does not meet the goal.

## Move plan (any of A to C)

1. `Ctx` interface + Restate adapter; handlers import it (mechanical, lint guard against direct `restate` imports).
2. New runtime adapter + tables; run one low-risk loop on it (a report loop).
3. Move loops one by one, box worker first, Lambda services onto the box.
4. Autobrowse desk onto the new queue.
5. Drop the Restate server and Redis; delete the adapter.

## Decision log

- 2026-11-09: off Restate and Redis, onto Postgres (William). Runtime pick A/B/C: open.

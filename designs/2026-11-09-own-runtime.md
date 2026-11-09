# Own runtime on Postgres + Lambda: off Restate, off Redis

2026-11-09. Task WA-1217. Status: agreed, building (William, 11-09: "do the entire runtime move now ... strict deterministic tests or lints in place before you begin ... maximize our free lambda").

Evidence: `sops/direction/2026-11-08-architecture-simplicity.md` (weaver run 01M6Z964RDSCJGPPFEG6Z3RXT5, 96 findings): Postgres queues fit up to low millions of jobs a day; outside calls stay at-least-once in any runtime; Redis is the weakest part of this stack; move browserless off the t4g.small.

## Goal

One store and fewer servers. Workflow state, queue, timers, object state and cache live in the same Postgres as the data, so a step and its writes can commit in one transaction. Lambda does the compute, inside its free allowance. Gone: the Restate server, Redis, browserless on the box.

Kept, unchanged for handler code: durable steps, retries, timers, one writer per key, object state, calls and sends between handlers, awakeables, idempotency keys, dead letters, calls that wait while the Mac sleeps.

## Today (measured 11-09)

| | wren | autobrowse |
|---|---|---|
| Services / objects | 62 / 39 | 6 / 2 |
| `ctx.run` | 855 | 34 |
| `ctx.get` / `set` / `clear` | 76 / 71 / 15 | 37 / 14 / 0 |
| Clients (call + send) | ~117 | 3 |
| `ctx.sleep` / `awakeable` / `orTimeout` | 5 / 6 / 5 | 3 / 0 / 0 |
| Files importing a Restate SDK | 242 (51 testcontainers tests, 72 ingress clients) | ~8 |

Lambda `wren-prod-worker`, 30 days: about 5k invocations a day since 11-04 (retry storms on 10-27, 10-29, 10-30 made 7.1M of the 7.9M). Duration 128.7k GB-s of the 400k free. The free allowance (1M requests, 400k GB-s a month) is mostly unused.

## Why our own runtime, not DBOS (11-09)

William's constraint: maximize free Lambda. DBOS runs workflows inside a process that polls Postgres, so its compute would sit on the box and Lambda would go unused. Restate's model (a server pushes each turn to Lambda, the handler replays its journal) is the one that uses Lambda. We build that model on Postgres. AWS Lambda durable functions were rejected: state in AWS, not our Postgres, not self-hostable.

| Option | Lambda use | One store | Code we own |
|---|---|---|---|
| A. DBOS on the box | Offload only | Yes | Adapter |
| **B. Own runtime: Postgres journal + dispatcher → Lambda** | **Full** | **Yes** | **Runtime (~3k lines)** |
| C. pg-boss + own journal | Needs the same dispatcher | Yes | ~2k |
| D. Stay on Restate, drop Redis | Full | No | None |

Picked B. Priorities: 1) handler code does not change, 2) correctness proven by tests before any move, 3) one store, 4) Lambda for compute, 5) fewer servers and $.

## Shape

```
CLI, portal Worker, webhooks ──HTTPS──▶ door (box worker, Caddy)  ─┐
                                                                    ▼
Postgres  rt.invocations (target, key, input, status, run_at, tries, lease, build, idem key, parent)
          rt.journal     (invocation, seq, kind, name, result | error)        ← save points
          rt.state       (service, key, name, value)                          ← object state
          rt.cache       (key, value, expires_at)  UNLOGGED                   ← Redis's job
                                                                    │ LISTEN/NOTIFY + run_at timer
dispatcher (box worker, one loop) ──claim SKIP LOCKED──▶ Lambda invoke (async) ── handler replays journal
                                 ──▶ box-local services (BOX_SERVICES)
desk (Mac) ──HTTPS long-poll /claim?service=desk──▶ door                ── autobrowse services
```

- **`@wren/runtime` keeps Restate's shape.** Same names (`service`, `object`, `Context`, `ObjectContext`, `TerminalError`, clients, `RestatePromise.all/race`, `orTimeout`, `rpc.sendOpts`). The move is an import swap; the 855 `ctx.run` sites do not change.
- **Turn = one Lambda invocation.** The handler replays journaled results, runs new steps, and appends each result. It suspends (returns) on `sleep`, a call's result, or an awakeable; the dispatcher invokes it again when that resolves.
- **Determinism check at replay.** Each journal entry stores its kind and name. A replay that asks for a different kind or name at that seq fails the invocation as non-deterministic (as Restate does) and never runs side effects out of order.
- **Steps that write Postgres** get `ctx.run(name, fn, { tx })`: the step's rows and its journal row commit in one transaction. Outside calls stay at-least-once, as today (`2026-11-04-at-least-once.md`).
- **One writer per key:** the dispatcher claims an exclusive handler only when no other exclusive invocation of that object key is running (partial unique index on running rows per object key). Shared handlers skip the check.
- **Retries:** exponential backoff from `initialRetryInterval`, cap `maxRetryAttempts` / `maxRetryDuration`, then status `dead`. `TerminalError` never retries. The dead-letter page reads `rt.invocations where status='dead'`.
- **Timers:** `run_at`. `sleep` and `send({delay})` set it.
- **Idempotency keys:** unique `(target, idem_key)`; a repeat returns the first result.
- **Builds:** an invocation pins the Lambda version it started on (as `box-slot.ts` pins today); new invocations take the latest. Old versions are deleted when no invocation pins them.
- **Lease:** a claimed invocation gets `lease_until`; a crashed turn is claimed again after it, and replays.
- **Door:** replaces `restate.wrenautomation.com` ingress (same paths: `/Service/key/handler`, `/send`, admin under `/admin`, bearer checked by Caddy). Sync calls wait on the result via LISTEN.
- **Cache:** `readThrough` / `invalidate` over `rt.cache`. Redis removed.
- **Browser:** Chromium runs inside Lambda (`@sparticuz/chromium`) for headless renders; browserless leaves the box.

## VPSs

Both RackNerd boxes are 1 vCPU, 1 GB (Buffalo 490 MB free, LA 613 MB free). Too small for Chromium or a Postgres replica. They stay for work that needs a non-AWS IP with port 25 or a clean search IP: probers, SearXNG. Extra use: a second SearXNG on LA (search fallback when Buffalo is rate-limited), so weaver's search does not wait on the desk's Google.

## Tests and lints first (phase 0, before any move)

1. **Conformance suite** (`packages/runtime/test/conformance`): one set of scenarios, run against the Restate adapter (testcontainers, today's truth) and the Postgres runtime. Fake clock, seeded ids. Scenarios: replay skips done steps; retry backoff and cap → dead; TerminalError no retry; sleep and delayed send fire at time; idempotency key dedupes; exclusive handlers serialize per key, shared run side by side; state per key; call returns the child's result; awakeable resolve and reject; `orTimeout`; `RestatePromise.all/race`.
2. **Crash points:** the Postgres runtime's executor takes an injected crash at every boundary (before a step, after its side effect and before its journal row, after the journal row and before the ack). For each scenario × crash point: the final state equals the no-crash run, and each side effect ran at most twice (at least once, never lost).
3. **Determinism lint** (`gates.sh lint`): inside a handler, `Date.now`, `new Date()`, `Math.random`, `crypto.randomUUID`, `performance.now` outside `ctx.run` fail lint; use `ctx.date` / `ctx.rand`.
4. **Import guard:** no `@restatedev/*` import outside `packages/runtime`.
5. **Replay check** in the runtime itself (above).

## Move plan

| Phase | Work | Done when |
|---|---|---|
| 0 | Conformance suite + crash harness skeleton + determinism lint + import guard (warn) | Suite green on the Restate adapter |
| 1 | `@wren/runtime` = Restate re-exports; codemod every import; guard to error | Deployed, no behavior change |
| 2 | Postgres runtime: schema, executor, journal, state, timers, retries, idempotency, awakeables | Conformance + crash suite green |
| 3 | Dispatcher in the box worker, Lambda entry, door, admin and dead-letter reads | One report loop runs on it in prod |
| 4 | Move services by group (router flag per service: `restate` or `pg`), box services last | All wren services on `pg` |
| 5 | Extract to `@wrenautomation/<name>` (own repo, npm), autobrowse desk on the door | Desk calls run through Postgres |
| 6 | Chromium in Lambda; drop Restate server, Redis, browserless; second SearXNG on LA | Box runs Postgres, PgBouncer, box worker only |

## Decision log

- 2026-11-09: off Restate and Redis, onto Postgres (William).
- 2026-11-09: own runtime (B), Restate's shape, compute on Lambda (William's "maximize free lambda"; DBOS cannot push to Lambda).
- 2026-11-09: tests and lints land before the first move (William).

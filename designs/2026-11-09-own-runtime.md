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
- **Retries:** the handler's `retryPolicy`, else Restate's default (500 ms × 2, max 1 min, 70 tries). At the cap: `paused` (default) or `killed` (`onMaxAttempts: "kill"`). `TerminalError` never retries. The dead-letter page reads `rt.invocations where status='paused'`.
- **Timers:** `run_at`. `sleep` and `send({delay})` set it.
- **Idempotency keys:** unique `(target, idem_key)`; a repeat returns the first result.
- **Builds:** an invocation pins the Lambda version it started on (as `box-slot.ts` pins today); new invocations take the latest. Old versions are deleted when no invocation pins them.
- **Lease:** a claimed invocation gets `lease_until`; a crashed turn is claimed again after it, and replays.
- **Door:** replaces `restate.wrenautomation.com` ingress (same paths: `/Service/key/handler`, `/send`, admin under `/admin`, bearer checked by Caddy). Sync calls wait on the result via LISTEN.
- **Cache:** `readThrough` / `invalidate` over `rt.cache`. Redis removed.
- **Browser:** Chromium runs inside Lambda (`@sparticuz/chromium`) for headless renders; browserless leaves the box.

## Phase 2 as built (`packages/runtime/src/pg`)

- **The door speaks Restate's ingress protocol.** `@restatedev/restate-sdk-clients`, `scripts/ingress.mjs` and the portal call it unchanged: `/{svc}[/{key}]/{handler}[/send?delay=Nms]`, `idempotency-key`, `/restate/a/{id}/resolve|reject`, `/restate/invocation/{id}/attach|output`.
- **SDK definitions are reused.** `service()` / `object()` from the SDK give the handler wrapper, kind, serdes and retry policy. The runtime calls `wrapper.invoke(ctx, bytes)` with its own context. No second definition API.
- **A turn replays.** Each context op takes the next seq. A kind or name mismatch at a seq pauses the invocation (code 570); it never runs side effects out of order.
- **Writes are buffered.** State writes, child calls and sends flush in one fenced transaction with each run result, or with the outcome. Flushes are serial, so the journal stays a prefix.
- **Fence.** Each flush and finish starts with `rt.fence(id, attempt, lease)`. A turn whose lease another worker took fails with RT001 and writes nothing.
- **Runs.** A run with a retry cap retries in process while the delay is ≤ 2 s. A longer delay journals the try count and ends the turn as `later`. A run with no cap fails the attempt (invocation retry), as Restate does.
- **Sleep.** `wake_at` is journaled. Waits ≤ 1 s stay in process; longer ones suspend the turn with `run_at = wake_at`.
- **Suspend.** When no local work is left and the handler awaits an unsettled durable, the turn suspends. A child's finish or an awakeable resolve wakes the parent (`rt.wake`, NOTIFY `rt_wake`).
- **Clock rule.** Times that decide "due" (sleep, delayed send, retry) use the worker's clock, passed in. Leases use the Postgres clock.
- **Cancel.** Delivered once, at the next suspension point: blocked remote awaits reject with `CancelledError` (journaled), children are cancelled. An invocation cancelled before its first op ends `CancelledError` at once.
- **Combinators.** `all/race/any/allSettled` journal the deciding index; replay reads it, so the result never depends on timing.
- **Ids and random.** Child id = sha256(parent, seq). `ctx.rand` is xoshiro256** seeded from the invocation id.
- **Not built (no wren call site):** workflows, `ctx.attach`, durable promises.

## Phase 3: two runtimes side by side

115 call sites in 54 files call another service. Services move one at a time, so a call can cross runtimes.

| Option | How | For | Against |
|---|---|---|---|
| A. Closed groups | Move a group only when nothing outside it calls in | No bridge code | The call graph is dense: first groups are huge; rollback is per group |
| B. Wrap the SDK context | `@wren/runtime` wraps `ctx` so a call to a pg service becomes a `ctx.run` | Any split | Changes the journal shape of open Restate calls on a flip: replay fails |
| **C. Proxies + bridge rows** | Restate side: a pg service is served as a **proxy** of the same name. pg side: a call to a Restate service is a **bridge row** the box forwards | Any split; journal shapes never change; flip back any time | Two small pieces of code; a crossing call takes one extra hop |
| D. Big bang | All services at once; Restate drains | One switch | No per-service rollback; one bad handler stops everything |

Decided: C. Priorities, in order: no lost or doubled call, rollback per service, Lambda cost, code size.

- **Route list:** `PG_SERVICES` in `apps/worker/src/rt.ts`. A deploy flips a service. pg registers every service always, so a flip back never strands an open pg invocation.
- **Restate → pg:** Restate serves `proxy(S)` for each pg service S (same names; object handlers shared). A proxy handler makes a Restate awakeable, writes the pg row in a `ctx.run` (id from its own invocation id: a retry makes the same row), and waits on the awakeable. Restate suspends: no Lambda time.
- **pg → Restate:** a call or send to a Restate service is a normal child row. The box's dispatcher sees its service is not on pg and runs it as a bridge: POST to Restate's loopback ingress with `idempotency-key` = row id, then attach. The wait is on the box: free.
- **Reply:** when a pg row with a Restate awakeable finishes, the box resolves it on Restate's ingress, then marks the row replied. A sweep retries what a crash missed.
- **Where turns run:** box services (`BOX_SERVICES`) in the box worker; the rest in Lambda. The box invokes Lambda (`RequestResponse`, payload `{rt:{id, attempt}}`); the box's instance role already may invoke it.
- **Builds:** a Lambda row pins the version ARN at its first claim (CI writes the new ARN to `/etc/wren/worker-arn` at register); Lambda versions are never deleted. A box row pins the box build's sha; each box slot claims only its own build, as Restate's slots do today.
- **Ingress callers** (portal, CLI, wakes, desk) keep calling Restate: the proxy forwards. The door replaces Restate's ingress in phase 6.

### Phase 3 as built

- `packages/runtime/src/pg/bridge.ts`: `proxy`, `bridgeTurn`, `replier`. `apps/worker/src/rt.ts`: the box's lanes and the Lambda turn entry.
- **Lanes** (`Lane` in `store.ts`): `only`/`except` by service; `build` pins on first claim; `strict` skips rows of another build; `fresh: false` takes only its own build's rows; `lock: false` ignores key locks (bridge rows: Restate locks the key).
- **Box process:** box lane (strict, `WREN_BUILD`), Lambda lane (loose: a row keeps its first ARN), bridge lane, replier. All on one direct Postgres pool (LISTEN needs a session).
- **Lambda lane width:** 4 (`WREN_RT_LAMBDA_CONCURRENCY`), under the worker's reserved concurrency of 6, which Restate shares until phase 6. A throttled invoke keeps its lease and runs again when it lapses.
- **Lambda turns:** the handler takes `{rt}` events beside Restate's. Postgres through PgBouncer (`prepare: false`, 2 connections).
- **Slots:** a superseded slot keeps only its box lane, `fresh: false`. A new slot moves rows pinned to a stopped slot (two deploys ago, not `WREN_BUILD_LIVE`) to its own build, as Restate's `force` does.
- **Proxy content type:** the proxy passes bytes through but declares `application/json`; Restate's ingress refuses JSON callers on an `octet-stream` handler (found by `bridge-pg.test.ts`).
- **Tests:** `bridge-pg.test.ts` (Restate container + Postgres: proxy call, no input, error code, pg → Restate bridge, every reply sent), `lanes-pg.test.ts`.
- **State move:** an exclusive proxy call reads its key's Restate state, seeds `rt.state` (`ON CONFLICT DO NOTHING`) inside the submit step, then clears Restate's. Restate's key lock orders it against calls in flight. A flip back: at start the box returns the state of each service no longer in `PG_SERVICES` (`returnState`, admin `POST /services/{svc}/state`), then deletes the rows.
- **Admin reads (V3):** schema `rt_admin` holds views shaped like Restate's admin tables (`sys_invocation`, `state`, `sys_service`, `sys_journal`, `sys_journal_events`). ISO text timestamps; `moved_at` (a trigger on status) is `modified_at`. `runtimeAdmin(db, url, token)` in `@wren/core/console` runs each query on both runtimes and joins the rows. A patch goes to the runtime that holds the id: rt `resume` (pending now, on the newest build) and `kill` (the row and its open calls, each parent's journal entry, as `finish` ends a row). LoopRevive, FailedCallAlert, the console, PostPublish, `wren loops` and `wren dlq` all use it. Test: `core/test/integration/runtime-admin.test.ts`.
- **First flip:** `AuditSeal` (15-min loop, Lambda lane). ClientReport was the first pick, but prod has no client reports, so it would prove nothing.
- **Gaps:** a service moved between box and Lambda leaves its pinned rows in the old lane (repin by hand); Restate-side cancel of a proxy call cancels the pg row only after its turn ends; a flip back while pg rows are open re-runs them on Restate (flip back only when none are open); a shared proxy call before any exclusive one sees no moved state.

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
- 2026-11-09: the door speaks Restate's ingress protocol, and SDK definitions are reused: phase 4 is a router flag, not a rewrite.
- 2026-11-09: phase 3 = proxies + bridge rows (C above), not closed groups, a ctx wrapper or a big bang.
- 2026-11-09: retry cap → `paused`, not a new `dead` status: same as Restate today, so the DLQ page and alerts keep their meaning.
- 2026-11-09: admin reads through views shaped like Restate's tables, not a second query layer: the watchdog, DLQ and console keep their SQL.
- 2026-11-09: first flip is AuditSeal, not ClientReport (no client reports in prod).
- 2026-11-09: S3 and SSM stay (William). Postgres has no object store; credvault keeps SSM; neither runs on Restate.

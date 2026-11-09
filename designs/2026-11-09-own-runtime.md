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
- **Ingress callers** (portal, CLI, wakes, desk) call `restate.wrenautomation.com` as before. Caddy sends them to the door first (below), so a pg service skips the proxy. The door replaces Restate's ingress in phase 6.

### Phase 3 as built

- `packages/runtime/src/pg/bridge.ts`: `proxy`, `bridgeTurn`, `replier`. `apps/worker/src/rt.ts`: the box's lanes and the Lambda turn entry.
- **Lanes** (`Lane` in `store.ts`): `only`/`except` by service; `build` pins on first claim; `strict` skips rows of another build; `fresh: false` takes only its own build's rows; `lock: false` ignores key locks (bridge rows: Restate locks the key).
- **Box process:** box lane (strict, `WREN_BUILD`), Lambda lane (loose: a row keeps its first ARN), bridge lane, replier. All on one direct Postgres pool (LISTEN needs a session).
- **Lambda lane width:** 5 (`WREN_RT_LAMBDA_CONCURRENCY`; 4 before group 4), rows no caller waits on at most 3 ("Group 4"), under the worker's reserved concurrency of 6, which Restate shares until phase 6. A throttled invoke (`TooManyRequestsException`: no turn began) goes back to pending at once, due in 2 s, no failure counted (`release`). Any other invoke error keeps the lease and runs again when it lapses: the turn may have begun.
- **Lambda turns:** the handler takes `{rt}` events beside Restate's. Postgres through PgBouncer (`prepare: false`, 2 connections).
- **Slots:** a superseded slot keeps only its box lane, `fresh: false`. A new slot moves rows pinned to a stopped slot (two deploys ago, not `WREN_BUILD_LIVE`) to its own build, as Restate's `force` does.
- **Proxy content type:** the proxy passes bytes through but declares `application/json`; Restate's ingress refuses JSON callers on an `octet-stream` handler (found by `bridge-pg.test.ts`).
- **Tests:** `bridge-pg.test.ts` (Restate container + Postgres: proxy call, no input, error code, pg → Restate bridge, every reply sent), `lanes-pg.test.ts`.
- **State move:** an exclusive proxy call reads its key's Restate state, seeds `rt.state` (`ON CONFLICT DO NOTHING`) inside the submit step, then clears Restate's. Restate's key lock orders it against calls in flight. A flip back: at start the box returns the state of each service no longer in `PG_SERVICES` (`returnState`, admin `POST /services/{svc}/state`), then deletes the rows.
- **Admin reads (V3):** schema `rt_admin` holds views shaped like Restate's admin tables (`sys_invocation`, `state`, `sys_service`, `sys_journal`, `sys_journal_events`). ISO text timestamps; `moved_at` (a trigger on status) is `modified_at`. `runtimeAdmin(db, url, token)` in `@wren/core/console` runs each query on both runtimes and joins the rows. A patch goes to the runtime that holds the id: rt `resume` (pending now, on the newest build) and `kill` (the row and its open calls, each parent's journal entry, as `finish` ends a row). LoopRevive, DeadLetterFile, the console, PostPublish, `wren loops` and `wren dlq` all use it. Test: `core/test/integration/runtime-admin.test.ts`.
- **First flip:** `AuditSeal` (15-min loop, Lambda lane), renamed `AuditLogSeal` in the next deploy. ClientReport was the first pick, but prod has no client reports, so it would prove nothing.
- **Renames (WA-1219):** a rename lands with the service's pg move. `RENAMED` in `apps/worker/src/rt.ts` maps old to new. Restate serves a proxy under each old name too: old scheduled calls and old Restate state reach the new name. At start the box moves open rt rows (unpinned) and rt state to the new name and drops the old handler rows. Rows an old build submits later under the old name take the bridge lane to the old-name proxy. Drop an entry once Restate holds nothing under the old name. Tests: `bridge-pg.test.ts`, `lanes-pg.test.ts`.
- **Slot overlap (V4):** the last slot sees it was superseded up to 30 s after the new one registers. Until then its bridge lane would take rows of a service the new build just moved or renamed and send them to Restate, whose proxy makes a new pg row the same bridge takes again; on an exclusive key that deadlocks. So each box writes its `PG_SERVICES` to `rt.pg_services` at start, and every bridge lane skips them (`skipPg`). A build from before V4 does not read the table, so renamed rows also wait 2 min (`OLD_SLOT_MS`) before they are due.
- **Group 2:** platform and people loops on the Lambda lane: NextStepDecide (was Judge), SiteTokenRenew, VaultKeyMirror, SetupRecheck, SegmentsRefresh (was SegmentsHourly), TouchToJourney, ListToJourney, MapLineFeed, StripeReconcile, ClientUpdateMail, ClientInvoicing, ClientMailTriage. Two run in prod (NextStepDecide, SiteTokenRenew: its call to autobrowse is the first prod bridge row); the rest are stopped and start on pg. The watchdogs (DeadLetterFile, was FailedCallAlert; LoopRevive) move last, so the moved loops are watched from the other runtime.
- **Route list test:** `apps/worker/src/rt.test.ts` builds every service: each pg service is built once, each old name is free and points at a pg service, the pg `Registry` takes all of them (a Lambda that cannot build it would stop every turn), and Restate's side has one proxy per pg service and old name, with the target's handlers.
- **Group 3:** email and content loops on the Lambda lane: EmailSend, EmailInboxRead, EmailOpenerFill, EmailBounceRead, EmailFleetDigest, EmailPlacementTest, EmailClickPull, NewsletterSync, PostPlan, PostPublish, PostMetrics. EmailPostmasterPull waits: its build checks Google domain-wide delegation, so the route list test cannot build it.
- **Door in front (V5):** each box slot runs a door at slot port + 10 (9090, 9091) on its own pool of 4. Caddy's authed default goes to `9090 9091 8080`, `lb_policy first`, active health on `/restate/health`; a door that fails it drops out, and with none up Restate's ingress serves. Caddy retries a POST only when it could not connect, so no call runs twice. The door (`restate` option) serves services in `rt.pg_services` (read every 5 s) and passes everything else to Restate's loopback ingress as it came, streamed. Ids: an awakeable id pg made (`awk.inv_…`) and an invocation pg holds are pg's; others pass. `/output` answers 470 while a call runs, as Restate does (the CLI and portal poll it); `/restate/invocation/{svc}[/{key}]/{handler}/{idem}/output|attach` looks up the idempotency key (the portal's write status), and a miss passes to Restate (a call from before the move). An old name in `RENAMED` is served direct under the new one (webhooks and Workers that still call the old name skip the proxy); a pass-through keeps the old name. `ingressPrivate` handlers get 400 (V5 adds `rt.handlers.private`). `delay` takes Restate's humantime and ISO 8601 forms; a bad one gets 400. No request timeout: a sync call waits as long as its handler. Why before the consoles move: through the proxy a portal call costs ~200–300 ms and 3 Lambda requests; direct it adds ~30 ms. Tests: `bridge-pg.test.ts` "the door in front of Restate", `pure.test.ts` parseDelay.
- **Caddy change:** applied alone over SSM (validate, write in place, `caddy reload`), not by running all of `box-restate.sh`, which would also restart Restate on any config drift. The script now reloads Caddy when only the Caddyfile changed: a bind-mounted file replaced by `mv` is a new inode the container never sees, so it used to restart Caddy and cut calls in flight.
- **Gaps:** a service moved between box and Lambda leaves its pinned rows in the old lane (repin by hand); Restate-side cancel of a proxy call cancels the pg row only after its turn ends; a pg-side cancel of a bridge row reaches Restate within 2 s; a flip back while pg rows are open re-runs them on Restate (flip back only when none are open); an old slot's turn on a key with no pg state can race the box-start state take (it began without that state either way).

## Group 4: portal calls beside loops (11-09)

Group 4 moves the consoles, portals, desks and webhooks: calls a person waits on. On Restate today they share the worker's 6 reserved Lambda slots with loop bursts. Measured 11-02..11-09: peak concurrency 6 every day, 41–208 throttles a day, ~5–14k invokes a day, 130 ms average.

| Option | How | For | Against |
|---|---|---|---|
| A. One lane, wider | Lambda lane width 5 | No code | A loop burst or one long turn (PostMetrics 66 s) queues portal calls, as today |
| B. Two fixed lanes | Portal lane 2, loop lane 3 | Simple | Idle slots go unused; a portal page firing 5 calls gets 2 |
| C. Waited rows first | Each row knows if a caller waits; one pool of 5; rows no one waits on take at most 3 | Portal always has 2 slots and can use all 5; no service list to keep | A column, a filter, a shared counter |
| D. Consoles on the box | Box lane, in process | No cold start, no Lambda | Box CPU and memory beside Postgres; every deploy drains them; against "maximize free Lambda" |

Ranked: portal P99 under load, then Lambda spend (free tier), then code size. **C.**

- `rt.invocations.caller_waits`: a door call (not `/send`, no delay) and a proxy call: true. A child made by a call inherits its parent's value. A send or a delayed call: false (no one waits; a loop's wake is a delayed send, so loops are background after their first turn).
- Two Lambda dispatchers on one `Slots` counter: waited rows up to the full width, the rest up to width − 2.
- Width 5 (`WREN_RT_LAMBDA_CONCURRENCY`), up from 4: after group 4 Restate's Lambda share is the watchdogs, Variants/Folders and old-name proxies. A throttle still goes back to pending in 2 s.

### Lambda turns (11-09)

Measured before 4c (prod, 40 calls each, a loop's `status`): pg 88 ms p50 at the client, Restate 57 ms. Inside Lambda a pg turn took 26 ms p50, a Restate turn 3 ms. The gap is Lambda's own Postgres trips through PgBouncer: `load` (2) and `finish` (2-3), about 5 ms each.

Now the box loads the row, sends it in the invoke, and writes the outcome Lambda hands back (`remoteTurn` / `servedTurn`, codec `wire.ts`). Lambda goes to Postgres only for `ctx.run` results and lease renewals. Either side falls back to the old path: a loaded turn or an outcome over 5 MB (Lambda's sync cap is 6 MB), and an old Lambda build that ignores `defer`. The test runtime and a second conformance and crash pass run this path, JSON both ways.

| Option | Lambda trips per read-only turn | Cost |
|---|---|---|
| A. Box loads and finishes (chosen) | 0 | executor split, one codec |
| B. Lambda in the VPC, private IP to Postgres | 5, under 1 ms each | NAT for outside APIs, ~$32/mo |
| C. Fewer trips: load as one SQL function | 3-4 | small; keeps half the gap |
| D. Accept +30 ms | 5 | every portal call slower than today |

After A (prod, p50): Lambda runs a pg turn in 2-3 ms, but the client saw 84 ms against Restate's 57. The worker's `rt timing` log (per minute) split the rest: claim 8.1, load 5.2, invoke 20, finish 8.2, door submit 3.8. Postgres runs each rt query in under 0.1 ms, but plans it again on each call (`prepare: false`): the claim's plan is 1.5 ms, and the Lambda lane claimed twice before it started a waited row. The invoke (20 ms from the box, 17 ms of it AWS's) is the same for Restate. Fix: the box pools, straight to Postgres on 5432, use prepared statements; a waited row starts before the background claim. After: claim 2.4, load 2.8, finish 4.8, submit 2.7; client 73 ms against Restate's 60. Left: about 5 trips of 1-2 ms, each a commit or a read Restate does in memory.

### Group 4 order

- **4a, loops and workers** (36): the rest of the loops (SmsSend, ReachSend, SiteRollup, Reactivation...), the workers they call (ReplyLabel, MetaReplyPace, SocialPushHold, CallBriefBuild...), and the agent and ask services. 12 renames land with it (WA-1219).
- **4b, webhooks and public calls** (14): SocialPushIntake, CallBookingIntake, SmsWebhookIntake, SmsApplicationFollowUp, SignupForm, SiteChat, PaymentLinkSend, BookingPage, ClientBookingPage, DocumentSign, WebhookSend, and the three OAuth callbacks. The phone and portal Workers go live after register, so they call the new names only once the door serves them; their old names stay in `RENAMED` for good. pg keeps every idempotency key (no retention yet), so the 7-day floor of `WEBHOOK_SERVICE` holds; retention must keep it.
- **4c, consoles, portals, desks** (28): 16 consoles, ConsolePortal, DeliveryPortal, ReactivationPortal, InboxDesk, ReachDesk, SmsDesk, SocialDesk, VideoDesk, with Sites, Connectors, MailAccess, SocialAccess. No renames. VariantsConsole, FoldersConsole and ContentDesk go last.
- **4d, box services, watchdogs, the rest** (17): LeadPoolFill, CompanySiteFind, CompanyEnrich, LeadVerify, PageHtmlArchive, BooksClose, MyMailTriage, SocialActivityRead, ContentDesk, EmailPostmasterPull, Executor, ExecutorClock, DeadLetterFile, LoopRevive, VariantsCollect, VariantsConsole, FoldersConsole. 5 renames (WA-1219): FailedCallAlert, BooksDaily, Resolution, Discovery, Enrichment.
- **4e, `Content` → `ContentPublish`**, alone. Its desk reads (up to 15 min) are bridge rows; the parent row suspends and holds no Lambda. Dead-letter and timeout rows name `Content/...`, so the old name stays an alias.

`Segments` → `SegmentPass` needs two deploys: the triggers say `wren_wake('Segments/fleet')`, and migrate runs before the box knows the new name. Deploy 1 renames; the door's alias carries the triggers. Deploy 2 rewrites the triggers.

## Phase 5: the desk pulls from the door (11-09)

Measured: in prod autobrowse is only the Mac desk (`autobrowseInstanceId` unset, so every site call goes to `desk`). It serves `desk`, `claude`, `studio`, `calls`. Restate pushes calls to it through the Cloudflare Tunnel `desk.wrenautomation.com`. These four hold no object state. They make 26 `ctx.run` calls, 1 `ctx.sleep` and 2 calls to themselves (`renew`, with an idempotency key). Each irreversible write already goes through autobrowse's send journal (one file per send key, `src/sites/send-journal.ts`). That journal says whether a write went out, which a Restate journal cannot. autobrowse's box services (`sites`, `browser`, `do`, the run objects) are not in prod. They keep their local Restate (compose) for development.

| | A. Desk is a pg worker | B. Desk runs turns over the door | **C. Desk pulls calls over the door** | D. Keep Restate for the desk |
|---|---|---|---|---|
| How | the desk runs wren's dispatcher against prod Postgres | a remote turn protocol: claim, replay, append a step, suspend | claim, renew, finish; the handler runs as a plain function | as today |
| Restate server gone | yes | yes | yes | no |
| New code | small in wren; autobrowse imports the runtime | the most: a second turn protocol to prove | ~3 door routes + a ~150-line puller in autobrowse | none |
| Per-step journal on the desk | yes | yes | no: a rerun starts the handler again; the send journal keeps writes once | yes |
| Publish / credential | npm `@wrenautomation/runtime` (public, hard to undo); a Postgres role on the Mac and 5432 open to a home IP | the same npm package | none: the desk has the box bearer already | none |
| Inbound port | none | none | none (the desk tunnel goes) | the desk tunnel |

Priorities, in order: 1) no lost or doubled sends, 2) the Restate server goes, 3) the least new protocol to own and test, 4) no new public package or credential, 5) wren and autobrowse import nothing from each other (both say so today).

Picked C. A per-step journal buys the desk little: its handlers are one leg each, and its writes are already kept once by the send journal (the same guard Restate needed). C keeps the calls queued in Postgres while the Mac sleeps (no try burns: nobody claims). A, B and the design's first plan (extract to npm) all add a public package for that one gain.

- **Door:** `POST /rt/register` (the desk's services and handlers into `rt.handlers` and `rt.pg_services`; only names in `PULLED`, apps/worker/src/rt.ts), `POST /rt/claim` (long-poll up to 25 s on `rt_wake`; rows of pulled services that no Restate call holds), `POST /rt/renew` (the lease; answers `cancel`), `POST /rt/finish` (a value, a `TerminalError`, or a failure with the handler's retry policy).
- **Lanes:** pulled services are in `rt.pg_services`, so the door submits their calls as rows and the bridge skips them. A row Restate already runs (`remote` set) stays on the bridge until it ends: no pull lane takes it.
- **Desk:** a `ctx` with `run` (with the run's retry options; at the cap a `TerminalError`, as Restate), `sleep`, `request()` (the row id and headers), and clients that call the door. A cancel aborts at the next step and finishes with 409.
- **Cutover:** the desk's register is the switch. Until a pulled service has rows in `rt.handlers`, the box leaves it out of `rt.pg_services` and the door passes its calls to Restate, as before. Register puts it in. The desk pulls when `DESK_DOOR_URL` and `DESK_DOOR_TOKEN` are set (its own names: the desk's `WREN_RESTATE_*` keys serve the `wren` CLI). A register the door refuses (down, or an old build) retries in the background; the desk stays up. Two builds share the box until the old one ends: the old door drains (health 503), so Caddy's `first` policy sends `/rt` to the new one. Back out: delete its `rt.handlers` rows and restart the box. The desk keeps Restate's endpoint until the calls Restate holds end; the tunnel and that endpoint go with phase 6.
- **Proof:** `pull-pg.test.ts` (door routes, lanes, leases, cancel, retry to pause); autobrowse `test/door-pull.test.ts` (a plain `ctx`, run caps, clients); and one run of the real puller against the real door on a test Postgres (sync call, self-call with an idempotency key, delayed send, a 400, a call longer than its lease).

- **Live (11-09 15:21 UTC):** autobrowse 696e197 registered 20 handlers (desk 15, calls 3, claude 1, studio 1); all four are `pulled` in `rt.pg_services`. The first 12 desk calls after it ran on pull, attempt 1, no failures; a terminal 429 (a LinkedIn cap) came back as the caller's error. A sync `desk/status` through Caddy: 200, 100 ms in Postgres. Restate holds no desk call. Its whole queue is 3 scheduled loop wakes (SiteTokenRenew, PostPlan, VariantsCollect) with no twin in Postgres: each fires into its pg proxy, then keeps its next wake in Postgres.

## Phase 6: one front door (11-09)

William (11-09): retire Caddy and the Restate ingress name too. What Caddy does today: TLS for two hosts (`restate.` and `lists.`), the bearer, the slot failover (`first` over 9090, 9091, then Restate's 8080, on health), three Restate admin routes, and `/cdp` to browserless. With Restate and browserless gone, three jobs stay: TLS, the bearer, the slot failover. Listmonk needs TLS too.

| Option | How | For | Against |
|---|---|---|---|
| **A. Slim Caddy (picked)** | One host block: TLS, bearer, `first` over 9090 and 9091 on health. Drop 8080, admin, `/cdp`. Rename the host; the old name stays an alias | Vetted, ~20 lines, no time limit on a call, health failover between slots as today | Still one container (~30 MB) |
| B. Cloudflare Tunnel | `cloudflared` on the box; no open 80/443; TLS at the edge | No open ports, free | One origin per host: no failover between slots, so a new slot must take over the port; 100 s limit on a response (524) ends long sync calls |
| C. The door does TLS | Node `https` + an ACME library, one port shared by the slots (`SO_REUSEPORT`) | No proxy at all | Certs and renewals in our process; a custom handover; against "frameworks first" |
| D. Lambda Function URL | The door moves into Lambda | Box serves nothing public | Every waiting call and the desk's 25 s long-poll bill Lambda time (the desk alone: ~324k GB-s a month of the 400k free); a 15 min cap |

Ranked: 1) no lost or doubled calls during a deploy, 2) fewer services to run, 3) no time limit on a sync call, 4) $0, 5) vetted parts over our own. A keeps 1, 3, 4 and 5 and cuts Caddy to one job set. B is the only real rival; it fails 1 and 3. The host name: `api.wrenautomation.com` (says what it is); `restate.wrenautomation.com` stays as an alias until every caller (Workers, CLI, desk, webhooks) is on the new name.

Order: the 3 Restate wakes fire → drop the proxies, the bridge lane and the door's pass-through → Caddy loses 8080 and admin → stop Restate and Redis (only Restate's admin cache used it) → autobrowse drops its Restate endpoint and the desk tunnel. Browserless and `/cdp` go with Chromium in Lambda.

## Phase 6b: Restate and Redis gone (11-09)

The worker, tests, portal and deploy carry no Restate server. What stays from Restate: the SDK's service definitions (the registry reads them), its ingress protocol (the door speaks it), the `inv_` ids and the admin views' table shapes. Env names `RESTATE_HOST`, `RESTATE_AUTH_TOKEN`, `WREN_RESTATE_INGRESS_URL` and SSM `/wren/prod/restate` (the door's bearer) keep their names; a rename is its own change.

A slot learns it is superseded without Restate's admin. Options:

| Option | How | For | Against |
|---|---|---|---|
| **A. `rt.box_builds` (picked)** | Each slot upserts its build with a start time; the newest started build takes new rows; each slot polls every 10 s and stands down when newer exists | One table, no new channel; a failed new build hands back by restarting the live slot (it re-upserts as newest) | Up to 10 s of two fresh lanes (safe: rows are leased) |
| B. Advisory lock | The live slot holds a session lock; the new one takes it | Instant | The lock moves only when the old connection drops: the old slot must die first, so no overlap and a gap |
| C. deploy.sh tells the old slot | CI posts "stand down" to the old door | No poll | A CI run that dies mid-deploy leaves two fresh slots for good |
| D. LISTEN/NOTIFY | The new slot notifies | Fast | A notify lost across a reconnect is lost; still needs A's table as truth |

Ranked: no lost or doubled calls during a deploy, no state outside Postgres, no reliance on CI finishing. A keeps all three.

Also: wakes post to the slot's own loopback door (no bearer). The hourly lag alarm (`runtime-lag-check.yml`) reads `rt.invocations` with psql from CI: late rows, rows with a dead lease, and LoopRevive's next check. The load test runs on the door. Local dev: `pnpm --filter @wren/worker dev` serves every service and the door on 8080; compose runs Postgres only. Terraform loses the Restate Cloud invoker role, its variables and output, the Redis port, the Restate snapshot read and the identity key. The box role keeps `lambda:InvokeFunction` (the lambda lane).

Transition: the build live before this deploy finds supersession through Restate's admin, so it does not stand down by itself. After the deploy: wait until no open `rt.invocations` row carries its build, stop `wren-worker-old`, then stop `wren-restate`, `wren-redis` and `wren-desk-hop` and remove their crons. Their data dirs stay (deleting is William's call). `rt.pg_services` is unused; dropping it waits on his yes. The `cache` SSM param is unused and stays for the same reason.

## VPSs

Both RackNerd boxes are 1 vCPU, 1 GB (Buffalo 490 MB free, LA 613 MB free). Too small for Chromium or a Postgres replica. They stay for work that needs a non-AWS IP with port 25 or a clean search IP: probers, SearXNG. Extra use: a second SearXNG on LA (search fallback when Buffalo is rate-limited), so weaver's search does not wait on the desk's Google.

## Tests and lints first (phase 0, before any move)

1. **Conformance suite** (`packages/runtime/test/conformance`): one set of scenarios, run against the Restate adapter (testcontainers, today's truth) and the Postgres runtime. Fake clock, seeded ids. Scenarios: replay skips done steps; retry backoff and cap → dead; TerminalError no retry; sleep and delayed send fire at time; idempotency key dedupes; exclusive handlers serialize per key, shared run side by side; state per key; call returns the child's result; awakeable resolve and reject; `orTimeout`; `RestatePromise.all/race`.
2. **Crash points:** the Postgres runtime's executor takes an injected crash at every boundary (before a step, after its side effect and before its journal row, after the journal row and before the ack). For each scenario × crash point: the final state equals the no-crash run, and each side effect ran at most twice (at least once, never lost).
3. **Determinism lint** (`gates.sh lint`): inside a handler, `Date.now`, `new Date()`, `Math.random`, `crypto.randomUUID`, `performance.now` outside `ctx.run` fail lint; use `ctx.date` / `ctx.rand`.
4. **Import guard:** no `@restatedev/*` import outside `packages/runtime`.
5. **Replay check** in the runtime itself (above).
6. **Whole suite on pg:** `WREN_TEST_RUNTIME=pg` makes `startTestRestate` start the pg runtime (`startPgTestEnvironment`: door, dispatcher, a small admin with `/query`, `PATCH`, state writes, and `stateOf`). Every package's Restate integration suite runs unchanged on it. First run (11-09): 389/428; each gap became a runtime test.

## Move plan

| Phase | Work | Done when |
|---|---|---|
| 0 | Conformance suite + crash harness skeleton + determinism lint + import guard (warn) | Suite green on the Restate adapter |
| 1 | `@wren/runtime` = Restate re-exports; codemod every import; guard to error | Deployed, no behavior change |
| 2 | Postgres runtime: schema, executor, journal, state, timers, retries, idempotency, awakeables | Conformance + crash suite green |
| 3 | Dispatcher in the box worker, Lambda entry, door, admin and dead-letter reads | One report loop runs on it in prod |
| 4 | Move services by group (router flag per service: `restate` or `pg`), box services last | All wren services on `pg` |
| 5 | The desk pulls its calls from the door ("Phase 5"); no package extract | Desk calls run through Postgres |
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
- 2026-11-09: clear names for every service by the end of the move (William). Rename at the pg move, through an old-name proxy: no Restate state move per key.
- 2026-11-09: move by group, live loops first with stopped ones of the same domain; watchdogs and box services last.
- 2026-11-09: the door goes in front of Restate's ingress before the consoles move (Caddy failover to Restate), not at phase 6: phase 4's portal calls skip the proxy, and phase 6 then only drops the fallback.
- 2026-11-09: S3 and SSM stay (William). Postgres has no object store; credvault keeps SSM; neither runs on Restate.
- 2026-11-09: attach on pg (PostPublish's settle needs it), checked before group 4. A target's finish settles the attach rows that wait on it. The attacher share-locks the target row before its own fence, so finish and flush cannot both miss each other (a forced-order test proves the lost wake without the lock). An unknown id answers 404; Restate retries that attach until it pauses.
- 2026-11-09: a cancel on a bridge row goes to Restate's admin (`PATCH /invocations/{id}/cancel`), polled every 2 s while the row runs. Restate then fails the call with 409, which the row keeps.
- 2026-11-09: kill stores its error as a jsonb object, not a JSON string, and settles attaches on the killed rows.
- 2026-11-09: pausedUnder crosses runtimes through `idempotency_key` (a column on the `sys_invocation` view): a bridge row's Restate call carries the row id as its key.
- 2026-11-09: group 4 runs waited rows first on one Lambda pool (C in "Group 4"), not a wider lane, fixed lanes or consoles on the box.
- 2026-11-09: pg's ctx is typed against the SDK's contexts (tsc fails on a missing member), and the determinism guard fails on a ctx member pg answers with 501.
- 2026-11-09: box start takes every pg service's Restate state into pg (`takeState`, old names to new), then clears Restate's copy; again every 2 min for 30 min, as the deploy restarts the box before it registers the proxies and old-deployment calls can still write. Found: the door serves pg services direct, so a key moved only on an exclusive proxy call; 20 moved services still held state on Restate (TouchToJourney's cursors among them), and their next pg wake would have started empty. pg wins per key, not per name: a key pg holds keeps Restate's copy on Restate and logs it, so a name pg cleared never returns. Options weighed: per-name merge (rejected: brings back cleared names), lazy move in the door (rejected: every door call pays a Restate admin read), a one-off script (rejected: a later flip strands state again).
- 2026-11-09: the door reads the handler from the service's kind, then `/send` after it. Found by the pg suite: `POST /Payments/send` was read as one-way to a handler `Payments` (404). Hits 8 prod handlers named `send` once they move.
- 2026-11-09: a refusal keeps its `metadata` across the door and the bridge, as Restate's ingress does (callers read the bad field from it).
- 2026-11-09: a turn held only by short sleeps (≤ 1 s, kept in the turn) suspends when an outside result is pending, so the result wakes it. Found by the pg suite: `call.orTimeout(1000)` always timed out, as a live turn never sees a child's end and the child's row was not written until the sleep ended. A turn held by a `ctx.run` writes its calls, cancels and wakes at once. Options weighed: a live turn that listens for its children's ends (rejected: a listener per turn, or a router in the executor, for one pattern), a short sleep never local (rejected: every plain short sleep pays a suspend).
- 2026-11-09: group 4 in three steps (loops and workers, then webhooks and public calls, then consoles), not one deploy: each step's suite runs on pg first, and a rename's old name gets a door alias. An old name an outside caller uses (a webhook URL, a trigger, the portal Worker's `Domains/resolve`) stays in `RENAMED` for good.
- 2026-11-09: a row pinned to a Lambda build that lacks its handler is unpinned (build cleared, run again in 2 s) until it starts or hits 30 tries; the Lambda lane reads the ARN file every 2 s, not 30 s. Found on prod: deploy.sh's `EmailQueueRerender/all` call landed between the box restart and the Lambda register, so the old build took it and failed it for good. Options weighed: register before the box restart (rejected: the box then serves old code to the new Lambda for a while), a door-side wait for register (rejected: a call from the box itself still races).
- 2026-11-09: group 4b (webhooks and public calls, 14 services, 11 renames) keeps every old name as a door alias for good, not for one deploy: the phone and portal Workers, cal.com, the SMS provider and Stripe hold the old URLs, and a Worker on an old build still calls them. Proof: every startTestRestate suite on pg (WREN_TEST_RUNTIME=pg) and on Restate, same results; the Worker tests call the new paths.
- 2026-11-09: a Lambda turn is loaded and finished by the box (A in "Lambda turns"), not Lambda in the VPC (NAT cost), fewer trips (keeps half the gap) or accepting +30 ms per portal call. Moved before 4c, as consoles are calls a person waits on.
- 2026-11-09: the box's runtime pools use prepared statements; Lambda's do not (PgBouncer, transaction mode). Found by the `rt timing` log, not by guess: query plans, not network, were most of the pg overhead. The box reaches Postgres at its own public IP (0.25 ms against 0.035 on loopback); left as is, as it is 1 ms per call.
- 2026-11-09: group 4c (28 consoles, portals and desks) moved after the latency fix, as a person waits on each call. No renames, no awakeables; desk calls to autobrowse's `desk` cross the bridge. Proof: every startTestRestate suite on pg, same results as before (cli inbox-reply, WA-1067 drift, fails on both runtimes).
- 2026-11-09: group 4d (17: box services, watchdogs, Executor, Variants, Folders) with 5 renames. Restate keeps daily wakes and the pool chain's sends under the old names, so all 5 stay in `RENAMED`. The box lane (BOX_SERVICES) takes the renamed names. The watchdogs now run on the runtime they watch; an outside liveness alarm comes with phase 6. Proof: every startTestRestate suite on pg and on Restate, same results as 4c.
- 2026-11-09: group 4e, `Content` → `ContentPublish` (WA-1219's last rename). Every Restate service is now on pg; Restate keeps only proxies, old names and the bridge to autobrowse. The component list gained SegmentPass, WebhookSend, VariantsConsole, VariantsCollect and FoldersConsole (the inventory test caught them). Proof: every startTestRestate suite on pg and on Restate, same results; listmonk's test now waits for its send record (a step after the send; it raced under load).
- 2026-11-09: phase 5 is C, the desk pulls over the door ("Phase 5" table), not an npm extract of the runtime. Ranked: no lost or doubled sends, Restate gone, least new protocol, no new public package or credential, repos import nothing from each other. The send journal already keeps the desk's writes once, so a per-step journal on the Mac buys little.
- 2026-11-09: phase 5 live: the desk pulls (autobrowse 696e197). Restate's queue is 3 loop wakes. Phase 6's front door is A, slim Caddy under `api.wrenautomation.com` ("Phase 6" table): Cloudflare Tunnel has no slot failover and a 100 s response limit.
- 2026-11-09: phase 6b. A slot learns it is superseded from `rt.box_builds` (A in "Phase 6b"), not an advisory lock, a CI push or LISTEN/NOTIFY. Restate, Redis and the desk hop stop after the old slot drains; their data stays. The lag alarm reads Postgres from CI. Env names keep "RESTATE"; rename later.
- 2026-11-09: wren's Restate names go: `WREN_API_URL` and `WREN_API_TOKEN` (portal and phone Workers, deploy, CLI, config, weaver 0.61.0), after the host they reach. Two phases: new names beside the old in SSM, GitHub `production` and the egress gate, then the old go once the deploy proves the new. Caddy reads its bearer from the box env, so `/wren/prod/restate` is unused (kept until William says to delete it). Kept: the door's `/restate/...` paths (it speaks Restate's ingress protocol) and autobrowse's `RESTATE_*` names (autobrowse on npm still runs on a Restate for other operators; wren's door is one such ingress).

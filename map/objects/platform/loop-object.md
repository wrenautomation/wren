---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ a6004537
entity: packages/core/src/restate/loop.ts:366
---

# loop-object

The one way a recurring job runs: a Restate Virtual Object from `makeLoopObject` with handlers `start`, `stop`, `sync`, `wake`, `loop`, `status`. Fourteen of them in prod. `loop` refuses at ingress: only the loop sends it.

## Why this shape

Restate owns the timer, so a worker dying or a laptop closing loses nothing; the delayed `loop` fires when the deployment is back (`packages/starling/outbound/src/email/restate/send-scheduler.ts:1`). Each pass is one journaled step that opens a run row; a stage failure is recorded on the row and in `last`, never thrown at the loop (`loop.ts:1`). A loop with an event source is woken (`wake`) and polls only as a net: Gmail push, or a row queued in its table (`wren_wake`, migration 0235); the pattern per new loop is `designs/2026-10-11-push-not-poll.md`. Every call a pass waits on has a time limit, so a call Restate paused never holds the key's lock: past it the unit is skipped and the pass goes on (`designs/2026-10-16-loop-watchdog.md`). A failure notice names the root cause and the table (`errorText`, `loop.ts:88`), never the SQL or its params, so one failure is one notice. `docs/restate-operations.md:363` still names the old path.

## Shape

- `makeLoopObject(name, pass, hooks)` (`loop.ts:366`); `hooks.effect` marks `sync` (`sends` on `EmailSend`); `passOrFailed` (`:343`): a pass that throws a terminal or replayed error is kept as a failed `last` with backoff, the next queued, never parked; `failuresInARow` (`:34`); state keys for `last` and the `start` input (`:20`, `:22`)
- keys: `EmailSend/{sender}`, `EmailInboxRead/{sender}`, `EmailOpenerFill/{niche}`, `LeadPoolFill/{niche}`, `EmailFleetDigest/fleet`, `EmailPostmasterPull/fleet`, `EmailClickPull/fleet`, `EmailBounceRead/all`, `EmailPlacementTest/fleet`, `PostPublish/default`, `PostPlan/default`, `PostMetrics/default`, `AdSpendGuard/default`, `SiteTokenRenew/box`, `VaultKeyMirror/box`, `SmsSend/fleet`, `SmsUpkeep/daily`, `SiteRollup/default`, `SocialActivityRead/wren`, `StripeReconcile/all`, `TouchToJourney/all`

- time limits (`packages/core/src/restate/limits.ts`): `within` on each Restate call, `limitedRun` on HTTP steps, `unitLimits` strikes a unit three passes in a row into [[platform/checks]] (stage `loop.<service>/<key>`); the pass keeps them as `last.timeouts`

- `EmailSend` is one too since 2026-10-16 (wa-jsi): its tick step has 3 tries, then `passOrFailed` keeps it as a failed pass; `sync` replaced `tick`; a gone scope is a `stopped` pass. `hooks.syncAliases` keeps old names of `sync` for calls queued before a move (`tick` on `EmailSend`, until 2026-10-30). The state key is the same `loop`, so a running key stays running with no `start`

- `TouchToJourney/all` (`packages/core/src/touch-feed.ts`): woken 1 s after a new touch (`touches_feed_wake`, migration 0353), back in 5 s after a full batch, else every 15 minutes; per workspace (Wren main, then non-demo clients whose DB holds touches), reads untold touches (`fired_at` null, 200 a pass, oldest first), fires `trigger.touch` per touch, then marks them `fired_at` in a later step: at least once, a crash before the mark tells again and the executor enters a subject once (WA-1062). A late commit is read on the next pass. Rows from before 0366 were marked told. Off until started (`TouchToJourney/all/start`).

Citations: `packages/core/src/restate/loop.ts:366`, `packages/starling/outbound/src/email/restate/send-scheduler.ts:80`

## Connected to

- **owns:** one [[ledger/run]] per pass
- **owned-by:** [[platform/restate-services]] (bound in `services.ts`)
- **watched-by:** [[platform/loop-watch]] (a dead chain woken, a stuck pass named)

## If you change this

- **Hits:** every loop above; `walkthrough/demos/01-loops.sh`; `docs/restate-operations.md`; [[platform/loop-watch]] (reads `loop` state and `last.delayMs`, sends `wake`)
- **Does not hit:** plain services (`CompanySiteFind`, `CompanyEnrich`, `LeadVerify`, `Content`, `Ads`, `SmsDesk`, `SmsWebhookIntake`, `ContentDesk`, `ReplyLabel`)

## Surfaces

| Surface | Role |
|---|---|
| `wren content|ads|sms|social ... start/stop/status` (CLI over ingress); email loops by ingress only (`docs/restate-operations.md`) | drives |
| Restate (box) | schedules |
| `wren loops` + `LoopRevive/all` ([[platform/loop-watch]]): health per loop, dead ones woken | reads, drives |
| `ConsolePortal/loops` (admin SQL over `state` + `sys_invocation`; needs `WREN_RESTATE_ADMIN_URL`), `/setLoop` (`stop`, or `start` with no body so stored settings stay) | reads, drives |
| `ConsolePortal/agents` + portal `/loops/agents` (each part that runs for Wren as a card by stage; state read off these loops, `agent-model.ts`; designs/2026-10-11-agents.md) | reads |
| `console.loop` record (`packages/core/src/console/loops.ts:115`): the same rows as records, id `Service/key`, views all/failing/stopped, actions `console.startLoop`/`console.stopLoop` → `setLoop` | reads, drives |
| Loops app, Infra (`apps/portal/web/src/modules/wren/infra.tsx`, pure `hosts.ts`): every host on the graph kit, team only; worker, box and desk health from these rows (failing count, last pass) | reads |

## See

- Source: `packages/core/src/restate/loop.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/restate/loop.ts:179
---

# loop-object

The one way a recurring job runs: a Restate Virtual Object from `makeLoopObject` with handlers `start`, `stop`, `sync`, `loop`, `status`. Fourteen of them in prod. `loop` refuses at ingress: only the loop sends it.

## Why this shape

Restate owns the timer, so a worker dying or a laptop closing loses nothing; the delayed `loop` fires when the deployment is back (`packages/channel-email/src/restate/send-scheduler.ts:1`). Each pass is one journaled step that opens a run row; a stage failure is recorded on the row and in `last`, never thrown at the loop (`loop.ts:1`). A failure notice names the root cause and the table (`errorText`, `loop.ts:88`), never the SQL or its params, so one failure is one notice. `docs/restate-operations.md:363` still names the old path.

## Shape

- `makeLoopObject(name, pass)` (`loop.ts:179`); `failuresInARow` (`:34`); state keys for `last` and the `start` input (`:20`, `:22`)
- keys: `SendScheduler/{sender}`, `InboxScheduler/{sender}`, `ComposeScheduler/{niche}`, `PoolScheduler/{niche}`, `DigestScheduler/fleet`, `ReportScheduler/fleet`, `PostmasterScheduler/fleet`, `OpensScheduler/fleet`, `PlacementScheduler/fleet`, `ContentScheduler/default`, `ContentPlanner/default`, `ContentMetrics/default`, `AdsWatch/default`, `TokenRenewal/box`, `SmsSender/fleet`, `SmsWatch/daily`, `SearchWatch/default`

Citations: `packages/core/src/restate/loop.ts:179`

## Connected to

- **owns:** one [[ledger/run]] per pass
- **owned-by:** [[platform/restate-services]] (bound in `services.ts`)

## If you change this

- **Hits:** every loop above; `walkthrough/demos/01-loops.sh`; `docs/restate-operations.md`
- **Does not hit:** plain services (`Discovery`, `Enrichment`, `Resolution`, `Content`, `Ads`, `SmsDesk`, `SmsEvents`, `ContentDesk`, `Disposition`)

## Surfaces

| Surface | Role |
|---|---|
| `wren content|ads|sms ... start/stop/status` (CLI over ingress); email loops by ingress only (`docs/restate-operations.md`) | drives |
| Restate Cloud | schedules |
| `ConsolePortal/loops` (admin SQL over `state` + `sys_invocation`; needs `WREN_RESTATE_ADMIN_URL`), `/setLoop` (`stop`, or `start` with no body so stored settings stay) | reads, drives |
| `console.loop` record (`packages/core/src/console.ts:153`): the same rows as records, id `Service/key`, views all/failing/stopped, actions `console.startLoop`/`console.stopLoop` → `setLoop` | reads, drives |

## See

- Source: `packages/core/src/restate/loop.ts`

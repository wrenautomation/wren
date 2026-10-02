---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/core/src/notify.ts:21
---

# notifier

The one way a loop talks to a person: `Notifier.notify(title, body, level)`, with `none`, `console` and `discord` kinds. `level`: `info` = routine, posted @silent; `action` (someone waits on William) and `warning` (broke) @mention `WREN_DISCORD_PING_USER_ID`.

## Why this shape

Counts only, never content: the digest, health trips, ads pauses, the planner's shortfall and "what worked" all go through this seam, and none carries an address we mailed or a word anyone wrote back (`packages/channel-email/src/restate/digest-scheduler.ts:1`).

## Shape

- `Notifier` (`notify.ts:13`), `NOTIFIER_KINDS` (`:19`); `WREN_NOTIFY` + `WREN_DISCORD_WEBHOOK_URL` in settings; each sales lane (email, sms, reach, ads, content, search, clients) gets its own channel via `WREN_DISCORD_<LANE>_WEBHOOK_URL`, else the main one (`lane()` in `apps/worker/src/services.ts`)

Citations: `packages/core/src/notify.ts:21`

## Connected to

- **joins:** `DigestScheduler`, `SmsWatch`, `AdsWatch`, `ContentPlanner`, `ContentMetrics`, `TokenRenewal` (all in [[platform/loop-object]])

## If you change this

- **Hits:** every loop that names it in its deps; `apps/worker/src/services.ts` (built once)
- **Does not hit:** the weekly report (mailed through the transport, not notified)

## Surfaces

| Surface | Role |
|---|---|
| loops | write |
| Discord channel | reads |

## See

- Source: `packages/core/src/notify.ts`

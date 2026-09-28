---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:110
---

# sms-number

One phone number in the pool, on one registered campaign, with a ramp and a state. Table `sms_numbers`.

## Why this shape

A lead is texted from the same number every time; rotation is only volume balancing (fewest running threads), the pool never grows past `maxNumbers`, and a paused number is never swapped for a fresh one (`pool.ts:1`). Health pauses a number before a carrier does and never resumes it: a person reads why (`health.ts:1`).

## Shape

- `provider`, `provider_id`, `state` (active | paused | retired), `paused_reason`, `paused_at`, `ramp_started_on`, `retired_at` (`schema.ts:115`–`123`)
- `poolToday`, `pickNumber`, `syncNumbers`, `pauseNumber`, `resumeNumber` (`pool.ts:42`, `:90`, `:114`, `:166`, `:180`)

Citations: `packages/channel-sms/src/schema.ts:110`

## Connected to

- **owns:** the sticky `number_id` on [[sms/sms-contact]] and [[sms/sms-message]]
- **joins:** [[sms/sms-provider]] (numbers are synced from the vendor), the SMS policy (`policy.ts`)
- **looks-like-but-is-not:** [[email/roster]]

## If you change this

- **Hits:** `pool.ts`, `health.ts:91`, `deliver.ts` (one text per number per tick), `SmsDesk.numbers/syncNumbers/pause/resume`, `wren sms numbers`
- **Does not hit:** contacts' consent basis; the phone Worker

## Surfaces

| Surface | Role |
|---|---|
| `SmsDesk.syncNumbers` | writes from the provider |
| `SmsWatch/daily` | pauses |
| `SmsSender/fleet` | reads |

## See

- Source: `packages/channel-sms/src/pool.ts`

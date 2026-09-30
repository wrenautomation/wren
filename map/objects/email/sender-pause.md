---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-30 @ 404a150
entity: packages/channel-email/src/inbox/health.ts:166
---

# sender-pause

A sending address taken out of rotation, by a kill switch or by hand. Table `sender_pauses`; the switches live in `inbox/health.ts`.

## Why this shape

The grain is the domain, not the inbox: a spam verdict earned by one inbox is spent by its neighbours, so a trip pauses every inbox on the domain. The evidence window floors at the last lift, so a human's resume is not undone by the same evidence (`health.ts:1`). A campaign in `WREN_KILL_SWITCH_OFF_FOR` is left out of the evidence, and a kill-switch pause does not stop its sends; an operator pause stops everything (`send/deliver.ts`). One active pause per sender (`uq_sender_pauses_active`, `packages/channel-email/src/schema.ts:437`).

## Shape

- `sender`, `domain`, `reason`, `source` (kill_switch | operator), `paused_at`, `lifted_at`, `lifted_by`, `detail` (`schema.ts:423`–`430`)
- `evaluateKillSwitches`, `pause`, `resume`, `wouldTrip` (`health.ts:166`, `:246`, `:280`, `:207`)

Citations: `packages/channel-email/src/inbox/health.ts:166`

## Connected to

- **joins:** [[email/roster]], [[email/thread-event]] (hard bounces are the evidence), [[email/send-policy]] (the lines), `send_health` view (`views.ts:116`)
- **looks-like-but-is-not:** [[leads/suppression]]; an SMS number pause (`sms_numbers.state`)

## If you change this

- **Hits:** the send tick, which runs the switches first (`send/tick.ts:81`); `wren email senders pause/resume`; the digest
- **Does not hit:** Postmaster (read-only, never pauses: `inbox/postmaster.ts:1`)

## Surfaces

| Surface | Role |
|---|---|
| `SendScheduler` (kill switch) | writes |
| `wren email senders pause/resume` | writes |

## See

- Source: `packages/channel-email/src/inbox/health.ts`

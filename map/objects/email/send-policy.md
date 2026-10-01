---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-30 @ 404a150
entity: packages/channel-email/src/send/policy.ts:60
---

# send-policy

When the fleet may send and how far apart: a frozen `SendPolicy` parsed once from settings. Pure clock questions, no database.

## Why this shape

Caps are per inbox because reputation is earned per address; the one fleet-wide number is `newOpenersPerDay` (0 = follow-ups only: open threads finish, none start). Campaigns share the fleet, so each can carry its own opener brake (`nicheOpenersPerDay`, `WREN_NICHE_OPENERS_PER_DAY="agencies=0"`): one winds down while another opens. `killSwitchOffFor` names campaigns whose bounces the kill switch ignores and whose sends its pauses do not stop. The ramp is data (`from + step × (send days ÷ every)`), every window question is answered on the operator's clock and returned as a UTC instant (`policy.ts:1`). The lead's own clock narrows the window further, never widens it (`send/lead-timezone.ts:1`).

## Shape

- `SendPolicySettings`, `SendPolicyFields` (`policy.ts:38`, `:60`); the `WREN_SEND_*` keys in `packages/config/src/index.ts`

Citations: `packages/channel-email/src/send/policy.ts:60`

## Connected to

- **owned-by:** [[platform/settings]]
- **joins:** [[email/roster]], the send walk (`send/deliver.ts:190`), the queue-keeper's capacity (`restate/compose-scheduler.ts`), kill switches (`inbox/health.ts:207`)
- **looks-like-but-is-not:** the SMS policy (`packages/channel-sms/src/policy.ts`)

## If you change this

- **Hits:** `sendDue` pacing and windows; `ComposeScheduler`'s shortfall; digest hour
- **Does not hit:** which message goes (the walk decides), the SMS window

## Surfaces

| Surface | Role |
|---|---|
| env (`WREN_SEND_*`) | writes |
| `SendScheduler`, `ComposeScheduler`, `DigestScheduler` | read |

## See

- Source: `packages/channel-email/src/send/policy.ts`

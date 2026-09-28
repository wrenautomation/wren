---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/send/policy.ts:59
---

# send-policy

When the fleet may send and how far apart: a frozen `SendPolicy` parsed once from settings. Pure clock questions, no database.

## Why this shape

Caps are per inbox because reputation is earned per address; the one fleet-wide number is `newOpenersPerDay`. The ramp is data (`from + step × (send days ÷ every)`), every window question is answered on the operator's clock and returned as a UTC instant (`policy.ts:1`). The lead's own clock narrows the window further, never widens it (`send/lead-timezone.ts:1`).

## Shape

- `SendPolicySettings`, `SendPolicyFields` (`policy.ts:37`, `:59`); the `WREN_SEND_*` keys in `packages/config/src/index.ts`

Citations: `packages/channel-email/src/send/policy.ts:59`

## Connected to

- **owned-by:** [[platform/settings]]
- **joins:** [[email/roster]], the send walk (`send/deliver.ts:190`), the queue-keeper's capacity (`restate/compose-scheduler.ts`), kill switches (`inbox/health.ts:207`)
- **looks-like-but-is-not:** the SMS policy (`packages/channel-sms/src/policy.ts`)

## If you change this

- **Hits:** `sendDue` pacing and windows; `ComposeScheduler`'s shortfall; digest hour; `sops/campaign-ramp.md`
- **Does not hit:** which message goes (the walk decides), the SMS window

## Surfaces

| Surface | Role |
|---|---|
| env (`WREN_SEND_*`) | writes |
| `SendScheduler`, `ComposeScheduler`, `DigestScheduler` | read |

## See

- Source: `packages/channel-email/src/send/policy.ts`

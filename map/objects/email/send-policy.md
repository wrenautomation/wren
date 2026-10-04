---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-04 @ afd15eb
entity: packages/channel-email/src/send/policy.ts:60
---

# send-policy

When the fleet may send and how far apart: a frozen `SendPolicy` parsed once from settings. Pure clock questions, no database. The console lays per-campaign overrides over it each tick (`withCampaigns`, `policy.ts:268`).

## Why this shape

Caps are per inbox because reputation is earned per address; the one fleet-wide number is `newOpenersPerDay` (0 = follow-ups only: open threads finish, none start). Campaigns share the fleet, so each can carry its own opener brake (`nicheOpenersPerDay`, `WREN_NICHE_OPENERS_PER_DAY="agencies=0"`): one winds down while another opens. `killSwitchOffFor` names campaigns whose bounces the kill switch ignores and whose sends its pauses do not stop. Both per-campaign values can be overridden live from the console: table `campaign_controls` (null = env), read once per tick by `campaignPolicy` (`send/campaign-controls.ts:16`) in the worker's main scope, the compose and pool schedulers and the campaign and inbox records; client scopes ignore it. A value equal to env is stored as null, so an undo lands back on env. The ramp is data (`from + step × (send days ÷ every)`), every window question is answered on the operator's clock and returned as a UTC instant (`policy.ts:1`). The lead's own clock narrows the window further, never widens it (`send/lead-timezone.ts:1`).

## Shape

- `SendPolicySettings`, `SendPolicyFields` (`policy.ts:38`, `:60`); the `WREN_SEND_*` keys in `packages/config/src/index.ts`
- `campaign_controls(campaign, kill_switch, openers_per_day, updated_at, updated_by)` (`packages/channel-email/src/schema.ts:565`, migration 0066)

Citations: `packages/channel-email/src/send/policy.ts:60`

## Connected to

- **owned-by:** [[platform/settings]]
- **joins:** [[email/roster]], the send walk (`send/deliver.ts:190`), the queue-keeper's capacity (`restate/compose-scheduler.ts`), kill switches (`inbox/health.ts:207`)
- **looks-like-but-is-not:** the SMS policy (`packages/channel-sms/src/policy.ts`)

## If you change this

- **Hits:** `sendDue` pacing and windows; `ComposeScheduler`'s shortfall; digest hour; a new per-campaign reader must take the merged policy from `campaignPolicy`, or it ignores the console
- **Does not hit:** which message goes (the walk decides), the SMS window

## Surfaces

| Surface | Role |
|---|---|
| env (`WREN_SEND_*`) | writes |
| `EmailConsole{setCampaign,killSwitchOn,killSwitchOff,stopOpeners,resumeOpeners}` | writes `campaign_controls` |
| `SendScheduler`, `ComposeScheduler`, `DigestScheduler` | read |

## See

- Source: `packages/channel-email/src/send/policy.ts`

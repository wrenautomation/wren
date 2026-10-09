---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ d43c916c
entity: packages/core/src/schema.ts:512
---

# webhook-subscription

Outbound webhooks: a client's https URL that hears the events it picked, signed. Tables `webhook_subscriptions`, `webhook_deliveries`, `webhook_attempts`; Restate service `Webhooks`. Account > Webhooks in the portal, `wren webhooks` on the CLI.

## Why this shape

A delivery is a row before it is a request, keyed `(subscription, event_id)`, so a retried publish queues once and a receiver can dedupe on `webhook-id`. Signing is Standard Webhooks, so any of its libraries verifies us with no code of ours. The ladder (1m, 5m, 30m, 2h, 6h, 12h; 7 tries) runs as a Restate loop of `ctx.run` + `ctx.sleep`, durable across Lambda restarts, and every try is its own row so the log shows each answer. The secret is sealed with `WREN_HOOK_KEY`, so it shows once and rotate keeps the old one signing 24 hours.

## Shape

- `webhook_subscriptions` (main only): `client` (null is Wren), `name`, `url`, `events text[]`, `secret` and `prev_secret` (sealed, `whsec_<base64>`), `prev_until`, `active`, `by`, `at`, `rotated_at`, `failing_since`, `disabled_at`, `disabled_why`. At most 20 per client.
- `webhook_deliveries`: `subscription` (cascade), `event`, `event_id` (`msg_<32>` from the Restate call, `eventIdOf`), `payload {type, timestamp, data}`, `state` pending|delivered|failed, `attempts`, last `status`, `latency_ms`, `response` (first 1000 chars), `error`, `at`, `last_at`, `next_at` (the next try while a failed one waits).
- `webhook_attempts`: `delivery` (cascade), `n`, `status`, `latency_ms`, `response`, `error`, `at`.
- Events (`WEBHOOK_EVENTS`, `packages/core/src/webhook-events.ts:10`): `lead.created` and `form.submitted` (the door, `Spine/hook` and `Spine/door`), `reply.received`, `booking.made`, `booking.cancelled` (`Spine/fire`), `deal.won` (`close` emits `outcome.won`). Test sends `webhook.test` to one URL.
- Guard: `urlProblem` (`:130`) wants https, no login, a dotted public host, no private or metadata address; `privateIp` (`:104`) covers v4, v6, mapped and NAT64. `safePost` (`packages/core/src/webhooks.ts:125`) checks every resolved address before connecting (DNS rebinding), follows no redirect, 10 s timeout, 64 KB cap.
- Headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64 HMAC-SHA256>`, two during a rotate; `signedHeaders`, `:51`). Receivers turn away a timestamp past 5 minutes.
- `Webhooks/publish` and `Webhooks/deliver` are private; `Webhooks/redeliver {id}` is public (zod input) so the CLI calls it through ingress. Retried: no answer, 408, 425, 429, 5xx. An off subscription fails its pending deliveries ("the webhook is off"). `tally` (`packages/core/src/webhooks.ts`) sets `failing_since` on a failed try and clears it on a landed one. Past `DISABLE_AFTER_DAYS` (5) it turns the subscription off with `disabled_at` and `disabled_why`. `editSubscription` turning it on clears all three.
- Send webhook node (`logic.webhook`, `packages/core/src/logic.ts:382`, step `webhookStep`, `webhooks.ts:726`): URL, method, headers, JSON body with `{{data.x}}` slots (a whole slot keeps its type), `keep` names parts of the answer onto `data.webhook`. Out `answered` (2xx) or `refused`; no answer or a 5xx throws so the spine's tries and auto-retry apply. It has effect `sends` (`effectsIn`, `packages/core/src/workflows.ts`), so the Effects column, template install and Publish all ask the id typed back.

Citations: `packages/core/src/schema.ts:512`, `packages/core/src/schema.ts:551`, `packages/core/src/schema.ts:588`, `packages/core/src/webhooks.ts:630`, `packages/core/src/webhooks.ts:689`, `packages/delivery/src/webhooks.ts:1`, `apps/cli/src/webhooks.ts:1`

## Connected to

- **owns:** `webhook_subscriptions`, `webhook_deliveries`, `webhook_attempts`
- **owned-by:** [[platform/restate-services]]
- **joins:** [[clients/client]] by `client` (cascade); [[platform/spine]] publishes into it (`SpineDeps.publish`)
- **looks-like-but-is-not:** `hooks` (inbound doors, [[platform/spine]]); `sms_events` (Telnyx's webhooks to us)

## If you change this

- **Hits:** every client's receivers: the payload shape and headers are a public contract. Renaming an event breaks their subscriptions. Changing `WREN_HOOK_KEY` makes every secret unreadable; deliveries fail with that reason.
- **Does not hit:** the inbound door and its tokens.

## Surfaces

| Surface | Role |
|---|---|
| Account > Webhooks (`apps/portal/web/src/modules/account/Webhooks.tsx`) | list, add (secret once), test, on/off, new secret, remove, delivery log with each try and "retrying at", Redeliver, "Turned off" with why and Turn back on; owner or team `manage` |
| `wren [--client] webhooks events/list/add/remove/on/off/rotate/test/log/redeliver` | the same from the CLI; Wren never adds one on prod |
| worker (`apps/worker/src/services.ts`) | serves `Webhooks`; the Send webhook step |
| Workflow editor, Actions | the Send webhook node |

## See

- Design: `designs/2026-10-07-webhooks-out.md`
- Tests: `packages/core/src/webhooks.test.ts`, `packages/core/test/integration/webhooks.test.ts`

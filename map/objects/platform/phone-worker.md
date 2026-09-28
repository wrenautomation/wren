---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: apps/phone/src/worker.ts:1
---

# phone-worker

`phone.wrenautomation.com`: a Cloudflare Worker that is the SMS inbox PWA for the iPhone, Seeker and Mac, and the door Telnyx webhooks come in by. Holds passkeys only; texts live in Postgres behind Restate.

## Why this shape

The Worker holds no data (`worker.ts:1`). Webhooks are signature-checked there and handed to `SmsEvents/ingest/send` with the event id as idempotency key; `/api/<handler>` forwards signed-in calls to `SmsDesk`, and only the handlers the app needs are open. Passkeys register once via a setup link, then sign in alone (`passkeys.ts:1`).

## Shape

- `worker.ts`, `passkeys.ts`, `public/` (the app), `wrangler.toml` (KV id, domain)
- secrets: `WREN_PHONE_SESSION_SECRET`, `WREN_PHONE_SETUP_TOKEN`, `CLOUDFLARE_API_TOKEN` in `deploy/prod.env` and the `production` GitHub environment (`deploy/phone.md`)
- deployed by the last step of `deploy.yml:56`

Citations: `apps/phone/src/worker.ts:1`, `deploy/phone.md`

## Connected to

- **joins:** [[sms/sms-event]], [[sms/sms-contact]], [[sms/sms-message]] (through `SmsDesk`), [[sms/sms-provider]] (webhook signature, `packages/channel-sms/src/webhook.ts`)

## If you change this

- **Hits:** `deploy/phone.md`, `wrangler.toml`, `deploy.yml`, the `SmsDesk` handler list, Telnyx's webhook URL (set on their portal, outside the repo)
- **Does not hit:** `apps/worker`; email

## Surfaces

| Surface | Role |
|---|---|
| Telnyx | posts webhooks |
| William's devices | read the inbox, reply |

## See

- Source: `apps/phone/src/worker.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-01 @ 8e110f7
entity: apps/phone/src/worker.ts:1
---

# phone-worker

`phone.wrenautomation.com`: a Cloudflare Worker that is the SMS inbox PWA for the iPhone, Seeker and Mac, and the door Telnyx webhooks come in by. Holds nothing; texts live in Postgres behind Restate.

## Why this shape

The Worker holds no data (`worker.ts:1`). Webhooks are signature-checked there and handed to `SmsEvents/ingest/send` with the event id as idempotency key; `/api/<handler>` forwards calls to `SmsDesk` for Wren's operators only, and only the handlers the app needs are open. Sign-in is Wren's shared one (auth.wrenautomation.com, any method, passkeys too): the app sends the 15-minute token and the Worker checks it and its operator flag (`worker.ts:86`), as the portal does. A client's token is turned away.

## Shape

- `worker.ts`, `public/` (the app), `wrangler.toml` (domain, `AUTH_ORIGIN`)
- secrets: Restate's and Telnyx's (`deploy/phone.md`); `CLOUDFLARE_API_TOKEN` in the `production` GitHub environment
- deployed by `deploy.yml:65`

Citations: `apps/phone/src/worker.ts:1`, `deploy/phone.md`

## Connected to

- **joins:** [[clients/client-member]] (the operator flag in the token), [[sms/sms-event]], [[sms/sms-contact]], [[sms/sms-message]] (through `SmsDesk`), [[sms/sms-provider]] (webhook signature, `packages/channel-sms/src/webhook.ts`)

## If you change this

- **Hits:** `deploy/phone.md`, `wrangler.toml`, `deploy.yml`, `APPS` in `apps/auth/wrangler.toml` (the token's CORS), the `SmsDesk` handler list, Telnyx's webhook URL (set on their portal, outside the repo)
- **Does not hit:** `apps/worker`; email

## Surfaces

| Surface | Role |
|---|---|
| Telnyx | posts webhooks |
| William's devices | read the inbox, reply |

## See

- Source: `apps/phone/src/worker.ts`

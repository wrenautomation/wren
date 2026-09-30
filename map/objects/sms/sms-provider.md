---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/channel-sms/src/provider.ts:74
---

# sms-provider

The carrier port: `SmsProvider`, with `telnyx.ts` as the one file that names a vendor, `FakeProvider` for tests and dry runs, `NoProvider` for a deploy before a carrier exists.

## Why this shape

`send` answers accepted, rejected for good, or try later, and throws for "cannot know", which the caller marks `unknown` and never resends (`provider.ts:1`). On Lambda the fake is refused, so prod cannot pretend to send; that is the intended state until Telnyx is set up (`apps/worker/src/services.ts:316`). Even with a real provider nothing leaves until `WREN_SMS_LIVE` says the 10DLC campaign is approved (`deliver.ts:1`).

## Shape

- `SmsProvider` (`provider.ts:74`); `telnyx.ts`; `webhook.ts` (signature, WebCrypto so it runs in the Cloudflare Worker too)

Citations: `packages/channel-sms/src/provider.ts:74`

## Connected to

- **joins:** [[sms/sms-number]] (`syncNumbers`), [[sms/sms-message]] (`provider_id`), [[sms/sms-event]]
- **looks-like-but-is-not:** [[email/transport]]

## If you change this

- **Hits:** `deliver.ts`, `pool.ts:114`, `health.ts` (balance), `events.ts`, `apps/phone/src/worker.ts`, settings `WREN_SMS_*`, `apps/worker/src/services.ts:312`
- **Does not hit:** contacts' consent; templates

## Surfaces

| Surface | Role |
|---|---|
| `SmsSender/fleet` | calls send |
| `SmsDesk.syncNumbers`, `SmsWatch` | call lookups, balance |

## See

- Source: `packages/channel-sms/src/provider.ts`

---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[research/document]]", "[[sms/sms-contact]]", "[[sms/sms-number]]", "[[sms/sms-provider]]", "[[leads/suppression]]"]
produces: ["[[sms/sms-contact]]", "[[sms/sms-message]]", "[[sms/sms-event]]", "[[leads/suppression]]", "[[sms/sms-number]]"]
---

# sms-tick

Phones lifted from crawled pages become contacts with a basis; enrolled contacts get texts from a sticky number inside their own window; webhooks and a daily watch keep it honest.

## Input → Movement → Output

Stored documents and the niche's SMS sequence. `SmsDesk.lift` writes contacts with `published` basis; `SmsDesk.enroll` confirms mobiles and queues step 1; `SmsSender/fleet` runs one tick per pass (reconcile, then at most one text per ready number, under every cap, only when `WREN_SMS_LIVE` allows a real provider); `SmsEvents.ingest` applies receipts and inbound texts once each; `SmsWatch/daily` labels replies and runs health every 30 minutes.

## Why this shape

Texting a stranger twice is worse than missing one, so intent-before-act and idempotent webhooks. A STOP is a phone suppression on every channel, forever. Health pauses and never resumes.

## Steps

1. Lift (`packages/channel-sms/src/lift.ts:77`); add by hand (`contacts.ts:12`).
2. Enroll (`enroll.ts:69`; step 1 at `:172`).
3. Tick (`deliver.ts:170`; reconcile `:63`; policy `policy.ts`; pool `pool.ts:90`).
4. Events (`events.ts:230`; rules `:53`; signature `webhook.ts`; door `apps/phone/src/worker.ts`).
5. Labels and health (`classify.ts:101`, `health.ts:91`; loop `restate/index.ts:320`).

## If you change this

- **Hits:** every `sms/` card, the phone app, `walkthrough/05-sms.md`, `designs/2026-09-27-phone-channel.md`
- **Does not hit:** email

## Surfaces

| Surface | Role |
|---|---|
| `wren sms lift/enroll/queue/threads/numbers` | drives |
| `SmsSender`, `SmsEvents`, `SmsDesk`, `SmsWatch` | run |
| phone PWA | reads, replies |

## See

- Objects: [[sms/sms-message]]
- Source: `packages/channel-sms/src/restate/index.ts`

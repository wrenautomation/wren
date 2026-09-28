---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/send/transport.ts:78
---

# transport

The way an email actually leaves: the `Transport` contract, `GmailTransport` over domain-wide delegation in prod, `ConsoleTransport` as the permanent dry run.

## Why this shape

Sending is the one irreversible act, so the contract answers two questions after a failure: did the request leave (`TransportRefused` = no, re-armable; `TransportAmbiguous` = maybe, only reconcile moves it), and can we find it again (`find()` by our own Message-ID, minted before the send) (`transport.ts:1`). `GmailClient` is dumb bytes; only `GmailTransport` decides what a failure means (`gmail.ts:1`).

## Shape

- `Transport` (`transport.ts:78`); `GmailTransport`, `GmailClient` (`send/gmail.ts`); `ConsoleTransport`
- `messages.transport` names which one made the attempt; reconcile refuses to answer for another (`send/reconcile.ts:1`)

Citations: `packages/channel-email/src/send/transport.ts:78`

## Connected to

- **joins:** [[email/message]] (`message_id`, `gmail_id`, `transport`), [[email/roster]] (which inbox)
- **looks-like-but-is-not:** the inbox reader (`GmailReader`, same credential, read side); [[sms/sms-provider]]

## If you change this

- **Hits:** `send/deliver.ts`, `send/reconcile.ts:42`, `restate/report-scheduler.ts` (mails the report through it), the Lambda build (`services.ts`)
- **Does not hit:** compose; the inbox sync

## Surfaces

| Surface | Role |
|---|---|
| `SendScheduler/{sender}` | calls |
| `ReportScheduler/fleet` | calls |

## See

- Source: `packages/channel-email/src/send/gmail.ts`

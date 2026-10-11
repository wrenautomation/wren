---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-11 @ 5130a887
entity: packages/channel-email/src/send/transport.ts:82
---

# transport

The way an email actually leaves: the `Transport` contract, `GmailTransport` over domain-wide delegation in prod, `SmtpTransport` for an inbox on its own login, `ConsoleTransport` as the permanent dry run.

## Why this shape

Sending is the one irreversible act, so the contract answers two questions after a failure: did the request leave (`TransportRefused` = no, re-armable; `TransportAmbiguous` = maybe, only reconcile moves it), and can we find it again (`find()` by our own Message-ID, minted before the send) (`transport.ts:1`). `GmailClient` is dumb bytes; only `GmailTransport` decides what a failure means (`gmail.ts:1`).

## Shape

- `Transport` (`transport.ts:82`); `GmailTransport`, `GmailClient` (`send/gmail.ts`); `ConsoleTransport`
- `SmtpTransport` (`send/smtp.ts:90`): our MIME over SMTP, then IMAP APPEND to Sent unless the server filed it; `find` = SEARCH HEADER Message-ID in Sent. Failure table in the file head: connect/login, MAIL FROM, DATA or the message refused = refused (inbox sidelined); RCPT TO = refused (this message); line lost once the envelope began = ambiguous
- `RoutedTransport` (`transport.ts:96`) picks per sender: roster `transport = "smtp"` → its `SmtpTransport`, `"instantly"` → `InstantlyTransport` (`inbox/instantly.ts:150`, refuses every send sender-level: wren only reads those inboxes), else Gmail. Logins from the mailboxes file (`send/mailboxes.ts`, `WREN_MAILBOXES_FILE`; SSM `/wren/prod/mailboxes`)
- `messages.transport` names the inner transport that made the attempt (`carrierOf`); reconcile asks that one and refuses to answer for another (`send/reconcile.ts:1`)

Citations: `packages/channel-email/src/send/transport.ts:82`

## Connected to

- **joins:** [[email/message]] (`message_id`, `gmail_id`, `transport`), [[email/roster]] (which inbox)
- **looks-like-but-is-not:** the inbox reader (`GmailReader`; `ImapReader` on the same login: INBOX + spam, read-only, never sets \Seen; `InstantlyReader` for inboxes only Instantly holds: its `/emails` API, `mode=emode_all`, received mail only, raw rebuilt as plain RFC 822, no In-Reply-To so replies match by From, `inbox/instantly.ts:46`); [[sms/sms-provider]]

## If you change this

- **Hits:** `send/deliver.ts`, `send/reconcile.ts:42`, `restate/report-scheduler.ts` (mails the report through it), the Lambda build (`services.ts`)
- **Does not hit:** compose; the inbox sync

## Surfaces

| Surface | Role |
|---|---|
| `SendScheduler/{sender}` | calls |
| `ReportScheduler/fleet` | calls |

## See

- Source: `packages/channel-email/src/send/gmail.ts`, `send/smtp.ts`, `inbox/imap.ts`, `inbox/instantly.ts`

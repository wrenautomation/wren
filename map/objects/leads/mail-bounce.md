---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ ee317d52
entity: packages/core/src/bounces-schema.ts:35
---

# mail-bounce

A delivery report that came back to a workspace's sending mailbox for one of its marketing emails (a broadcast, a newsletter issue, a workflow's Send message). Tables `mail_bounces` and `mail_bounce_reads`, in each workspace's own database. Cold email's bounces are [[email/thread-event]]s, not these.

## Why this shape

Marketing mail leaves through the Gmail or Graph API, so its bounces land in the sending mailbox. Every marketing send keeps the Message-ID it went with (`broadcast_recipients.message_id`, `consent_events.message_id`), minted before it leaves (`mintMessageId`, `packages/core/src/bounces.ts:54`). A report matches by the Message-ID it carries (embedded original, References, In-Reply-To), else by its Final-Recipient: the newest marketing email to that address in the week before (`sendOf`, `:70`). A report for none of our sends is not kept: a client's mailbox holds its other mail too.

`recordBounce` (`:157`) keeps one row per report (`uq_mail_bounces_mailbox_provider`). Hard on the address mailed: do-not-contact, reason bounce, status and diagnostic as evidence, in the same transaction. Hard naming another address: kept only. Soft: kept only.

`mail_bounce_reads` is each sending mailbox's last check, one row per mailbox in the workspace's own database. It is also the proof the [[leads/sent-log]] needs before a marketing email counts as delivered: 48 hours on, and a check ran past that mark.

A late bounce comes back to the mailbox that sent, not the one picked now. `last_sender_at` is the last time a mailbox was the workspace's sender: the loop stamps the picked one each pass, and `saveMessageSettings` stamps the one a change drops (`noteBounceSender`, `:226`). Every mailbox stamped within `BOUNCE_LATE_MS` (14 days: five days of server retries, a week of margin) is read (`bounceMailboxes`), if it is still connected.

## Shape

- `mail_bounces` (`packages/core/src/bounces-schema.ts:35`): `mailbox`, `provider_id`, `message_id`, `address`, `class` hard|soft, `matched_by` message_id|address, `status`, `diagnostic`, `recipient_id` or `consent_event_id`, `suppression_id`, `received_at`. Migration 0258.
- `mail_bounce_reads` (`:92`): `mailbox`, `read_at` (null before the first check), `stats`, `last_sender_at`. Migrations 0258, 0260.
- Reader: `readBounces` (`packages/channel-email/src/inbox/marketing-bounces.ts:63`): Gmail search for reports (Spam and Trash too), Graph's inbox by time; `mayBeBounce` on sender and subject, then `classify` (`inbox/inbound.ts`). First check looks back 7 days, later ones overlap 15 minutes.
- Loop: `BounceScheduler/all`, hourly (`packages/channel-email/src/restate/bounce-scheduler.ts:75`). Wren's portal@ mailbox into main; each client's picked sender, and any it picked in the last 14 days, into its own database. A sender with no read connection is skipped (`SEND_ONLY`, `:41`); an earlier sender no longer connected too (`GONE`).

Citations: `packages/core/src/bounces.ts:157`, `packages/channel-email/src/restate/bounce-scheduler.ts:44`

## Connected to

- **owned-by:** [[leads/broadcast]] (recipient rows), [[leads/consent]] (`sent` events)
- **writes:** [[leads/suppression]] (hard bounces)
- **feeds:** [[leads/sent-log]] (Bounced, the delivered rule, the history lines)
- **looks-like-but-is-not:** [[email/thread-event]] (cold email's bounces, read by the inbox sync)

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `bounces-schema.ts`), a migration; `packages/core/src/message-settings.ts` (a sender change stamps the one it drops); `packages/core/src/sent-views.ts` (`HARD`, `QUIET`); `apps/worker/src/services.ts` (the loop's wiring; `readers` for Account → Messaging); `packages/delivery/src/records.ts` (the send-only note on the sender row)
- **Does not hit:** cold email's inbox sync and its `thread_events`

## Surfaces

| Surface | Role |
|---|---|
| `BounceScheduler/all` | writes |
| People → Sent | reads |
| Account → Messaging (portal) | says when the sender is send only |

## See

- Source: `packages/core/src/bounces.ts`, `packages/channel-email/src/inbox/marketing-bounces.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (bounce reading)

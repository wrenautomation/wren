---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ da6ecb5
entity: packages/core/src/sent-views.ts:61
---

# sent-log

Everything we sent, on any channel, as one list (People → Sent). Views `sent_records` and `sent_activity`, record `people.sent`. No table of its own.

## Why this shape

Each channel already keeps its own sends: `messages`, `sms_messages`, `reach_messages`, `comments`, `reach_posts`, `reddit_threads`, and a consent event of kind `sent` for each newsletter and marketing mail. Copying them would drift, so one view unions them and the record reads the view (`packages/core/src/sent-views.ts:58`). A row's id is `<source>:<source id>` (`email:12`), which is also how the message is opened from its own table (`sentDetail`, `packages/core/src/sent-records.ts:92`).

One ladder for all (`SENT_STATES`, `sent-records.ts:42`): a row sits at the furthest step its channel can prove, and bounced or failed win. Email has no delivery receipts, so it counts as delivered after 48 hours with no bounce, or sooner on an open, a click or a reply, and the history says which rule fired; texts read the carrier's receipt. "Clicked" comes from [[email/email-click]] (pulled hourly from the lander). A text or DM click never arrives: neither carries a code. Each channel's own state stays beside it (`channel_state`).

## Shape

- `sent_records`: `id`, `channel` (an access channel), `kind` (email | newsletter | sms | dm | comment), `to_address`, `key_kind` + `key_value` (the `profile_keys` pair for the same address: `email`, `phone`, `handle:<platform>`), `subject` (else the first 140 characters of the body), `channel_state`, `state`, `campaign`, `at` (`sent-views.ts:58`)
- `sent_activity`: `message`, `at`, `kind`, `what`, `seq` (`:181`). An email open or click counts only 2 minutes or more after sending, as `open_outcomes` does; a scan before that shows as a note. Both the 48-hour rule and the proof read `now()`: a message crosses into delivered by itself, with nothing written
- Replies and bounces find their message by the headers, else the last one sent on that thread before they arrived; a text or DM reply is the next inbound before our next send
- `people.sent` record, views All, Bounced and failed, Opened, Replied (`packages/core/src/sent-records.ts:167`)
- `PeopleConsole`: serves People's records from a client's own database (`packages/core/src/people-console.ts:61`, routes in `people-console-routes.ts`); Wren's own People is served by the console

Citations: `packages/core/src/sent-views.ts:58`, `packages/core/src/sent-records.ts:167`

## Connected to

- **reads:** [[email/message]], [[sms/sms-message]], [[email/open-event]], [[email/email-click]], [[email/thread-event]], [[content/comment]], [[content/reach-post]], [[content/reddit-thread]], [[leads/consent]]
- **joins:** B1's profiles on `key_kind` + `key_value` (to show a name and link the row)
- **looks-like-but-is-not:** [[leads/touch]] (social touches per person, ours and theirs, kept as rows); `draft_events` (training record)

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (the views file is listed there), a new migration for any view edit, `apps/portal/web/src/modules/people/sent.tsx`, `packages/core/test/integration/sent.test.ts`
- **Does not hit:** the source tables (read only); sending, which never reads this log

## Surfaces

| Surface | Role |
|---|---|
| People → Sent (portal) | reads |
| `ConsolePortal` records, `PeopleConsole` | reads |

## See

- Source: `packages/core/src/sent-views.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B2)

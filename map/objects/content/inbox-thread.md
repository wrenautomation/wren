---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ a4fd1344 (client inbox)
entity: packages/content/src/schema.ts:465
---

# inbox thread (one person's conversation in the Inbox)

A row in Inbox → Waiting on you, opened as the person's whole history across channels, with a reply box, notes, an assignee, a status and a snooze (designs/2026-10-07-inbox-reply.md). The thread id is the Inbox row's id (`text:12`, `comment:4`, `reply:9`, `email:7`, `dm:3`).

## Why this shape

GHL Conversations is the model (William, 2026-10-07: "steal all the stuff"). A reply goes out on the channel's own send path, so every check stays: opt-outs, caps, the 08:00 to 20:00 text window, the client's sends flag, the approver. Anything that waits for a yes goes to To approve, never back into the Inbox (inbound only).

## Shape

- `inbox_threads` (`schema.ts:465`): thread, assignee, status open|waiting|closed, `status_at`, `snooze_until`, by. No row: status follows the channel's state. A message in after `status_at` reopens (`statusOf`, `packages/content/src/inbox/threads.ts:37`)
- `inbox_replies` (`schema.ts:494`): an asked reply (thread, channel, target, body, state waiting|sent|dropped, by, why); To approve lists it as type `reply` (`approvalRecord`, `packages/content/src/social/records.ts:480`)
- Timeline: `conversationOf` (`packages/content/src/inbox/conversation.ts:529`) joins by person: emails, texts, DMs, comments (also by linked `social_handles`), bookings, touches, notes, asked replies; oldest first. `options` lists each channel a reply can take; `pickOption` rebuilds it on send and refuses any other target or an opted-out one
- Gate: `replyGate` (`send.ts:34`) says send or ask; part per channel: DM `reach.outreach`, comment `content.posting`, email and text `follow_up`. Wren's own threads skip the flag; the viewer's `effect` still decides
- `InboxDesk` (`packages/content/src/restate/inbox-desk.ts:110`): reply (`effect: sends`), ask, approve, drop, suggest (`suggestReply`, `suggest.ts:60`; DMs via `draftDm`), note, assign, take, status, snooze. Bound in `apps/worker/src/services.ts:1014`
- Record `marketing.inbox` (`inboxRecord`, `social/records.ts:214`): `status`, `assignee`, `snoozeUntil` columns; views Mine, Unassigned, Snoozed, All; `calls` names `thread` for each InboxDesk handler
- Portal: `conversationExtras` (`apps/portal/web/src/modules/marketing/conversation.tsx`) draws the timeline, reply box (Reply by, Send or Ask to send, Suggest, Insert snippet) and note box; row actions `INBOX_THREAD_ACTIONS` (`modules/marketing/index.ts:498`: T take, A assign, E close, Z snooze), To approve's `ASKED_REPLY_ACTIONS` (`:657`); R and N focus the boxes
- Tests: `packages/content/test/integration/inbox-reply.test.ts` over `test/inbox-seed.ts` and a fake sender; `test/inbox-preview.ts` seeds a local database

## Connected to

- **joins:** [[content/comment]], [[leads/touch]], [[email/thread-event]], [[email/call-booking]], sms contacts, reach contacts (the channels a thread reads and replies on)
- **joins:** [[platform/notes]] (`inbox_notes`, mentions in `note_mentions`)
- **looks-like-but-is-not:** Wren's email Inbox (`email.inbox`, the roster), and the Monitor's "Your mail"

## If you change this

- **Hits:** each channel's send path (the desks `InboxDesk` calls), To approve, Mentions
- **Does not hit:** the channel's own state: closing a thread never marks a DM read or a comment answered

## Surfaces

| Surface | Role |
|---|---|
| Inbox → Waiting on you | reads, writes |
| Marketing → To approve | reads asked replies, approves |
| Inbox → Mentions | reads note mentions |
| client Marketing → Inbox | reads, writes (`MarketingConsole` `inbox*`) |
| client Marketing → To approve | reads asked replies, approves (`marketing.asked_reply`) |
| client Notes → Mentions | reads its Inbox mentions |

## Limits

- A client's login works its own threads only, through `MarketingConsole`, on its own database. `InboxDesk` checks `act` on the thread's channel, `effect` plus the approver to send.
- A client's DMs and comments can't send yet: their desks are Wren's only.

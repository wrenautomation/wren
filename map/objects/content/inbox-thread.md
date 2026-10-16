---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-14 @ 7d42f31a (queued view)
entity: packages/content/src/schema.ts:465
---

# inbox thread (one person's conversation in the Inbox)

A row in Inbox → Waiting on you, opened as the person's whole history across channels, with a reply box, notes, an assignee, a status and a snooze (designs/2026-10-07-inbox-reply.md). The thread id is the Inbox row's id (`text:12`, `comment:4`, `reply:9`, `email:7`, `dm:3`, `mail:5`, `chat:2`). `outbound:<enrollment>` names our email thread they never answered: no Inbox row, only a Follow-up email's ask sits on it.

## Why this shape

GHL Conversations is the model (William, 2026-10-07: "steal all the stuff"). A reply goes out on the channel's own send path, so every check stays: opt-outs, caps, the 08:00 to 20:00 text window, the client's sends flag, the approver. Anything that waits for a yes goes to To approve, never back into the Inbox (inbound only).

## Shape

- `inbox_threads` (`schema.ts:465`): thread, assignee, status open|waiting|closed, `status_at`, `snooze_until`, by. No row: status follows the channel's state. A message in after `status_at` reopens (`statusOf`, `packages/content/src/inbox/threads.ts:37`)
- `inbox_replies` (`schema.ts:868`): an asked reply (thread, channel, target, body, state waiting|queued|sent|dropped|failed, by, why, detail, `send_at` (a queued row's turn)); To approve lists it as type `reply` (`approvalRecord`, `packages/content/src/social/records.ts:675`; `replyItem`, `:647`, makes the row). Approve claims the row (`sent`) before it sends; a send the frequency cap holds (an email follow-up, `thread:` target, `HeldReply` with `until`, `packages/content/src/inbox/send.ts:178`) keeps William's yes: the row goes to `queued` (`queueReply`, `send.ts:301`: `send_at` is the cap's `until`, `detail` is `QUEUED_WHY`) and leaves Waiting on you, `InboxDesk.approve` returns `{sent: false, queued}`, and a delayed `InboxDesk.release` call (`inbox-desk.ts:503`, ingress private, takes only `{id, client}`) takes it back (`releaseReply`, `send.ts:322`, `queued` to `sent`, `send_at` cleared), asks `Disposition.followUp` again with the workflow's campaign (UTM tags) and sends, or queues again if still held, or marks it `failed` with why on a refusal; Drop while queued cancels it (`settleReply`, `send.ts:259`, takes `queued` to `dropped`). The row shows in To approve's Queued view (`queuedReplies`, `send.ts:309`, soonest first; the Inbox's and a client's To approve both have the view): who, words, Held because, Sends at, with Drop only (Approve is for waiting rows); opening it shows the words through `MessagePreview` (`replyLooks`, `apps/portal/web/src/modules/marketing/conversation.tsx:527`) and the thread, where the queued line reads `queued`. It stays out of the To approve count. Any other refusal marks it `failed`
- Timeline: `conversationOf` (`packages/content/src/inbox/conversation.ts:645`) joins by person: emails, texts, DMs, comments (also by linked `social_handles`), bookings, touches, notes, asked replies; oldest first. `options` lists each channel a reply can take; `pickOption` rebuilds it on send and refuses any other target or an opted-out one. Email with no reply of theirs offers `thread:<enrollment>`: our next email in our newest thread that sent, shut while its sequence sends or once it bounced, opted out or was stopped by hand; it sends through `Disposition.followUp`. Follow-up and Nurture's email asks here (`askFollowEmail`, `send.ts`)
- Gate: `replyGate` (`send.ts:73`) says send or ask; part per channel (`partOf`): DM `reach.outreach`, comment `content.posting`, email and text `follow_up`, mail to a client's mailbox `mail.triage`, site chat `sites.chat`. Wren's own threads skip the flag; the viewer's `effect` still decides
- `InboxDesk` (`packages/content/src/restate/inbox-desk.ts:110`): reply (`effect: sends`), ask, approve, drop, suggest (`suggestReply`, `suggest.ts`; DMs via `draftDm`; a client's thread holding Google data, YouTube comments, Business Profile reviews or a Google mailbox's mail, goes only to `WREN_GOOGLE_LLM`, else `GOOGLE_HELD`), note, assign, take, status, snooze. Bound in `apps/worker/src/services.ts:1014`
- Record `marketing.inbox` (`inboxRecord`, `social/records.ts:214`): `status`, `assignee`, `snoozeUntil` columns; views Mine, Unassigned, Snoozed, All; `calls` names `thread` for each InboxDesk handler
- Portal: `conversationExtras` (`apps/portal/web/src/modules/marketing/conversation.tsx`) draws the timeline, reply box (Reply by, Send or Ask to send, Suggest, Insert snippet) and note box; row actions `INBOX_THREAD_ACTIONS` (`modules/marketing/index.ts:498`: T take, A assign, E close, Z snooze), To approve's `ASKED_REPLY_ACTIONS` (`:657`); R and N focus the boxes
- A comment thread opens with "The whole thread" before the timeline (`withThread`, `thread-context.tsx`): the post and every reply nested, Reply from Wren per node, Open on site; Wren's Inbox only, a client's has none yet (designs/2026-10-15-engage-threads.md)
- Tests: `packages/content/test/integration/inbox-reply.test.ts` over `test/inbox-seed.ts` and a fake sender; `test/inbox-preview.ts` seeds a local database

## Connected to

- **joins:** [[content/comment]], [[leads/touch]], [[email/thread-event]], [[email/call-booking]], sms contacts, reach contacts (the channels a thread reads and replies on)
- **joins:** [[content/site-chat]] (`chat:<id>`, and their chats by email)
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
- A client's DMs and comments go out on its own connected account only (`SocialInbox`). `clientRoute` (`packages/content/src/inbox/routes.ts`) shuts the rest before anything is kept: no account or a broken one points at Account → Social, LinkedIn, Reddit and TikTok say Not available yet. `InboxDesk` checks it on reply, ask and approve; `MarketingConsole.recordsGet` marks the options.
- A client's mail (`mail:<watch.mail id>`) answers through the mailbox it came to (`MailReply`, `packages/content/src/restate/mail-reply.ts`), in its thread, kept in `watch.mail_sent`. `mailRoute` (`routes.ts`) shuts a mailbox that isn't connected: "Needs setup", pointing at Account → Mail.

# Inbox: reply, notes, assign (2026-10-07)

Product audit item 6. William: "steal all the stuff." GHL Conversations is the model: one thread per
person, reply on any channel, internal comments with @mentions.

## Answer first

- **One conversation per thread.** Open any row in Waiting on you and you get the person's whole
  history: emails, texts, DMs, comments, bookings, social touches and our notes. Oldest at the top,
  newest at the bottom, a channel icon on each.
- **Reply box under it.** It sends through the thread's own path: `ReachDesk.reply` for DMs,
  `ReachDesk.answerComment` for comments, `SmsDesk.reply` for texts, `Disposition.approve` for an
  email with a call invite and the new `Disposition.reply` for one without. Every check those paths
  run still runs: opt-outs, caps, the 08:00 to 20:00 text window, `WREN_REACH_LIVE`.
- **Send or Ask to send.** `replyGate` decides first. It asks when the client's sends are off for that
  part, the client approves its own sends, or the viewer lacks `effect`. Asking writes an
  `inbox_replies` row that To approve lists as type `reply`. Approve sends it on the same path.
- **Switch channel.** The box lists every channel the person has: text them back on an email thread.
  The server rebuilds that list on send and refuses a target not on it.
- **Suggest.** `InboxDesk.suggest` drafts a reply. DMs use `draftDm`, unchanged. Other channels use
  one model call that reads the dossier brief, the touches and the thread. Nothing is saved until
  you send. Snippets come from the Library through the existing Insert snippet.
- **Notes never send.** A note sits on a thread or on a person, shows in the timeline styled apart
  from messages, and can @mention a teammate. Mentions reuse `note_mentions` and land in Inbox →
  Mentions.
- **Assign, status, snooze.** `inbox_threads` holds assignee, status (open, waiting, closed) and
  snooze. A newer inbound message reopens a thread. Views: Waiting on you (open), Mine, Unassigned,
  Snoozed, All. Keys: j/k move, r reply, n note, e close.
- **Inbound only stays true.** The Inbox lists what came in. A reply that waits for a yes goes to To
  approve, never back into the Inbox.

## Shape

| Piece | Where |
|---|---|
| `inbox_threads` (thread, assignee, status, status_at, snooze_until, by) | `packages/content/src/schema.ts` |
| `inbox_replies` (asked replies: thread, channel, target, body, state, by) | same |
| `inbox_notes` (thread or person, body, mentions, by) | `packages/notes/src/schema.ts` |
| `note_mentions.inbox_note_id`, `note_id` nullable, one of the two set | same |
| Timeline, channels, status, gate, dispatch | `packages/content/src/inbox/` |
| `InboxDesk`: reply, ask, approve, drop, suggest, note, assign, status, snooze | `packages/content/src/restate/inbox-desk.ts` |
| Conversation view, reply box, note box | `apps/portal/web/src/modules/marketing/conversation.tsx` |

## Status

| Stored | Shown |
|---|---|
| no row | new or waiting state = open; answered = waiting; read, seen, left, dropped = closed |
| a row | its status, unless a message came in after `status_at`: then open |
| `snooze_until` in the future | snoozed, until then or until they write |

A reply sent from the box sets waiting. Closing never touches the channel's own state.

## Which part gates which channel

| Channel | Client's `sends` part |
|---|---|
| DM | `reach.outreach` |
| Comment | `content.posting` |
| Email | `follow_up` |
| Text | `follow_up` |

Wren's own threads (no client) skip the sends flag. The viewer's `effect` still decides Send.

## Limits

- Bookings have no reply path of their own. A booking shows in the timeline, and the reply goes by
  email or text to the person who booked.
- An email reply needs an email they sent us: we answer in that thread. We never start a new one
  from the Inbox.
- Activity rows (follows, likes) have no reply.
- A person is the join. Rows with no person still show their own thread, without other channels.

## Decisions

- Notes live beside notes, not in the Inbox tables, so mentions stay one table and one list.
- One handler per verb, not one with a mode: `reply` declares `effect: "sends"` so the console's
  confirm and permission check apply. `ask` has no effect and sends nothing.
- No auto-send on approve for a client whose approver is `client`: the client approves in their own
  To approve. Wren's team sees it but its Approve is refused by `mayApprove`.

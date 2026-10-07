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
  Snoozed, All. Keys: j/k move, r reply, n note, e close, t take it, a assign, z snooze.
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
| `InboxDesk`: reply, ask, approve, drop, suggest, note, assign, take, status, snooze | `packages/content/src/restate/inbox-desk.ts` |
| Conversation view, reply box, note box | `apps/portal/web/src/modules/marketing/conversation.tsx` |
| Row actions (take, assign, close, snooze), To approve's Approve and Drop | `apps/portal/web/src/modules/marketing/index.ts`, `records.tsx` |
| Synthetic threads: tests and a local preview | `packages/content/test/inbox-seed.ts`, `inbox-preview.ts` |

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
- A client's DMs and comments can't send yet: their desks are Wren's only. Text and email can.
- The local preview has no Restate: the conversation and notes show, but Send, Suggest and the
  row actions need the worker.

## Client workspaces

A client's login works its own threads in Marketing -> Inbox, on its own database.

- Calls go through `MarketingConsole` `inbox*` routes. Each pins the client the guard opened
  (`pickForWrite`, `marketing.stats` installed), then calls `InboxDesk` with it.
- `InboxDesk` checks the viewer on the thread's channel: `act` to note, assign, close, snooze or
  ask; `effect` plus the client's approver to send. Scoped grants (app `marketing`, channel `sms`,
  `email` or the platform) narrow both. No `effect` is Ask to send.
- Its asked replies wait in Marketing -> To approve (`marketing.asked_reply`).
- Suggest signs as the client, without Wren's facts, on the client's own `models` gate.
- `@` and assign reach the client's people and Wren's team scoped to it. A client's Mentions in
  Notes lists its Inbox mentions.
- Wren's own threads stay team-only: a client login on `InboxDesk` with no client is refused.

## Decisions

- The reply box replaces the per-type draft boxes (DM reply, comment answer, email approve) in the
  Inbox. It starts from the row's held draft. Suggest replaces Ask Claude there.
- Notes live beside notes, not in the Inbox tables, so mentions stay one table and one list.
- One handler per verb, not one with a mode: `reply` declares `effect: "sends"` so the console's
  confirm and permission check apply. `ask` has no effect and sends nothing.
- No auto-send on approve for a client whose approver is `client`: the client approves in their own
  To approve. Wren's team sees it but its Approve is refused by `mayApprove`.

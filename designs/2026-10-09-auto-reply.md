# Auto-reply modes

2026-10-09. Gaps item 9 (`2026-10-09-gaps.md`; audit: GHL Conversation AI, Intercom Fin). Each
client picks, per channel, what happens when someone writes in: nothing, a drafted reply waiting
for a yes, or a reply sent.

## Today

Every inbound message lands in the Inbox. Suggest (`InboxDesk.suggest`) drafts a reply only
when someone opens the thread and presses it. Nothing drafts ahead, so a reply waits on a person
twice: to write it, then to approve it.

## Modes

| Mode | On an inbound message |
|---|---|
| Off | Nothing. Today's behaviour. |
| Suggest (default) | A draft is written at once and waits in To approve as an asked reply (`inbox_replies`, `asked_by` = `auto`). The thread's reply box opens with it. |
| Auto | The draft goes out on the thread's own path if every check below passes; otherwise it falls back to Suggest and says why. |

Per client and channel: `text`, `email`, `dm`, `comment`. Wren's own threads have the same
setting, at Wren.

**Auto is held.** A global `WREN_AUTO_REPLY_LIVE` (unset, off) makes every Auto act as Suggest
until William says go, as publishing is on hold. The setting can still be picked; the page says
it's held.

## Data (one migration, main)

`auto_replies`: `owner` (client, null is Wren; FK clients, cascade), `channel`, `mode` (off,
suggest, auto), `updated_*`. Primary key (owner, channel), nulls not distinct. No row is Suggest.

The draft itself is an `inbox_replies` row (waiting), so To approve, Approve, Drop and the audit
need nothing new. `why` says "Drafted on arrival" or why Auto didn't send.

## Flow

1. Each channel already fires `replyFired(client, channel, id)` at the spine. `Spine.fire` for
   `trigger.reply` also sends `AutoReply.inbound {client, channel, thread}` (send-only, keyed by
   thread so two messages in a row draft once).
2. `AutoReply.inbound` reads the mode. Off: done. Otherwise it waits 60 s (a burst of messages
   reads as one), then drafts with the same `suggestReply` the box uses: dossier brief, touches,
   the thread, the client's facts (`{biz.*}` included), signed as the client.
3. It skips, writing nothing, when: the thread already has a waiting reply; we answered after their
   last message; their last message is an opt-out (STOP and the channel's own words); or the
   person is opted out on that channel.
4. Suggest: writes the `inbox_replies` row.
5. Auto: sends only if all hold, else Suggest with the reason in `why`:
   - `WREN_AUTO_REPLY_LIVE` is on;
   - `replyGate` says send for a system sender (the client's `sends` part is on; the approver rule
     is waived only by Auto, which the client's admin set);
   - the model's check says it may: one extra call returns `{send: boolean, why}` and refuses
     anything about price, money owed, complaints, legal or health, a question the facts don't
     answer, or a person asking for a human;
   - at most 3 auto replies per thread per day, 1 per inbound message;
   - the channel's own rules: the 08:00 to 20:00 text window, Meta's 24 hours, caps.
   The send goes through the same dispatch as Send in the box and writes its touch.

## Portal

- **Marketing → Inbox → Auto-reply** (settings tab): one row per channel with Off, Suggest,
  Auto. `manage` to change. Auto shows "Held: nothing sends on its own yet" while the flag is off.
- To approve marks a drafted-on-arrival reply "Drafted for you".
- The thread shows an auto-sent reply with a small "Auto" tag; Undo isn't possible, so none is
  offered.

## Not in this round

- Per-person or per-thread overrides.
- Learning from edits (Approve after an edit as a few-shot): later, with the comments feed's
  approvals.
- Voice and missed-call text-back: they have their own flows.

## Decision log

- 2026-10-09: my calls (William: build it all, ask nothing). Drafts reuse `inbox_replies` and
  `suggestReply`, so there is one draft path and one approval queue. Auto has a second model check
  and a global hold rather than trusting the draft call alone.

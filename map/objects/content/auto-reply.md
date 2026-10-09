---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-09 @ e53ab9fd
entity: packages/content/src/schema.ts:860
---

# auto-reply

Per channel, what happens when someone writes in (designs/2026-10-09-auto-reply.md): Off, Suggest (default) or Auto. Table `auto_replies`, migration 0217. Marketing > Auto-reply.

## Why this shape

A draft on arrival is an `inbox_replies` row (`asked_by` = `auto`), so To approve, Approve, Drop and the audit need nothing new. One draft path (`suggestReply`) for the box and for arrival.

## Shape

- `auto_replies`: `channel` primary key (email, text, dm, comment), `mode`, `updated_by`, `updated_at`. In the database that holds the threads: main for Wren, a client's own for a client. No row is Suggest.
- `autoReplyFire` rides the spine's `fire` in the Worker (`fireAll`): a `trigger.reply` also sends `AutoReply/<client|wren>/<channel>:<id>/arrived`. Email, text and DM today; comments have no reply trigger yet.
- `AutoReply.arrived`: mode Off stops; else waits 60 s, maps the thread (`threadOfReply`), checks `draftable` (no waiting reply, their message last, no opt-out word, the own option open), drafts (a client's metered and gated on `models`, signed with its name), checks again and asks.
- **Auto is held**: it drafts like Suggest with why "Auto is held". The send path and the model's send check come with William's go.
- Settings: `InboxDesk.autoReplies` / `autoReplySet` (`manage` to change); a client's through `MarketingConsole.inboxAuto` / `inboxAutoSet`.

Citations: `packages/content/src/inbox/auto.ts:1`, `packages/content/src/restate/auto-reply.ts:1`, `packages/content/src/restate/inbox-desk.ts:1`, `apps/portal/web/src/modules/marketing/auto-reply.tsx:1`

## Connected to

- **owns:** `auto_replies`
- **owned-by:** [[content/inbox-thread]]
- **joins:** `inbox_replies` by `thread`
- **looks-like-but-is-not:** Suggest in the reply box (on demand); workflow follow-ups (the spine's cadences)

## If you change this

- **Hits:** To approve (more waiting replies), model spend per inbound message, the Worker's spine `fire` for every reply emitter.
- **Does not hit:** what sends; nothing sends on its own while Auto is held.

## Surfaces

| Surface | Role |
|---|---|
| Marketing > Auto-reply (`auto-reply.tsx`) | mode per channel, Held on Auto |
| To approve | drafts on arrival wait here |

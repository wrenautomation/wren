---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-09
entity: packages/content/src/schema.ts:856
---

# site chat

A chat bubble on a client's (or Wren's) website; each visitor's thread is an Inbox thread `chat:<id>` (designs/2026-10-09-site-chat.md). Tables `chat_threads`, `chat_messages`, migration 0220.

## Why this shape

One tag, served from the owner's own host, so the Worker names the owner without a site id or a token. The visitor holds a random key; only its sha256 is kept. The bubble polls; no socket, no new infra.

## Shape

- `chat_threads`: `key_hash` unique, name, email, phone, page, `last_in_at`, `read_at`. `chat_messages`: thread, direction in|out, body, `by`, at.
- Store `packages/content/src/chat/store.ts`: `say` (no key starts a thread, 200 a day per owner; 30 messages an hour per thread; 2000 chars), `readChat`, `replyChat` (marks read).
- `Chat` service (`packages/content/src/restate/chat.ts`): `say`, `read`; a refusal comes back as `{status, error}`. Bound in `apps/worker/src/services.ts`.
- Edge: `chatRoute` in `apps/portal/src/sites.ts`: `/o/__chat.js` (the bubble, `@wren/sites/chat-widget`), `/o/__chat` POST; bots refused, open CORS.
- Inbox: `chatRows` in `inboxRecord`, view Site chat; `partyOf` joins their other chats by email and a texting contact by phone; reply `ReplySender.chat`, part `sites.chat`.

Citations: `packages/content/src/chat/store.ts:1`, `packages/content/src/restate/chat.ts:1`, `apps/portal/src/sites.ts:133`, `packages/sites/src/chat-widget.ts:1`

## Connected to

- **owns:** `chat_threads`, `chat_messages`
- **owned-by:** [[content/inbox-thread]]
- **joins:** sms contacts by phone, other chats by email
- **looks-like-but-is-not:** forms (Sites forms keep a submission, no thread)

## If you change this

- **Hits:** the Inbox list and timeline, the portal Worker's `/o/` paths, Account → Domain.
- **Does not hit:** the spine: a chat fires no trigger yet, so auto-reply and workflows don't hear it.

## Surfaces

| Surface | Role |
|---|---|
| the bubble on a site | writes, reads its own thread |
| Marketing → Inbox, Site chat | reads, replies |
| Account → Domain | shows the tag |

## See

- Source: `packages/content/src/chat/store.ts`

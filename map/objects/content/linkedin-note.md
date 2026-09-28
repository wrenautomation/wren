---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-linkedin/src/schema.ts:23
---

# linkedin-note

A raw note dropped as `<stem>.md` plus images into the inbox folder, ingested into `notes`. Live, but its consumer (the old post pipeline) is leftover.

## Why this shape

`readInbox` is pure over the filesystem and `ingestNotes` takes injected I/O so the `LinkedinInbox` object can journal each step; one key means one writer, replacing the Python advisory lock (`inbox.ts:1`, `restate/inbox.ts:210`).

## Shape

- `body`, `image_paths`, `source` (inbox | cli), `status` (new | used | archived), `used_by_post_id` (`schema.ts:27`–`31`)
- `addNote`, `listNotes` (`notes.ts:8`, `:21`)

Citations: `packages/channel-linkedin/src/schema.ts:23`

## Connected to

- **joins:** leftover `posts` via `used_by_post_id` ([[content/linkedin-legacy]])
- **looks-like-but-is-not:** [[content/idea]] (the live input to drafting)

## If you change this

- **Hits:** `inbox.ts:36`, `:94`; `restate/inbox.ts`; `wren notes`; `wren status`
- **Does not hit:** the content loop; nothing in `packages/content` reads notes

## Surfaces

| Surface | Role |
|---|---|
| `wren notes ingest/add` → `LinkedinInbox/default` | writes |
| `wren notes ls`, `wren status` | read |

## See

- Source: `packages/channel-linkedin/src/inbox.ts`

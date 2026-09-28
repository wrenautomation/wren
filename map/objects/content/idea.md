---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/content/src/schema.ts:38
---

# idea

One thing William wants to say, in his words, with optional media. Table `content_ideas`. The loop's only input.

## Why this shape

Nothing is ever drafted from nothing: blank text is refused (`ideas.ts:23`). `source` records who added it (cli | api | ads), so an idea AdsWatch minted from a winning ad is visible as such and still waits for a person to draft it (`packages/channel-meta/src/bridge.ts:1`).

## Shape

- `text`, `media`, `source`, `status` (open | drafted | archived) (`schema.ts:42`–`46`)

Citations: `packages/content/src/schema.ts:38`, `packages/content/src/ideas.ts:24`

## Connected to

- **owns:** [[content/draft]] (`idea_id`, cascade)
- **looks-like-but-is-not:** a LinkedIn [[content/linkedin-note]]; leftover `post_ideas`

## If you change this

- **Hits:** `ideas.ts`, `draft.ts:186`, `ContentDesk.add/draft`, `wren content add`, the planner's "ideas to draft" count (`plan.ts`)
- **Does not hit:** published drafts

## Surfaces

| Surface | Role |
|---|---|
| `wren content add` | writes |
| `AdsWatch` (source ads) | writes |
| `ContentDesk.draft` | reads, sets drafted |

## See

- Source: `packages/content/src/ideas.ts`

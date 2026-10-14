---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-13 @ deefd131
entity: packages/content/src/pieces.ts
---

# piece

One thing William made (a long video, a clip, a post, a story, a blog post) with every place it went hanging under it. A long video carries its clips and promo posts. Read only; nothing is stored.

## Why this shape

He works in pieces, not platform rows: one vertical clip is Shorts, a Reel and a TikTok (designs/2026-10-13-primitives-first.md). Lineage is what the rows already say, so no migration: an idea's `ref` (`video:<id>` long, `video:<id>/short:<n>` or `/vertical` clip, any other `video:<id>/<k>` such as a post about it `post:<k>` nests too, its kind from its formats), a promo draft's `video_draft`, `video_edits` for a recording with no idea yet (editor branch `editing`, or `review` once rendered) and its proposed `shorts` with no `video:<id>/short:<n>` idea yet (a child `vertical` piece, editor branch `editing`), and `blog_posts` (nested under a video by `from_ref`). A long piece carries `video` (its `video_edits.id`). A draft's status is its branch's state (published live, approved queued, failed, else draft); rejected drafts and rejected recordings are left out. `waitingOf` counts `review`, but Approve all sends only non-editor drafts; a `review` piece shows a Review link to Studio (designs/2026-10-14-content-types.md).

## Shape

- `Piece {id, kind, title, text, at, branches, children}`, `Branch {id, platform, format, state, at, url, views, engaged, error}`
- `piecesOf` (pure), `pieceRows` (last 120 days), `waitingOf` (`packages/content/src/pieces.ts`)
- `Pieces/wren` `list` (`packages/content/src/restate/pieces.ts`)

Citations: `packages/content/src/pieces.ts:1`, `packages/content/src/restate/pieces.ts:1`

## Connected to

- **reads:** [[content/idea]], [[content/draft]], [[content/content-metric]], [[content/video-edit]], [[content/blog-post]]
- **looks-like-but-is-not:** [[content/draft]] (one platform's copy; a piece is all of them)

## If you change this

- **Hits:** Marketing Today, Pieces, and home Today read it; a new `ref` shape needs a branch in `piecesOf`
- **Does not hit:** the scheduler, approvals (a yes still goes through `marketing/approveDraft`)

## Surfaces

| Surface | Role |
|---|---|
| Marketing → Pieces (`apps/portal/web/src/modules/marketing/pieces.tsx`) | reads, approves; finds by words, what (`WHATS`: a carousel or thread by its branch format, inside a long video too), where, state, sort; picks live in the address; built-in views (`PIECE_VIEWS`, `piece-views.ts`: Everything, Waiting on you, Scheduled, Carousels, Long videos (id `videos`), Clips, Written posts, Posted, Best: live by views) set what, state and sort in one press and light when the picks match; Scheduled sorts by the soonest queued branch (`nextOut`); every view and kind, place and state chip has a hover (`sayPieceView`, `sayPieceWhat`, `sayPieceShow`; a view's `hint` wins) |
| Marketing → Today (`apps/portal/web/src/modules/marketing/plan.tsx`) | reads, approves |
| Marketing sidebar (`MAIN`, `index.ts`) | Today, Write, Studio, Engage, Pieces, Numbers, More: type and platform are filters on Pieces, not pages (designs/2026-10-14-content-types.md); the by-platform day page (`TODAY`) is hidden |
| Home Today (`apps/portal/web/src/today.tsx`) | reads, approves |

## See

- Source: `packages/content/src/pieces.ts`
- Test: `packages/content/src/pieces.test.ts`

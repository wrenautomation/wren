---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-07 @ 4e8e9e3d
entity: packages/core/src/touches-schema.ts:97
---

# touch

One social touch with a person, ours or theirs: a follow, invite, comment, reply, DM, like or mention, with what they did back. Tables `touches` and `social_handles` (one person on one platform).

## Why this shape

Each touch already lives in its source table (`reach_messages`, `comments`, `reddit_threads`, `linkedin_posts`, `social_activity`), keyed by a handle and rarely by a person. A touch is the per-person line over them, keyed by its source row (`ref`: `rm:`, `c:`, `ca:`, `rt:`, `lp:`, `sa:`), so a live writer and the backfill never double it. Core owns it so compose and the call brief read it without importing outreach (designs/2026-10-07-touches.md).

## Shape

- `social_handles`: `platform`, `handle` (normalized), `url`, `name`, `person_id`, `lead_id`, `linked_by`; unique (platform, handle) (`packages/core/src/touches-schema.ts:61`)
- `touches`: `handle_id`, `kind`, `direction`, `account`, `url`, `text`, `at`, `response`, `response_at`, `answers` (self), `external_id`, `source`, `ref` unique (`:97`)
- `person_touch_lines` view: the People Touches tab, keyed `li:<people.id>` and `<platform>:<handle>` (`:152`)
- `normalizeHandle` (`packages/core/src/touches.ts:152`), `resolveHandle` (`:303`), `recordTouch` (`:408`), `respond` (`:472`), `touchesFor` (`:563`), `touchesContext` (`:740`), `touchFacts` (`:796`)
- writers per source: `packages/outreach/src/touches.ts`, `packages/content/src/touches.ts`

Citations: `packages/core/src/touches-schema.ts:97`, `packages/core/src/touches.ts:408`

## Connected to

- **owned-by:** [[leads/person]] (`social_handles.person_id`), [[leads/lead]] (`social_handles.lead_id`)
- **joins:** [[content/comment]], [[content/linkedin-invite]], [[content/linkedin-post]], [[content/reddit-thread]], `social_activity`
- **looks-like-but-is-not:** `draft_events` (the training record, keyed per draft, not per person); `lead_channels` (active sequences, not history)

## If you change this

- **Hits:** the writers in `recordSent`, `receive`, `markAccepted`, `applyWithdraw`, `keepComments`, `markAnswered`, `markCommented`, `markPostCommented`, `keepPostComments`, `keepActivity`; DM prompt (`packages/outreach/src/drafts.ts` `dmContext`); compose `touch.*` facts (`packages/channel-email/src/outreach/facts.ts`); the call brief (`packages/channel-email/src/calls/brief.ts`); `wren dossier` (`packages/channel-email/src/dossier.ts`); Marketing → People (`packages/outreach/src/records.ts` `personRecord`)
- **Does not hit:** the source tables (a touch only reads them); email `messages` (email touches are not social)

## Surfaces

| Surface | Role |
|---|---|
| outreach and content writers | writes |
| `wren touches backfill` | writes |
| `wren touches link` | writes (links a handle) |
| `wren touches <who>` | reads |
| DM drafter, compose, call brief, dossier | reads |
| Marketing → People, Touches tab | reads |

## See

- Source: `packages/core/src/touches.ts`
- Design: `designs/2026-10-07-touches.md`

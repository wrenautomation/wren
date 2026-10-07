---
type: object
cluster: content
universe: live
status: stub
verified:
entity: packages/content/src/funnel.ts
---

# funnel (stage, target and link on every post; promo; comment examples)

The content system's default bias (William, 2026-10-07): YouTube long-form is the top asset, and every other post feeds it or is cut from it. The path is video → site → booking. Every draft says which stage it serves and where it points; the link it carries is derived from that.

## Why this shape

One long recording feeds every platform, so the overlaps are one capability each with per-platform adapters, never a feature per platform:

| Capability | Platforms | Where it lives |
|---|---|---|
| short-form vertical: one asset | YouTube Shorts, IG Reels, TikTok | [[content/video-edit]] (Approve writes the Short and the Reel draft) |
| written posts: one idea, rewritten per platform | Reddit (organic), LinkedIn (hook, short lines), X (dense) | [[content/draft]], [[content/playbook]] |
| promo: a written post plus a link to the video | LinkedIn, X, Reddit (where links are allowed), IG | `packages/content/src/promo.ts` |
| comments: high value, each approved, decisions become examples | Reddit, LinkedIn, X, IG | [[content/comment]], [[content/reddit-thread]], [[content/draft-event]] |
| follows and connects within limits (not Reddit) | LinkedIn, X, IG | [[content/linkedin-invite]] |

Places (subreddits) come from research ([[content/reddit-thread]]), never hard-coded. Attribution goes through the lander's `/go/<channel>/<campaign>/<content>`.

## Shape

- Stage `reach | trust | convert`, target `video | site | booking`, the video it points at, whether it carries its link: columns on `content_drafts` (see [[content/draft]])
- Link derivation and the per-platform link rule: `packages/content/src/funnel.ts`
- Promo drafts: `packages/content/src/promo.ts`
- Comment examples from `draft_events`: `packages/outreach/src/examples.ts` (`commentExamples`, `examplesFor`)
- Video page Promos section: `apps/portal/web/src/modules/marketing/videos.tsx`; editor group: `apps/portal/web/src/modules/marketing/funnel.tsx`

Citations: `designs/2026-10-07-content-funnel.md`

## Connected to

- **joins:** [[content/draft]] (the columns), [[content/video-edit]] (the video a promo points at), [[content/comment]], [[content/reddit-thread]], [[content/linkedin-invite]], [[content/draft-event]] (examples read it)
- **looks-like-but-is-not:** `marketing.funnel` (the lander's visit funnel, Marketing → Site)

## If you change this

- **Hits:** the scheduler's link (`restate/scheduler.ts`), approve's refusal (`review.ts`), the editor (`apps/portal/web/src/modules/marketing/fields.tsx`), the lander's `/go/` channels (`lander/src/data/links.json`)
- **Does not hit:** a video's footer templates (they carry their own links)

## Surfaces

| Surface | Role |
|---|---|
| the post editor's Funnel group, `wren content funnel` | writes stage, target, video, link |
| Videos → Promote, Posts → Promote, `wren content promote` | writes promo drafts |
| comment drafting (`sortComment`, `draftThread`, LinkedIn posts), `wren drafts examples` | reads examples |

## See

- Design: `designs/2026-10-07-content-funnel.md` (model, gap table, build order)

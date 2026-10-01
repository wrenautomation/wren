---
type: object
cluster: reactivation
universe: live
status: verified
verified: 2026-10-01 @ d4f7f09
entity: packages/reactivation/src/video/lead.ts:32
---

# demo video

One firm's walk through the portal demo, with its own name in it, on its own watch page. Stored as an [[research/enrichment]] of kind `video`; the product word is "video variant".

## Why this shape

The name swap happens in the recording browser (`swapName`, `packages/reactivation/src/video/walk.ts:71`), so the demo database is never written. A video is an enrichment so the run ledger, resume and the dossier come free: model = walk name, prompt version = walk version (`WALK`, `walk.ts:17`), and a new version re-renders every firm. `@wren/video` records and encodes any page and knows no leads; the walk is the product's.

## Shape

- Enrichment `output`: `id`, `url` (watch page), `mp4`, `poster`, `seconds`, `firm` (`lead.ts:61`)
- CDN files `v/<id>.mp4`, `.jpg`, `.json` (JSON last) (`packages/video/src/publish.ts:32`); bucket and CloudFront in `deploy/terraform/videos.tf`
- `recruiting_facts.video_url`: the newest render with a url (`packages/core/src/views.ts:90`)

Citations: `packages/reactivation/src/video/lead.ts:32`, `packages/research/src/schema.ts:34`

## Connected to

- **owned-by:** [[leads/company]], [[ledger/run]]
- **owns:** the S3 objects under `v/<id>`
- **joins:** `recruiting_facts` (lateral, newest `video` row with a url)
- **looks-like-but-is-not:** a content video ([[content/platform]] posts to channels; this is per lead, unlisted)

## If you change this

- **Hits:** the lander watch page `../lander/functions/v/[id].ts` reads `<VIDEOS_ORIGIN>/v/<id>.json` (`firm`, `mp4`, `poster`; media must sit under the same id); `WREN_VIDEOS_WATCH_BASE` must match the lander route; the walk clicks portal links by role and text, so a portal rename fails every render
- **Does not hit:** `wren_client_demo` (read only, through the demo site)

## Surfaces

| Surface | Role |
|---|---|
| `wren video render <company> \| --niche <n> --limit <k>` | write (records, publishes, stores) |
| `wren video try <firm>` | local mp4 only |
| `wren video show <company>` | read |
| lander `/v/<id>` | read (CDN JSON) |

## See

- Source: `packages/reactivation/src/video/`, `packages/video/src/`, `apps/cli/src/video.ts`
- Design: `designs/2026-09-30-research-and-enrichment.md` (Video variants)

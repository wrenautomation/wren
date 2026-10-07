---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/core/src/content/index.ts:12
---

# platform

One of seven places a post can go, and the adapter that speaks its API: `Platform` union, `ContentChannel` contract, `PLATFORM_SPECS` limits. Optional reads: `activity(q?)` (follows, mentions, notices, newest first; `at` may be null) and `audience()` (follower count).

## Why this shape

Every adapter speaks the platform's own REST shape through autobrowse's `sites` Restate service, so a call is journaled and whether the API or a browser answered is the box's business (`packages/core/src/content/restate.ts:1`). Reddit is the exception: Reddit refused Wren an API client (2026-09-29), so it goes to autobrowse's `desk` service on the Mac (a home IP; `DESK` in `packages/core/src/content/restate.ts`, never woken), or straight to its API with wren's own token when `WREN_REDDIT_*` is set (`packages/channel-reddit/src/api.ts:1`). Limits are data (`PLATFORM_SPECS`: maxChars, needsMedia), so a draft is fit-checked before any paid call. Every field past text and file is the platform's post shape (`SHAPES`, `packages/core/src/content/shapes.ts`, designs/2026-10-07-post-shapes.md): a zod schema plus each field's UI and status (`sent`, `dev` = "In development", `none` = no API). `Content.publish` parses it before the adapter (a bad field is a 400); adapters read it typed with `fieldsOf`. Post-upload steps (YouTube thumbnail, captions, playlist) never fail the post: they come back as `Published.notes`. An X thread (`kind` thread) posts as a reply chain; a reply that fails leaves the posted ones up and says which remain in `notes`. LinkedIn `document` and Instagram `carousel` are kinds with slides ([[content/funnel]]); their upload is "In development".

## Shape

- `Platform` = linkedin | youtube | x | instagram | facebook | tiktok | reddit (`index.ts:12`); `ContentChannel` (`:122`); `SiteClient` (`autobrowse.ts:14`); `MediaHost` (`index.ts:44`)
- `SHAPES`, `fieldsOf`, `patchFields`, `missingFields`, `fieldViews` (`packages/core/src/content/shapes.ts`)
- `PLATFORM_SPECS` (`packages/content/src/platforms.ts:23`); default slots (`packages/content/src/slots.ts`)
- adapters: `packages/channel-{linkedin,youtube,x,tiktok,meta,reddit}/src/content.ts`; Instagram via the box composer `channel-meta/src/content-web.ts`
- wired per settings in `apps/worker/src/services.ts` (`contentFor`)

Citations: `packages/core/src/content/index.ts:12`, `:122`

## Connected to

- **owns:** the `platform` column on [[content/draft]]
- **joins:** [[content/media]] (URL-only platforms host first), [[platform/settings]] (`WREN_CONTENT_CHANNELS`)
- **looks-like-but-is-not:** the Meta ads adapter (`channel-meta/src/ads.ts`, same site, different job)
- **joins:** [[content/funnel]] (which platforms carry a link, per platform)

## If you change this

- **Hits:** adding a platform touches the union, `PLATFORM_SPECS`, `SHAPES`, slots, `ck_content_drafts_platform` (a migration), a new `channel-*` package, and `services.ts`
- **Does not hit:** ideas; the review seat

## Surfaces

| Surface | Role |
|---|---|
| `Content` service (publish, list, metrics, comments, reply, activity, audience; the last two null when the adapter lacks them, an `audience` failure terminal) | calls |
| `SocialWatch/wren` (`packages/content/src/restate/social.ts`) | reads comments, activity, audience into `comments`, `social_activity`, `social_days`; never the audience of `AUDIENCE_ON_DEMAND` (LinkedIn: autobrowse `GET /audience` as `linkedin@wren`), read only by `SocialDesk.readAudience` (`wren social audience linkedin`, Followers → Read now), which replaces the day's row |
| `TokenRenewal/box` | keeps their tokens alive |

## See

- Source: `packages/core/src/content/index.ts`

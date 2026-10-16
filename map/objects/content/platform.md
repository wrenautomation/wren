---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd (+ fetch budget)
entity: packages/core/src/content/index.ts:12
---

# platform

One of nine places a post can go, and the adapter that speaks its API: `Platform` union, `ContentChannel` contract, `PLATFORM_SPECS` limits. Optional reads: `activity(q?)` (follows, mentions, notices, newest first; `at` may be null) and `audience()` (follower count; X `users/me`, TikTok `user/info`, both daily). Two optional batch reads save calls (designs/2026-10-15-fetch-budget.md): `metricsMany(posts)` (several posts' numbers in as few platform reads as it can: X one timeline page, YouTube 50 ids a call, TikTok 20, Reddit 100, Facebook the Page's `/posts` listing, Instagram the full metric list once) and `commentCounts(ids)` (every post's comment count in one read; the `SocialWatch` probe). A post either leaves out is read with `metrics` or `comments`. `findReply(q)` reads our own reply back after its send's outcome was lost, where `comments` can't mark ours (X: a search of our own posts; designs/2026-10-16-maybe-sent.md). `findPrivateReply(q)` reads our private reply to a comment back from the Page's inbox (Facebook and Instagram: autobrowse `meta GET /{pageId}/conversations` on the Page token). Instagram's `Metrics.read` carries its full metric answer to `insights`.

## Why this shape

Every adapter speaks the platform's own REST shape through autobrowse's `sites` Restate service, so a call is journaled and whether the API or a browser answered is the box's business (`packages/core/src/content/restate.ts:1`). Calls waiting on a review or product (LinkedIn Community Management, Meta messaging and `pages_manage_engagement`, X paid replies) are already written in the API's shape: autobrowse runs them on the page until the grant lands, then on the API, with no change here (autobrowse `site-facade` grants, 2026-10-13). So a Facebook comment reply names its Page (`pageId`), which the API leg needs for the Page's token. With `WREN_META_PAGE_ID` and `WREN_META_IG_ID` set, the Graph channels know their Page and Instagram account and never read `me/accounts` (without them they read it once per invocation; a client's connected account answers it locally). Reddit is the exception: Reddit refused Wren an API client (2026-09-29), so it goes to autobrowse's `desk` service on the Mac (a home IP; `DESK` in `packages/core/src/content/restate.ts`, never woken), or straight to its API with wren's own token when `WREN_REDDIT_*` is set (`packages/channel-reddit/src/api.ts:1`). Limits are data (`PLATFORM_SPECS`: maxChars, needsMedia), so a draft is fit-checked before any paid call. X's single-post cap follows Wren's account fact `WREN_X_SUBSCRIPTION` through `xPostMax` (`packages/core/src/content/thread.ts`): Premium since 2026-10-07, so 25,000; a thread's posts and X comments stay at 280. Every field past text and file is the platform's post shape (`SHAPES`, `packages/core/src/content/shapes.ts`, designs/2026-10-07-post-shapes.md): a zod schema plus each field's UI and status (`sent`, `dev` = "In development", `none` = no API). `Content.publish` parses it before the adapter (a bad field is a 400); adapters read it typed with `fieldsOf`. Post-upload steps (YouTube thumbnail, captions, playlist) never fail the post: they come back as `Published.notes`. An X thread (`kind` thread) posts as a reply chain; a reply that fails leaves the posted ones up and says which remain in `notes`. LinkedIn `document` and Instagram `carousel` are kinds with slides ([[content/funnel]]); their upload is "In development". A YouTube community post (`kind` community) has no API: words on Write become one (`PLATFORM_SPECS.youtube.words`, `write.ts` `ownDraftOf`), the adapter posts it through autobrowse's browser route `/studio/communityPosts` with its one image, and it counts as format `post` on Plan; no metrics are read for it (`metricsDue`). An Instagram or Facebook story (`kind` story) is media only: Write's Story box (`packages/content/src/story.ts`, ContentDesk `story`) stores a photo or reuses a Reel's clip, the Graph API posts it (IG `media_type` STORIES; Page `photo_stories`/`video_stories` through autobrowse `meta`), it counts as format `story`, and no metrics are read for it. Threads (`channel-meta/src/threads.ts`) posts through autobrowse's `threads` site with the profile's own 60-day token: a container (TEXT with an optional link card, or IMAGE/VIDEO by hosted URL), a poll until a video is FINISHED (10, 15, 20, then 30 s apart, 12 reads at most; Instagram's Reel container waits the same way, `channel-meta/src/poll.ts`), then publish; replies under a post are its comments. Its token has no refresh: consent again in autobrowse when it lapses.

## Shape

- `Platform` = linkedin | youtube | x | instagram | threads | facebook | tiktok | reddit | google_business (`index.ts:12`); `ContentChannel` (`:122`); `SiteClient` (`autobrowse.ts:14`); `MediaHost` (`index.ts:44`)
- `SHAPES`, `fieldsOf`, `patchFields`, `missingFields`, `fieldViews` (`packages/core/src/content/shapes.ts`)
- `PLATFORM_SPECS` (`packages/content/src/platforms.ts:23`); default slots (`packages/content/src/slots.ts`)
- adapters: `packages/channel-{linkedin,youtube,x,tiktok,meta,reddit}/src/content.ts`; Instagram via the box composer `channel-meta/src/content-web.ts`; Wren's own TikTok posts via the box's Studio flow (`/web/posts`) while `WREN_TIKTOK_POST_VIA=web` (default, until the app is audited), reads stay API; Threads `channel-meta/src/threads.ts`
- wired per settings in `apps/worker/src/services.ts` (`contentFor`)
- A failed write's words come from autobrowse: `not sent: …` (never left) or `…; may have gone through` (`sentState`, `packages/core/src/content/autobrowse.ts`); `restateSites` keeps them and appends "may have gone through" only to untagged words (an older desk). 503 + `not sent: profile … is busy` is `browserBusy`: the desk's browser was held past its 5 min wait; callers try again (autobrowse designs/2026-10-15-profile-wait.md)

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
| `Content` service (publish, update, list, metrics, metricsMany, commentCounts, comments, reply, findReply and findPrivateReply (unclear when the adapter lacks it or the read fails), activity, audience; the two batch reads answer null when the adapter lacks them and any failure in them is terminal, so the caller reads one by one; `update` changes a live post's title, hook or thumbnail, YouTube only, 501 elsewhere; the last two null when the adapter lacks them, an `audience` failure terminal) | calls |
| `SocialWatch/wren` (`packages/content/src/restate/social.ts`) | counts comments once per platform per pass and reads the posts whose count moved (see [[content/comment]]), reads comments, activity, audience into `comments`, `social_activity`, `social_days`; never the audience of `AUDIENCE_ON_DEMAND` (LinkedIn: autobrowse `GET /audience` as `linkedin@wren`), read only by `SocialDesk.readAudience` (`wren social audience linkedin`, Followers → Read now), which replaces the day's row |
| `TokenRenewal/box` | keeps their tokens alive: daily `sites/renew` probes each, makes again refused and lapsing ones (autobrowse card `token`) |

## See

- Source: `packages/core/src/content/index.ts`

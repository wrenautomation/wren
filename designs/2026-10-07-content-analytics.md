# Content analytics: every number a post earns, per platform (2026-10-07)

William, 2026-10-07: "make sure all the analytics ... related to posting organic content,
analyzing and iterating, like youtube ctr and retention rate, same with insta, whatever etc. as
well as comment reply rate, go to dms rate, etc. all the intuitive things we ought to track is
built out at some point." Then: "probably should be baked into existing content outreach
dashboards". No new Analytics page: each number sits where he already looks.

## Answer first

- **Collected now:** every post's daily numbers from each platform's current token, kept per day
  in `post_metric_days` (never overwritten across days), plus account days in
  `account_metric_days`. Every metric the token can't read is kept as a gap in
  `metric_sources` with its reason and the one step that fixes it.
- **Behind a scope:** YouTube Analytics (retention, average view, traffic sources, search terms,
  subscribers per video) is written and tested against a fake. It runs the day the box serves
  the route and the token holds `yt-analytics.readonly`. Until then each of those numbers says
  "Needs scope: YouTube Analytics" where it would sit.
- **Derived in code:** comment reply rate, time to reply, comment to DM, DMs answered, DM to
  booking, post to site, and site to form, booking and won per post with revenue by first and
  last touch (`link_days`, rolled up from the lander's export by the pass that already reads it).
- **Where it shows:** Marketing → Posts (columns, a Leaderboard view, and each post's page with
  sparklines, the retention curve, traffic sources, search terms, its site funnel and its
  conversation), Marketing → Overview (a site visitors tile, cadence against goals, what
  worked, top and site posts, conversation, numbers not read yet, formats by engagement),
  Marketing → Followers (account health), and the Inbox overview
  (conversation rates).
- **Iteration:** a weekly "what worked" digest, kept in `content_digests`, read into every
  draft's prompt beside the winners, shown on Overview. Nothing sends.

## Audit (read only, prod counts 2026-10-07)

| What | Prod |
|---|---|
| Published posts | 2 (YouTube: one long upload, its Reel row), both today |
| `content_metrics` rows | 0: ContentMetrics had not looked yet (6 h loop, posts are hours old) |
| `social_days` | YouTube 2, Instagram 2, Reddit 2, LinkedIn 1 |
| `comments` on our posts | 1 (YouTube), 0 answered, 0 turned into a DM |
| `reach_messages` | 12 out, 0 in |
| `touches` | 7 (5 LinkedIn connects, a YouTube comment and subscribe) |
| `call_bookings` | 3; `site_days` under content: 0 |
| `delivery.engagements` | 1 |

What we read per post before this (`Metrics`): views, reactions, comments, shares, and follows
on Instagram. One snapshot a day for 30 days. Nothing past that: no impressions outside X, no
retention, no traffic source, no saves, no site click per post, no reply rate.

The lander already counts per post: `/go/<code>/<stage>/<first 8 of the draft id>` lands with
`utm_content`, and a YouTube description's footer links `/go/yt/<video slug>`. `site_days` keeps
channel and campaign only, so the post was lost in the rollup.

Seams: autobrowse's `youtube` site serves `GET /youtube/v3/{resource}` only. YouTube Analytics
lives on another host (`youtubeanalytics.googleapis.com/v2/reports`), so the box needs one route
and the scope in `youtubeOAuth.scopes` (see "William's steps"). X's `GET /2/tweets/{id}` already
asks for `non_public_metrics`. The `meta` site's `/{mediaId}/insights` and `/{objectId}` cover
Instagram.

Status words: **Live** we read it today. **Needs scope** a consent away. **Needs William** an app
review or account only he can apply for. **Not built** buildable, not yet. **No API** the
platform shows it in its own app only.

Stage: **Reach** (top), **Trust** (middle), **Convert** (bottom), as in
`2026-10-07-content-funnel.md`.

Shared rows (every platform, built here, Live): engagement per view and per follower (derived,
followers from `social_days`), post to site CTR and site → form → booking → won with revenue per
post (`link_days`), best time to post, cadence against goals, the leaderboard and the weekly
digest. Each platform table names only what differs.

### YouTube long-form

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Views | plays | `content_metrics.views` | Data API `videos.statistics`, youtube.readonly | Live | Reach |
| Impressions, CTR | thumbnail shown, then clicked | none | Reporting API reach report (`video_thumbnail_impressions`, `_ctr`), yt-analytics.readonly, a report job | Needs scope, then Not built (job) | Reach |
| Traffic sources | views by source (search, suggested, browse, external) | collector built | Analytics `insightTrafficSourceType`, yt-analytics.readonly | Needs scope | Reach |
| Search terms | the YouTube searches that found it | collector built | Analytics `insightTrafficSourceDetail` on YT_SEARCH | Needs scope | Reach |
| Subscribers gained, lost | per video | collector built | Analytics `subscribersGained`, `subscribersLost` | Needs scope | Reach |
| Average view duration, % viewed | | collector built | Analytics `averageViewDuration`, `averageViewPercentage` | Needs scope | Trust |
| Retention curve | watch ratio by elapsed tenth | collector built | Analytics `elapsedVideoTimeRatio` x `audienceWatchRatio`, `relativeRetentionPerformance` | Needs scope | Trust |
| Rewatches | points of the curve above 1 | derived from the curve | as above | Needs scope | Trust |
| Watch time | minutes watched | collector built | Analytics `estimatedMinutesWatched` | Needs scope | Trust |
| Likes, comments | | `content_metrics` | Data API | Live | Trust |
| Shares, saves | saves = added to playlists | collector built | Analytics `shares`, `videosAddedToPlaylists` | Needs scope | Trust |
| Comment reply rate, time to reply | our answers on its comments | built here (`comments`) | none | Live | Trust |
| Comment → DM, DM → booking | | | YouTube has no DMs | No API | Convert |
| Title or thumbnail variants and CTR | Studio's Test and compare | none | not in any API | No API | Reach |
| Account: subscribers per day | | `social_days` | Data API `channels.statistics` | Live | Reach |
| Account: subscribers gained, lost per day, views per day | | collector built | Analytics channel report by day | Needs scope | Reach |

### YouTube Shorts

As long-form, plus:

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Engaged views | views past the first seconds (the old Shorts count) | collector built | Analytics `engagedViews` | Needs scope | Reach |
| Viewed vs swiped away | Studio's Shorts feed split | none | Studio only | No API | Reach |
| 30-second hold | share still watching at 30 s | from the curve | Analytics retention | Needs scope | Trust |
| Post → site | a Short's links can't be clicked | | | No API | Convert |

### Instagram Reels and posts

Graph API through the `meta` site; the token's scopes include `instagram_manage_insights`. No IG
post has gone out on the API path yet, so Live below means read by code that answers on a fake;
the first post proves it.

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Reach | accounts that saw it | `content_metrics.views` | `/{media}/insights reach`, instagram_manage_insights | Live | Reach |
| Views | plays and impressions | collector built | `views` | Live | Reach |
| Likes, comments, shares, saves, total interactions | | likes to shares in `content_metrics`; saves new | `saved`, `total_interactions` | Live | Trust |
| Follows, profile visits from the post | posts only; a Reel refuses them | `follows` | `follows`, `profile_visits` | Live | Reach |
| Average watch time, total watch time | Reels | collector built | `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` | Live | Trust |
| Skip rate (the 3-second hold) | | none | not in the Graph API version we call | No API | Trust |
| Retention curve, rewatches | | | app only | No API | Trust |
| Traffic sources (feed, Reels tab, explore) | | | app only | No API | Reach |
| Comment reply rate, time to reply | | built here | none | Live | Trust |
| Comment → DM, DMs answered, DM → booking | | none: we send no Instagram DMs yet | `instagram_manage_messages`, after Meta app review | Needs scope | Convert |
| Account: reach, profile visits, link-in-bio clicks, accounts engaged per day | | collector built | IG user insights `total_value`, instagram_manage_insights | Live | Reach |
| Account: followers | | `social_days` | IG user `followers_count` | Live | Reach |

### TikTok

Display API through a sandbox app (posts private until TikTok reviews it).

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Views, likes, comments, shares | | `content_metrics` | `video/query`, video.list | Live | Reach, Trust |
| Reach, average watch time, full-watch rate, retention, traffic sources | | none | Business API (TikTok for Business account and its review) | Needs William | Reach, Trust |
| Saves | | none | Business API | Needs William | Trust |
| Comment reply rate | comments come from the browser leg, not yet stored | none | Business API, or the box's `/web/videos/{id}/comments` | Not built | Trust |
| Account: followers, likes | | none | `user/info` with user.info.stats | Not built (route exists) | Reach |
| Profile visits, link-in-bio clicks | | | Business API | Needs William | Reach |

### LinkedIn (Wren's member account)

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Reactions, comments | | `content_metrics` | `socialActions`, w_member_social | Live | Trust |
| Impressions, members reached, reshares, profile views from the post | | 0 today (`views: 0`) | `memberCreatorPostAnalytics`, r_member_postAnalytics (Community Management API) | Needs William | Reach |
| The same from the post's analytics page in the browser | | none | autobrowse route on `/analytics/post-summary/` | Not built | Reach |
| Comment reply rate, time to reply | | built here | none | Live | Trust |
| Comment → DM, DMs answered, DM → booking | reach DMs | built here | none | Live | Convert |
| Account: followers | | `social_days` (browser `/audience`) | none | Live | Reach |
| Account: profile visits, search appearances | | none | browser dashboard route | Not built | Reach |

### X

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Impressions, likes, replies, reposts and quotes | | `content_metrics` | `public_metrics`, tweet.read | Live | Reach, Trust |
| Bookmarks (saves) | | collector built | `public_metrics.bookmark_count` | Live | Trust |
| Link clicks, profile clicks | | collector built | `non_public_metrics` on the API leg (the box's default asks for them) | Live on the API leg; the browser leg leaves them out | Convert, Reach |
| Video views, watch | | | `organic_metrics` on video posts | Not built | Trust |
| Comment reply rate, time to reply | replies need search (a paid tier) | built here over what we hold | `tweets/search/recent` | Live over held rows | Trust |
| Comment → DM, DM → booking | | none: we send no X DMs | `dm.read`, `dm.write` | Not built | Convert |
| Account: followers | | none | `users/me` `public_metrics` | Not built (route exists) | Reach |

### Reddit

| Metric | What | Today | API and scope | Status | Stage |
|---|---|---|---|---|---|
| Score, comments, crossposts | | `content_metrics` | `/api/info` | Live | Reach, Trust |
| Upvote ratio | | collector built | `/api/info` `upvote_ratio` | Live | Trust |
| Views | Reddit shows them to the author only | `view_count`, usually null | none | No API | Reach |
| Thread comments we posted (5 a day goal) | | `reddit_threads.answer_ref` | none | Live | Trust |
| Comment reply rate, DM → booking | | built here | none | Live | Trust, Convert |
| Account: followers | | `social_days` | profile `about` | Live | Reach |

### Counts

| Platform | Live | Needs scope | Needs William | Not built | No API |
|---|---|---|---|---|---|
| YouTube long-form | 4 | 10 | 0 | 0 | 2 |
| YouTube Shorts (past long-form) | 0 | 2 | 0 | 0 | 2 |
| Instagram | 8 | 1 | 0 | 0 | 3 |
| TikTok | 1 | 0 | 3 | 2 | 0 |
| LinkedIn | 4 | 0 | 1 | 2 | 0 |
| X | 4 | 0 | 0 | 3 | 0 |
| Reddit | 5 | 0 | 0 | 0 | 1 |

The same counts live in code (`ANALYTICS_CATALOG`, `packages/content/src/analytics/catalog.ts`);
a test keeps this table and the catalog in step.

## Where each number lives

| Number | Where |
|---|---|
| A post's numbers, every platform | Marketing → Posts: columns (stage, format, views, engagement, CTR, % viewed, site clicks, post to site, forms, calls, revenue); the platform switch filters |
| Leaderboard | Marketing → Posts → Leaderboard view, sorted by score; filter by format, stage, date, platform. Overview "Top posts" opens it |
| Formats against each other | Marketing → Overview, "By format, last 30 days": median engagement per 100 views per format, each a link to its posts |
| Per day sparklines, engagement per view and per follower, retention curve, traffic sources, search terms | a post's page, "How it did", first in its details |
| Post → site → form → booking → won, revenue first and last touch | a post's page, "What it brought"; Posts columns and the "Brought visits" view; Overview "Posts that brought visitors" and the "Site visitors from posts" tile |
| Its comments: reply rate, time to reply, turned into DMs | a post's page, "Its conversation" |
| Needs scope, Needs William, Not built, No API | inline where the number would sit on a post's page, with the step; Overview "Numbers not read yet" |
| Cadence against goals | Marketing → Overview, "This week against goals" |
| What worked | Marketing → Overview, "What worked last week"; every draft's prompt |
| Comment reply rate, time to reply, comment → DM, DMs answered, DM → booking | Inbox → Overview and Marketing → Overview, "Conversation, last 30 days" |
| Followers gained and lost, profile visits, link-in-bio clicks | Marketing → Followers columns |

Rows behind a top list (links, conversation, cadence, digest, metrics) open on hidden list pages
under Numbers, the way Search days does, so every number clicks through. A post's numbers link to
its Activity tab, its link rows and its comments. Conversation and link rows are Wren's only.

## Shape

- `post_metric_days`: `draft_id`, `day`, `metric`, `key` ("" for a plain number; the tenth of
  the video for `retention`, the source for `traffic_source`, the words for `search_term`),
  `value`, `source` (data, analytics, insights, public), `fetched_at`. A day's row is updated by
  a later look that day; past days are never touched.
- `account_metric_days`: the same per `platform` and day.
- `metric_sources`: one row per platform and metric: `state` (live, needs_scope,
  needs_william, not_built, no_api, error), `why` (the platform's own words), `checked_at`,
  `live_at`. The step to fix it comes from the catalog.
- `link_days` (channel-search): the lander's export per day, `source`, `campaign`, `content`:
  `clicks` (visitors arriving on that link), `hops` (counted video hops), `forms_first`,
  `forms_last`, `calls_first`, `calls_last`, `won_first`, `won_last`, `revenue_first_cents`,
  `revenue_last_cents`. Re-read and upserted like `site_days`.
- `content_digests`: one per Monday and platform (`all` included): the lines. First kept.
- A post matches its link rows by `content` = the first 8 of its id, or for a YouTube upload by
  the footer's campaign (`<video id>-...`).

Collectors: `ContentChannel.insights(id, { published, kind })` and `accountInsights(day)`, both
optional, both answering numbers plus gaps rather than throwing per metric. `Content.insights`
and `Content.accountInsights` serve them; `ContentMetrics` calls them after `metrics` on the same
daily look, and the account once a day per platform.

Derived (the `marketing_conversation` view and `postAnalytics` in `packages/content/src/analytics/records.ts`):

- reply rate: their comments on our posts we answered, of all theirs;
- time to reply: median of answered at minus their comment's at;
- comment → DM: their comments whose author we then DMed (`comments.contact_id`);
- DMs answered: DM threads where they wrote back after our first message (LinkedIn and Reddit, the only DMs we send);
- DM → booking: contacts whose person's lead email booked a call after the first DM;
- post → site: link clicks over the post's views.

Won and revenue: a booking's or application's email that matches a client member of an
engagement with a paid invoice. First touch is the application's `first_touch`, last its
`last_touch`.

## Goals (cadence)

YouTube: 2 long and 5 Shorts a week. Instagram: a Reel a day. LinkedIn: a post a day. Reddit: a
post a week and 5 comments a day (`reddit_threads` answered). Kept in code (`CADENCE_GOALS`); a
setting when he asks to change them.

## William's steps

1. **YouTube Analytics.** Needs an autobrowse change first: a `GET /youtubeAnalytics/v2/reports`
   route on the `youtube` site (origin `https://youtubeanalytics.googleapis.com`) and
   `https://www.googleapis.com/auth/yt-analytics.readonly` in `youtubeOAuth.scopes`. Then his one
   step: `pnpm -s autobrowse site setup youtube consent --account <the channel's Google login>`
   and click Allow. The next daily look fills every YouTube row above.
2. **Impressions and CTR on YouTube.** After step 1: a Reporting API job for
   `channel_reach_basic_a1` (Not built; one handler and a daily CSV read).
3. **LinkedIn post analytics.** Apply for the Community Management API on the Wren LinkedIn app
   (developer portal → Products → Community Management API → Request access). On approval add
   `r_member_postAnalytics` and consent again.
4. **TikTok.** Apply for TikTok for Business API access on the Wren account (and the sandbox
   app's review for public posts). Say when.
5. **Instagram DMs.** Reading the IG inbox adds `instagram_manage_messages`, which needs Meta app
   review. Not needed for the counts above.

## Not built (next)

1. The autobrowse route and scope for YouTube Analytics (step 1).
2. YouTube reach report job (impressions, CTR).
3. LinkedIn post analytics through the browser while the API waits.
4. TikTok and X follower counts (routes exist; `audience` on both adapters).
5. Hook, title and thumbnail variants: we keep his three thumbnails and every title edit, but
   YouTube's own test runs in Studio. A variant column waits on the reach report.
6. X video watch (`organic_metrics`).

## Cost

$0. One more read per post per day on each platform's own API (YouTube Analytics is 1 quota unit
a report; a post is 4 reports). No model calls: the digest's "next post" line is code.

## Decision log

- 2026-10-07: written from his ask and a read-only audit.
- 2026-10-07: long form (`metric`, `key`, `value`) instead of a column per metric. Seven
  platforms answer different sets, and new ones (engaged views, skip rate) arrive without a
  migration. A view picks the columns the Posts list shows.
- 2026-10-07: a day's value is the day's last look; earlier days stay. "Never overwrite" is per
  day, so a curve is a day series.
- 2026-10-07: a gap is data. Each failed metric is kept with the platform's words, so "Needs
  scope" on a page is what the platform said today, not a guess.
- 2026-10-07: no Analytics page (William, the same day). Numbers go on Posts, Overview,
  Followers and the Inbox overview; their rows open on hidden list pages.
- 2026-10-07: revenue per post is matched by email through client members. Approximate by
  design: a client who books from a different address is lost. Kept honest by showing first and
  last touch side by side.
- 2026-10-07: the autobrowse route is not added here: autobrowse deploys on commit to the desk,
  and its change is its own repo's. The wren collector is ready and answers "Not built on the
  box" until it lands.

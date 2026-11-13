# Eden's method in our stack (WA-1360)

Eden (eden.so) is a creator tool William studied: it finds posts that beat their creator's usual draw, keeps his saves, and tracks creators. William 11-12: build its feed, captures and creator index on Weaver, Canon, wren and autobrowse. Study and his calls in his words: `tasks/docs/research/eden-2026-11-12/` (`study.md`, `calls.md`). He then said "go ahead and do all these eden tasks".

## Target state

1. **Captures.** Each post he saves on Instagram, X, YouTube or LinkedIn becomes a Canon source of his (`provider: {kind: human, who: william}`). A new save lands within a day while the Mac is awake. His old saves file at 50 a source a day. The collection or playlist names are tags.
2. **Score.** Each post we hold has its multiple over its creator's usual draw (Eden's "outlier score"). One function computes it, for others' posts and for ours.
3. **Creator index.** A list of creators he tracks per niche, and a stored, refreshed copy of their posts, counts and follower counts over time. Reads happen on a schedule, never per question.
4. **Feed.** Outlier posts in a niche, filtered like Eden's presets, in a portal page and in a CLI with JSON out for agents.
5. **Auto-DM.** A keyword in a comment sends a DM (Skool funnel). He parked the funnel ("we do later").

## What exists

| Need | Exists | Where |
|---|---|---|
| Lift over a creator's median | yes: per channel, all-time median over every run's hits, from 5 posts, each count | engine `weaver/src/ledger/ledger.ts:158-222` (`baselines`, `liftOf`); the brief shows it; `follow -n` surveys rank over the channel median |
| A creator's posts, listed | YouTube, TikTok (yt-dlp), Reddit, HN, LinkedIn pages, ad libraries | `weaver follow <run> <url> --as posts` (`engine-cli.ts:968`); each source's `follows:` |
| IG, X, Threads profile posts | autobrowse routes; no Weaver source | autobrowse `src/sites/{instagram,x,threads}.ts` |
| His saves | IG `/web/saved` (by collection name, `max` ≤ 1000), X `/web/bookmarks` (`max` ≤ 500, 10 calls a day), YouTube API `/youtube/v3/{resource}`. Nothing calls them. LinkedIn: a watcher counts the saved-posts page; no reader | autobrowse `instagram.ts:587`, `x.ts:355`, `youtube.ts:705`, `watchers.ts:40` |
| Put a link into Canon as his source | `addOne` with `from: <person>` sets `provider: {kind: human}`; a note is optional | `apps/cli/src/canon.ts:258` |
| One id per platform post | `platform_objects`; role tables in `objects/roles.ts` | `packages/core/src/objects-schema.ts:23` |
| A handle to a person | `social_handles` (platform, handle, url, name, person) | `packages/core/src/touches-schema.ts:66` |
| Others' posts with counts | `reach_posts` (posts we comment on; reactions, comments) | `packages/starling/outbound/src/schema.ts:196` |
| Our own counts | `content_metrics` (per look) and `post_metric_days` (per day), both keyed by draft; `social_days` (our followers per day) | `packages/starling/inbound/src/schema.ts:218, 286, 309` |
| Comment keyword → DM | IG and FB, with reply, button and follow-up | `packages/starling/inbound/src/social/keywords.ts` |

WA-1329's close note reads "Outlier multiple not built anywhere". That is wrong: Weaver has had `liftOf` since WA-1054.

## 1. Score

Eden's formula (study.md §3) beside Weaver's:

| | Weaver `liftOf` now | Eden | We build |
|---|---|---|---|
| Statistic | median | median | median |
| Window | every post ever seen | baseline = median of the creator's last 30 posts of that kind; if the last 7 days hold more than 30, all of them | Eden's |
| Kind | one per channel | reels and posts apart | the caller passes `kind` |
| Count | each count | views on YouTube, TikTok, Reels; likes on X, Threads, LinkedIn, IG posts | Eden's; every count stays stored |
| Rank | none | top N% of the creator's posts, from 20 posts | yes |
| Young posts | none | projected forward; per follower when known | not built: "viral now" scores a young post low. `post_count_days` allows it later |

Build: a new pure function `scoreOf(post, creatorPosts) → {multiple, count, rank?, n}` in `@wrenautomation/weaver/ledger`. A post is `{at, kind, metrics}`. A post with no date counts toward the last 30 by list order. `liftOf` stays as it is; the two share the median helper. Bands (1-3x … 50x+) are display, so the feed maps them. Engine work goes to weaver dev (we never edit `engine/`).

Callers: the index refresh job stores the result on each post row, so the feed filters in SQL. Our own posts: an adapter reads `content_metrics` into `{at, kind, metrics}`.

## 2. Captures

He said "go ahead" on all tasks, so this unparks WA-1360.2.

The job, once a day on the Mac (launchd):

1. `wren capture pull` reads each source through autobrowse (`pnpm -s autobrowse site call <site> GET <path> --account <his main>`, as `autobrowseDrive` in `canon.ts` does).
2. Each item resolves to a `platform_objects` row (`resolveObject`).
3. Each item upserts a row in a new role table `captures`: `(platform, ref)` key, `source`, `lists text[]` (each list it is in), `saved_at`, `first_seen`, `raw` (the item whole), `filed_at`, `error`. `OBJECT_ROLES` entry: column `ref`, kind `post`, twin `drop`.
4. `wren capture file` files up to 50 rows a source a day where `filed_at` is null. It builds the source from `raw` (text, author, counts, media), with no second read. A video item downloads its media for the breakdown. It calls `addOne` with `from: william`, the tags `capture` and `saved-<list>`, and sets `filed_at`. A failure writes `error`; three failures stop retries.
5. `wren capture status` shows the counts per source: read, filed, waiting, failed.

Changes:

- `AddOpts.tags`: merged with the topic and old tags on add and on edit. A tag never makes a topic folder (`sops/index.ts:590, 604-621`).
- A source builder from a captured item for X posts, IG posts and reels, and YouTube videos. An x.com link goes to yt-dlp today (`sops/index.ts:161`), which fails on a text post.
- autobrowse: the IG saved flow returns the collection list it already reads (`instagram-people.ts:273-282`). One call reads all saves when each item names its collections; otherwise one call per collection, inside the 10-a-day cap.
- autobrowse: a new LinkedIn flow reads `/my-items/saved-posts/` (author, text, url, counts), as account `linkedin` (main).

| Source | Read | Per day |
|---|---|---|
| `instagram-saved` | `/web/saved`, account `instagram` (main) | 1 call at `max` 200; first pull at 1000 |
| `x-bookmarks` | `/web/bookmarks`, account `x` (main) | 1 call at 100; first pull at 500 (X keeps about the newest 800) |
| `youtube-liked`, `youtube-playlists` | `videos?myRating=like`, `playlists?mine=true`, `playlistItems` | a few quota units |
| `linkedin-saved` | the new flow | one pass |

Open for William: the default YouTube token is the Wren channel. His likes need a read-only consent on the Google account he watches with.

Not covered: X bookmark folders (the route reads none), Watch Later and YouTube history (not in the Data API), TikTok favorites, Reddit, Threads saved.

Breakdowns run on fleet cohere keys (`apps/cli/src/video-watch.ts:37`). The cost is time. A saved reel is an edit reference, so each keeps its breakdown.

## 3. Creator index (his yes before any build)

Hard to change: the feed and the score stand on it.

**Priorities, in order:**
1. One place per fact: one store for the counts of a tracked post.
2. The portal and agents read the same rows (William: "a UI and a CLI for agents").
3. Counts and followers over time, so "viral now" and growth work.
4. His choice of creators keeps his words on why.
5. Reads stay under site caps; one read serves every user.

Shared by A and D: posts are role rows on `platform_objects` (`creator_posts`: format, text, raw, and the stored `scoreOf` output), counts in `post_count_days`, followers in `follower_count_days`. A Mac job reads through autobrowse and yt-dlp now. When weaver dev ships IG, X and Threads `follow` sources, the job reads through Weaver.

**A. All in wren Postgres (recommended).** `tracked_creators`: a `social_handles` row, niche tags, his note, who added it, when, active.
- For: one system; the portal and `wren creator` / `wren feed` read it; one handle map with the CRM.
- Against: creators are not Canon records, so `knowledge find` does not list them. Canon gets what he keeps: "save to Canon" on a feed row files it as his source.

**D. The list in Canon, posts in Postgres.** A tracked creator is a Canon source `kind: person`, URL the profile, tags `creator` and the niche, his words as the note.
- For: his list is a human record in his brain, with git history; agents find creators with `knowledge find`.
- Against: three new parts. A `wren creator add` path writes a `person` record (`source add` cannot: `kindOf`, `sops/index.ts:517`). A creator on three platforms needs a shape (three records, or one with `profiles`). The job reads the list from Canon's index and must stop reads for a retired record.

**B. Weaver files ledger.** A standing run per niche; a schedule runs `follow --as posts` per creator.
- Against: the ledger is JSONL on the Mac, so the portal cannot read it (fails priority 2); no IG, X or Threads source.

**E. Weaver ledger on a Postgres backend** (literally "B and C" in one store).
- Against: a new engine backend, every research run writes to prod, and the feed queries hit JSON. Most cost for priority 1 alone.

Rank: A meets all five. D meets all five at three parts more. B fails 2. E pays most for 1. A Canon-only index (posts as markdown) fails 1 and 3 and is out.

Deferred: a Weaver `index` source that returns tracked posts as hits in research runs.

## 4. Feed (after the index)

- CLI: `wren feed [--niche <tag>] [--preset <name>] [--min <x>] [--since <days>] [--platform ...] --json`.
- Presets (Eden). Each window is post age; each multiple is the headline count's:
  - Breakouts: under 50K followers, 5x+, 3 months.
  - Hidden gems: under 20K followers, 10x+, 6 months.
  - Viral now: 10x+, 30 days, 500+ likes (likes on every platform).
  - All-time greats: 10x+, over 50K followers.
- Portal page: the same query, the design-language artifact, the ui-design proof. A row opens the post; "save to Canon" files it as his source.

## 5. Auto-DM

Built for IG and FB (keywords.ts). An IG send needs `instagram_manage_messages` after Meta app review (WA-1048). The Skool link waits for the Skool. Nothing to build now.

## Build order

1. Captures (WA-1360.2): now.
2. Score (WA-1360.1): weaver dev builds `scoreOf`; wren's adapter for our posts follows the release.
3. Index (WA-1360.3): on his pick.
4. Feed (WA-1360.4): after the index.
5. Auto-DM (WA-1360.5): parked.

## Non-goals

- Eden's skill method (lanes, idea cards, weekly memo): William, "not sure".
- A Chrome extension or Mac app. autobrowse reads in his signed-in sessions.
- Paid scraper vendors.

## Risks

- The job needs the Mac awake. A missed day reads the next day; the saves stay on the site.
- IG and X caps. Saves and profile reads share them. At a limit the job stops and reads again the next day.
- A capture is his source with no note. In a Canon conflict it outranks an agent source (rule SL-22). Intended: he chose to save it.

## Log

- 2026-11-12: written. Captures and score need no index choice; the index waits for his yes.
- 2026-11-12: goldfish review: 39 findings, 27 applied, 8 rejected; open: index A or D, YouTube consent. Applied: captures file from `raw` with no queue (the drain sent x.com to yt-dlp, the 50 cap lost the backlog, `person` came from `asked_by`); `lists[]` and `filed_at`; `AddOpts.tags`; route caps as single calls; IG collections list; `scoreOf` beside `liftOf`, stored on rows; option E; the D costs; four tables; presets per count; build order. Rejected: captures stay parked (he said go ahead on all), F14 passive (both active), the queue fixes (no queue now).

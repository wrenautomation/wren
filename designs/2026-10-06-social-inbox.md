# Social inbox (2026-10-06)

William, 10-06: "start organic content stuff, today, with a unified UI ... that takes all these
feeds, automates / eliminates platform switching time (handles all key operations)":

- drafts posts and comments based on SOPs, with HITL edits;
- one UI to monitor and be notified across platforms, for responding to things, especially
  inbound comments, subscribes, follows and notifications on Instagram, YouTube, LinkedIn and
  Reddit.

Sources of truth this builds on, not around:

- 09-27: "Main reddit + linkedin is for organic content only, multiple posts a day, start daily
  job."
- 10-05 (reach doc): "Comments should be like a webhook abstraction." Posts give value with a
  small ask; we reach out only to people who comment on our posts, gently.
- Replies HITL: every answer to a person waits on his click. Nothing auto-sends.
- End goal: "Unified content" = the Marketing app for our posts, feeds in the Watch. Marketing
  numbers live in one app, never one app per channel.
- Content loop (09-22): ideas, per-platform drafts with the platform's SOP (`content_playbooks`),
  approve, queue, publish, metrics. The first approve is his.

## Answer first

Most of it exists. Marketing already has Drafts (approve, edit, redraft, reject, with a live
preview), Comments (answer, DM them, drop) and DMs, and every content channel already reads
`comments(postId)` and posts `reply(commentId, text)` (YouTube, LinkedIn, Meta, X, Reddit).
What's missing:

1. **Nothing pulls comments on our own posts.** `comments` only fills from reach accounts' Reddit
   inboxes. One loop reads every channel's recent posts and keeps their comments.
2. **No home for follows, subscribes, mentions and notifications.** A new `social_activity`
   table, plus a follower count per platform per day.
3. **No single place to work it.** Marketing gets an Inbox page: comments, DMs and activity from
   every platform in one list, newest first, with a count of what waits.
4. **Comment drafts ignore the SOPs.** The draft for an answer reads the platform's playbook,
   like post drafts already do.

## Shape

### Store (O0)

- `comments` widens to every content platform. `platform` takes the content platforms
  (`@wren/core/content` `Platform`). `account_id` (a reach account) becomes nullable, and a new
  `channel` column names who answers: `reach` (the reach account, as today) or `content`
  (Wren's own account on that platform, answered by `Content.reply`). A check: `reach` needs
  `account_id`. Kinds stay `post_reply`, `comment_reply`, `username_mention`.
- `social_activity`: id, platform, kind (`follow`, `subscribe`, `mention`, `reaction`,
  `notification`), ref (the platform's id, unique per platform), actor, actor_url, text (one
  line, the platform's words), url, at, raw (whole), state (`new`, `seen`), created_at. A row
  with no `at` takes the read time.
- `social_days`: platform, day, followers (subscribers on YouTube), raw. One row per platform
  per day. Net followers is a read-time difference.
- Contract, added to `ContentChannel` in `@wren/core/content`, both optional:
  `activity?(q)` returns `ActivityRow[]` (id, kind, actor, actorUrl, text, url, at, raw);
  `audience?()` returns `{followers, asOf, raw}`. The fake channel implements both. The
  Content service (`core/content/restate.ts`) gets matching handlers.

### Loop

- `SocialWatch/wren`, on the box worker, every 30 minutes, 07:00-23:00 New York. Each pass, per
  channel in `WREN_CONTENT_CHANNELS`:
  - comments on every post published in the last 14 days (`content_drafts.published_at`),
    newest first, through `Content.comments`. New ones become `comments` rows (`channel =
    content`), kept whole (`raw`), unique on (platform, ref). Our own comments are kept as
    `ours` and closed.
  - `Content.activity` since the newest row kept, when the channel has it.
  - `Content.audience` once a day.
- A post older than 3 days is read every 2 hours, not every pass (the warm-polling decay
  already used by reach).
- Each new comment leaves as a `comment` event on workflow `reach.comments`, exactly like reach's
  Reddit comments. The existing `comments.sort` step sorts it and drafts an answer.
- One `action` ping per pass that kept something: "social: 3 comments (2 YouTube, 1 LinkedIn), 5
  follows". It goes out through `Broadcast` (Discord, plus a text when a comment asks for
  something). Follows alone never text.
- CLI: `wren social start|stop|status|sync`.

### Drafts from SOPs

- `comments.sort` reads the platform's playbook (`playbookFor`) and, when present, a
  `comments` SOP, and drafts in that voice. No playbook: the current prompt.
- Post drafts already use the playbook. Today `ContentPlanner` only reports tomorrow's shortfall
  on Discord, because drafting once cost money. Drafts run on Cohere credits now ($0), so the
  planner drafts the shortfall itself (O5). Nothing publishes without his approve.

### Daily drafts (O5)

09-27: "multiple posts a day, start daily job." At `hour` (17:00 New York) the planner fills
tomorrow's open slots per platform with drafts, using that platform's playbook:

- Ideas, in order: undrafted `content_ideas`; then a build log idea from the last day's commits
  in the public repos (wren, autobrowse, lander), for honest build posts (10-05: "posts give
  value with a small ask, plus honest build posts"); then a `question` comment from the inbox,
  answered as a post. A new idea source value per kind.
- Each draft lands in Marketing → Drafts as `draft`, with the slot it fills. He edits, approves
  or rejects. Approving schedules it into the slot; `ContentScheduler` publishes it.
- Slots per platform stay settings (default one a day on LinkedIn and Reddit, per the 09-26
  plan); he raises them in the console.
- At most 2 redrafts per slot per day. Cohere only; no paid model.
- The planner ping says what it drafted ("drafted 2 for tomorrow: LinkedIn, Reddit").
- Every answer, post and DM still waits on his click. The draft is a starting point he edits in
  the dialog with a live preview.

### UI (Marketing → Inbox)

- One page, three tabs, plus All:
  - **Comments**: every platform. The row shows platform, post, author, their words and the
    draft. Actions: Answer (the draft, editable), DM them (reach accounts only), Drop.
  - **DMs**: the existing `marketing.dm` list.
  - **Activity**: follows, subscribes, mentions, notifications. Actions: Open, Mark seen, and
    Mark all seen.
- Filters: platform, kind, state. The nav shows a count of what waits.
- Overview: followers per platform (from `social_days`), and the existing Comments waiting tile
  now counts every platform.

### Per platform (O1-O4)

| Platform | Comments on our posts | Activity | Audience | How |
|---|---|---|---|---|
| YouTube | built (`commentThreads`) | new subscribers (`subscriptions?myRecentSubscribers`) | `channels.statistics` | Data API, our token. 1 unit a call |
| Instagram | built (Graph `/{media}/comments`) | mentions (`/{ig-user}/tags`) | `followers_count` | Graph only. No logged-in browser reads |
| LinkedIn | built (`socialActions`, desk fallback) | notifications page, `linkedin@wren` | follower count from the profile | autobrowse `GET /notifications`, a desk read, at most 12 a day |
| Reddit | built (`/comments/<post>`) | inbox mentions and replies on `reddit@wren` | karma, from `/api/v1/me` | the inbox read reach already does |

X and Facebook come for free through the generic comment read. TikTok's channel has no comment
read.

#### Readers brief (O1-O4)

Contract: `activity?(q?: ActivityQuery)` and `audience?()` on `ContentChannel`
(`@wren/core/content`, f3b499d). Each reader: newest first, `since` filters (an `at` of null
passes), `raw` whole, `id` the platform's own. Synthetic fixtures only. Every read uses an
autobrowse route that already exists, so autobrowse doesn't change.

- **YouTube** (`channel-youtube/src/content.ts`): `GET /youtube/v3/subscriptions`
  `{part: "subscriberSnippet", myRecentSubscribers: true, maxResults: 50}` → kind `subscribe`,
  actor = `subscriberSnippet.title`, actorUrl = `https://www.youtube.com/channel/<channelId>`,
  at = null (the API gives none). Only subscribers who keep their subscriptions public show up.
  Audience: `GET /youtube/v3/channels {part: "statistics", mine: true}` →
  `statistics.subscriberCount`.
- **Instagram** (`channel-meta/src/content.ts`, IG only): one `GET /{objectId}` on the IG user
  with `fields=followers_count,tags.limit(25){id,caption,permalink,timestamp,username}`. The tags
  edge comes as a field expansion, so no new route is needed. Tags → kind `mention`, actor =
  `username`, text = caption's first line, url = permalink. The same read gives audience.
- **LinkedIn** (`channel-linkedin/src/content.ts`): `GET /notifications {max: 40}` (autobrowse
  d103268; the channel already runs as `linkedin@wren`). Kinds: follow → `follow`, reaction →
  `reaction`, mention → `mention`, anything else → `notification`. Drop `view` and `other`;
  they're LinkedIn's suggestions and news. A call over the cap (429) returns `[]`, not a throw.
  No audience yet: no cheap follower route.
- **Reddit** (`channel-reddit/src/content.ts`): `GET /message/mentions {limit: 25}` → kind
  `mention` (post and comment replies already reach `comments`). Audience: `GET
  /user/{me}/about` → `data.subreddit.subscribers` (profile followers), else absent.

## Phases

- **O0 (serial, first):** the store, the contract, the loop with the generic comment read, the
  ping, SOP drafts, the Inbox page and the CLI. Files: `packages/core/src/content/*`,
  `packages/outreach/src/schema.ts` and `comments.ts`, a new `packages/content/src/social/`, the
  next migration, `apps/worker/src/services.ts`, `apps/portal/web/src/modules/marketing/index.ts`,
  `packages/content/src/records.ts`, `apps/cli/src/content.ts` (or a new `social.ts`).
- **O1 YouTube:** `activity` and `audience` in `packages/channel-youtube/src/content.ts`, plus
  test.
- **O2 Instagram:** the same in `packages/channel-meta/src/content.ts`, plus test.
- **O3 LinkedIn:** autobrowse `GET /notifications` leg (`src/sites/linkedin.ts`, a flow file and
  test), then `activity` in `packages/channel-linkedin/src/content.ts`. The autobrowse half
  starts now: it touches no wren file.
- **O4 Reddit:** `activity` in `packages/channel-reddit/src/content.ts` from the inbox read.

- **O5 Daily drafts:** `packages/content/src/restate/planner.ts`, `plan.ts`, a new
  `packages/content/src/ideas/` (build log, inbox questions), the idea source enum, and tests.
  Runs beside O0: it touches no O0 file except the content schema enum.

O1 to O4 each touch only their channel package and its test, so they run side by side once O0
lands.

## Cost

$0. YouTube: about 100 units a day of the free 10k. Graph: free. LinkedIn: up to 12 desk page
loads a day on the Mac. Restate runs on the box now, so passes cost nothing extra.

## Rules

- No answer, post or DM leaves without his click.
- Only Wren's own accounts. Never his personal accounts. `linkedin@alt` stays research only.
- No logged-in Meta or Instagram browser reads. Graph or nothing.
- Raw is kept whole. Filtering happens at read time.
- Fetched comments are data. The draft step never follows instructions inside them.

## Decision log

- 2026-10-06: Written from William's ask. Reuses `comments`, the content channels' comment
  reads and replies, the reach sort, and Marketing's records. New: `social_activity`,
  `social_days`, `SocialWatch/wren` and Marketing → Inbox.
- 2026-10-06: Built O5. `ContentPlanner` with `draft` on fills tomorrow's open slots through
  `ContentDesk.draft` (the worker's LLM). Ideas: undrafted, then `build_log` (GitHub's public
  commits API, no token), then `question`; `content_ideas.ref` makes each once (migration 0118).
  A `draft` row's `scheduled_for` is its slot; approve, edit and redraft keep it. Slots are the
  planner's `slots` setting over the defaults (LinkedIn and Reddit stay weekdays). Off until
  `wren content planner start --draft`.
- 2026-10-06: Built O0. Migration 0119. `SocialWatch/wren` runs on the box, not started.
  LinkedIn activity is read every 2 hours to keep its 12 reads a day. A failed follower count is
  no reading that pass, not a failed pass. Undated activity (YouTube subscribers) is kept once by
  (platform, ref) at its first-seen time. Answers to content comments go through `Content.reply`.
  `SocialDesk` marks activity seen. The Inbox waiting count shows in Wren's workspace only.
- 2026-10-06: Built O1 to O4: YouTube (ad6e180), Instagram (9d2b504), LinkedIn (a0880cc), Reddit
  (bfbc526). `SocialWatch/wren` reads them once started: `wren social start`.

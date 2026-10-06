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
- Post drafts already use the playbook. The daily job (`ContentPlanner`) keeps the day's drafts
  topped up; nothing publishes without his approve.
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

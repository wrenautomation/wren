# Fetch budget

2026-10-15. William: "maximize every fetch, across the board on all platforms." Fewer wasted
reads; read more per fetch; same freshness. Reddit is the model (`7712f321`: one multi-sub
listing, 100 a page, paged back to the oldest last read).

## What reads our platforms

Only two loops read our own posts on a timer: `ContentMetrics` (hourly) and `SocialWatch`
(every 30 min, 07:00 to 23:00, 32 passes a day). Both call the `Content` service one post at a
time. That is the waste. Everything else is already cursor-based, push-woken or capped (below).

## Audit

Counts are platform fetches a day at prod's size now (published posts: X 8 in 3 days / 10 in
14; YouTube 4 / 7; Instagram 5 / 5; LinkedIn 4 / 4; TikTok 3 / 3; Threads 2 / 2; Facebook 6 / 6).
`n3` = posts under 3 days old, `n14` = under 14.

### SocialWatch comments

Before: one read per post. Posts under 3 days every pass (32), older every 2 h (8):
`32*n3 + 8*(n14-n3)`.

| Platform | Before | After |
|---|---|---|
| X | 272 searches (cap 50, ~220 refused) | 32 timeline reads (posts bucket, cap 100) + ~17 searches |
| YouTube | 152 `commentThreads` | 32 `videos.list` (50 ids) + ~15 reads |
| Instagram | 160 `/comments` | 32 media listings (100 posts) + ~15 reads; Meta pushes still read at once |
| TikTok | 12 page reads (cap 24) | same slots; each due slot is one API count read first, ~6 page reads |
| LinkedIn | 128 tried, 60 land (cap), the rest 429 | ~32, spread over the day (see Calls made) |
| Facebook (Wren) | 0 site calls | 0 (Page comments off; Meta pushes) |
| Threads | 64 | 64 kept: no batch or count endpoint |
| Reddit | by post | one `/api/info` read for all posts |

About 790 tries a day become about 250, and the ~220 X searches the cap refused go away.

The fix is a count probe. Each pass, one `commentCounts` read per platform returns every due
post's comment count. A post is read only when its count moved since its last full read, when it
was never read, or when a sweep is due (a count can lie: held comments, deletes). Sweeps: 6 h
young, 24 h older; X and TikTok 12 h / 48 h, they read through a capped page. A pushed post is
always read. A probe that fails, or leaves a post out, reads that post as today, so nothing gets
staler. `isDue` is unchanged, so a platform is probed no oftener than before.

### ContentMetrics

Before: per due post, `metrics` then `insights`. After: one `metricsMany` per platform per pass
for the posts due in that pass; a post it leaves out (or a failed batch) is read with `metrics`.

Looks are staggered: each post's next look is relative to its last, so a pass rarely has many
due. The saving in calls a day is therefore small, and the honest wins are these:

| Platform | Before | After |
|---|---|---|
| Instagram | 2 `/insights` per look (counts, then the full list again) | 1: the full list once, `insights` reuses it |
| X, YouTube, TikTok, Reddit | 1 per post | 1 per platform per pass (X timeline with `since_id`; 50, 20, 100 ids a call) when posts coincide |
| Facebook | 1 per post | 1 `/{page}/posts` read (100 posts, same fields) when posts coincide; a video's own id is not in that listing and is read alone |
| LinkedIn, Threads | 1 each | 1 each: browser stats per post, no batch call |

### Reddit reach reads

Prod, 2026-10-15: `reddit-public`'s 400 reads were gone by 08:00 UTC. 291 were user reads from
`wren:reach`: 175 `about`, 59 `submitted`, 59 `comments`. Thread drafting (`/comments/{id}`) then
fell back to the account's browser leg at 90 to 560 s a read.

| Read | Before | After |
|---|---|---|
| A person's posts and comments | 2 (`submitted`, `comments`) | 1 (`overview`, 20 things) |
| A person's card | 1 each | `user_data_by_account_ids`, up to 100 ids a read, when a listing showed their ids |
| A card Reddit answers 403 | 1 per person, and the whole read failed | asked once a run; the person is read without it |
| Thread reads | share the 400 | own bucket: `reads` 240, `threads` 160 |

Probable reason `about` beat the others (not checked live): signed out, a user's card has no
feed twin and answers 403 (autobrowse `site-api` card). Each failed person read burned its three
reads, then came back next pass, since a failed read stores nothing. Now the person is stored
without a card (30 days fresh), so the retry stops too.

Batching needs ids. `find` keeps each author's `author_fullname`, and `learn()` takes more. The
discovery loop reads its listings in `reads.ts` (not touched), so it learns nothing yet: one
`asPeople.learn(...)` after `latest()` there turns the batch on. Signed out, feeds carry no ids
either, so the batch waits for `.json` or a signed-in reader.

## API

```ts
// packages/core/src/content/index.ts, ContentChannel (both optional)
metricsMany?(posts: { id: string; kind?: string | null }[]): Promise<Metrics[]>;
commentCounts?(ids: string[]): Promise<Record<string, number>>;
```

`Content` gets two handlers, `metricsMany` and `commentCounts` (up to 100 ids). Each answers `null`
when the channel has none. Any failure in either is terminal, so the caller falls back at once
instead of retrying a read that only saves calls. No schema change. Object state of `SocialWatch`
gets `counts` and `fullReads` beside `reads`; `reads` now means last checked (read, or count held).
`SocialStats.skipped` counts due posts left unread.

autobrowse needs no new route. `youtube/v3/{resource}` passes any query, `meta` `/{pageId}/posts`
and `/{igUserId}/media` take `fields` and `limit`, `/api/info` takes a comma list, `video/query`
takes 20 ids, and `x/posts` takes `since_id` and `max_results`. None of these new read shapes was
run against a live platform; the first prod passes are the check.

## Calls made

- LinkedIn comments get their own cadence: 2 h young, 8 h old (was every pass, then every 2 h).
  Its page read is capped at 60 a day, so the old cadence spent the cap in the morning and read
  nothing after. The cost: a LinkedIn comment can wait up to 2 h in the morning instead of 30 min.
  The tab watcher pushes activity and DMs, not a post read, so it does not close that gap. William's
  call: revert with one line in `EVERY` (`store.ts`) if 30 min matters more than the afternoon.
- Sweeps, not trust: every post is read in full now and then.
- X metrics come from the timeline, not `/2/tweets/{id}`. A video still reads its API leg in
  `insights`.
- Instagram `metricsMany` asks the kind's full metric list once. A refused metric falls back to
  the old counts read plus `insights`' per-metric path.

- A card Reddit closes (403) no longer fails the person read: `raw.about` is null, so age is
  unknown and karma reads 0 in `personFacts`. Other card failures still fail. Revert: drop the
  `closed` catch in `cardOf` (`channel-reddit/src/outreach.ts`).
- The 400 a day is unchanged; thread reads just can't be spent by profile reads. 160 is a guess
  at drafting's need; change `caps` in autobrowse `src/sites/reddit.ts`.

## Not changed

- YouTube Analytics (4 to 5 calls a look, cap 1000, well under). Batching by `dimensions=video`
  needs a live check on which reports allow it.
- Instagram `ids=` multi-fetch or nested `insights` expansion: needs a new autobrowse route, and
  Reels and feed posts refuse each other's metrics in one call.
- Threads: no batch or count endpoint.
- Email: Gmail is push plus a 30 min net; Instantly inboxes poll at the net (`push-not-poll`).
  Opens (2 min) and clicks (hourly) read our own hosts from a cursor.
- Reddit discovery listings: done in `7712f321`. `reads.ts` still reads `/r/{sub}/about` and
  `/about/rules` per place (30-day fresh, not part of the 175 user `about` reads).
- Meta ads: one daily pass.

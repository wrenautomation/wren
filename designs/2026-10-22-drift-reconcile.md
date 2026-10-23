# Drift reconcile: the site is the truth

2026-10-22. William: "should have a anti drift thing, sometimes things happen manually on the sites. should backfill data" and "should apply to all platforms".

## Problem

Wren records only what wren does. A connection, post, follow or comment made by hand on a site never reaches wren. LinkedIn showed 19 connections; wren showed 8. The other 11 were made on the site. 4 invites also sat at `unknown` (send lost), and accepts got the sweep's time, not LinkedIn's day.

## Target state

One reconcile per (platform, account, kind). Each kind names four things:

| Part | Is |
|---|---|
| lister | the site route that lists the account's own things, and its most rows |
| key | the wren table and the key it matches on |
| backfill | insert what wren lacks, marked as from the site; no draft, no sequence, no send |
| drift rule | what a mismatch means: fix a field, or notify a person |

It runs in the loop that already owns that platform, inside its caps. Output is counts. A note goes out only when a person must act (a mismatch left after the backfill = a bad read).

A partial list (as many rows back as asked) holds only the newest. Absence in it says nothing. Only a whole list says who left.

## Kinds

| Kind | Platforms with a lister | Wren side | State |
|---|---|---|---|
| connections | LinkedIn `/connections` (200) | `reach_contacts` (platform, handle) | **built** (this doc) |
| follows | X `GET /2/users/me/following` (autobrowse da396a7: the signed-in Following page; the free API has no follows); Reddit `/subreddits/mine/subscriber` (users as `u_<name>`); YouTube `subscriptions?mine=true`; Instagram `/web/following`, TikTok `/web/following`, Threads `instagram /web/threads/following` (autobrowse a241122: desk-browser reads) | touches `follow` ours, source `following` | all six **built** (section below) |
| own posts | `Content/list`, 100 newest: X user tweets, IG media, TikTok video/list, YouTube uploads, Threads, Reddit submitted; Facebook Page posts (a video post lists as its video's id, the id publish keeps). LinkedIn `/rest/posts` refuses today (501: no desk workflow yet) | `content_drafts.published_id` (`canonRef`) | **built** (section below) |
| own comments | Reddit `/user/<me>/comments` (+ `/api/info` for a reply's author); X replies not yet (the page leg reads no replies) | touches `comment`/`reply` ours, source `own_comments`; never the `comments` table (an inbox) | Reddit **built** |
| DMs | LinkedIn `/messaging`, Meta conversations | `reach_messages` | the reply watch reads these already |

Every site shows its own following list. Instagram, TikTok and Threads keep it out of their official APIs, so a desk-browser flow reads each page. Instagram calls the page's own friendships JSON. TikTok and Threads scroll the profile's Following dialog through one shared reader. Threads runs on the instagram site, because Threads signs in through Instagram. One read a day each, under the account's caps.

## Posts and comments (built)

`SocialWatch` runs three site reads once a day per platform (`SITE_EVERY_MS`, one `daily` helper): follows, posts, comments. A read that fails goes in `missed`, never `errors`: it asks again the next day.

Posts (`keepSitePosts`):

1. Each listed id becomes its `canonRef`. A ref a draft has, or a `site:<platform>:<ref>` idea has, stays as it is.
2. A lost send (`publishing`, `failed`, or published with no id, last 60 days) whose opening 60 characters match the listed post is that post: `markPublished` stamps it (`settled`).
3. Each other post becomes a `site` idea and a draft (`promptVersion` `site`, `edited`), stamped by `markPublished` (by `site`): the one publish write path, so the object row, first variants and draft record come with it.
4. `ContentMetrics` then reads it like any post (`metricsDue`: published, with an id, in the watch window). No second reader.
5. `PublishedRow` now carries `text` and `title` where the list read has them, so the draft holds the whole words. TikTok's list gives its caption as `title` only.

Comments (`keepOwnComments`):

1. A comment id an ours touch, a thread's answer (`reddit_threads.answer_ref`: a karma-place answer stays touch-free) or an inbox answer (`comments.answer_ref`) has stays as it is.
2. Each other comment becomes an ours `comment` (`reply` on a comment) touch toward the post's or the comment's author: account `wren`, ref `oc:<platform>:<id>`. A deleted author or our own is skipped.

### Facebook (fixed 10-22)

The Page read was not an expired token. Three faults:

1. Page posts, videos and photos read with the user token (Graph 190). autobrowse now reads them with the Page token: `/{pageId}/posts`, a `<pageId>_<n>` object, or any object given `pageId`.
2. A post's likes, comments and reactions need `pages_read_user_content`. The Meta consent now asks for it (re-run 10-22). Wren's own Page reads its comments too.
3. Meta retired `post_impressions`. Views read `post_media_view`. A video has no post insights: it reads `views`.

## Follows (all six built)

`ContentChannel.following()` lists every account ours follows. `SocialWatch` reads it once a day per platform (`SITE_EVERY_MS`), in the same pass as activity.

1. `keepFollowing` normalizes each handle.
2. A handle with an ours follow from any writer stays as it is.
3. Each other handle becomes an ours follow touch: account `wren`, source `following`, ref `fo:<platform>:<handle>`. Its time is the platform's (YouTube gives one) or the read time.
4. `gone` counts handles an earlier list had and this one has not (unfollowed on the site). Nothing is deleted. The pass shows it in `unfollowed`. `gone` assumes the list fit under the reader's cap (1000 on each site); a follow wren made and the site lost is not counted yet.
5. The touch feed tells the spine each new touch with its `source`, so a journey can skip `following` (old follows read back).

## LinkedIn connections (built)

`sweepInvites` (ReachWatch, every 6 h) now:

1. Reads `connections(200)`: handle, name, url, headline, `connectedOn` (the card's "Connected on" day).
2. Backfills unknown handles as contacts, `found_in = 'linkedin connections'`.
3. Marks every contact in the list `connected` on the site's day, never before our invite went out. `replied`, `opted_out`, `blocked` keep their state.
4. `accepted` = connected with our invite; `byHand` = the rest. Only `accepted` makes the "accepted invites" note.
5. Reads the relationship of up to 5 lost (`unknown`) invites: pending or connected = `sent`; none = `failed`, contact unreachable.
6. Whole list: counts site against wren. A mismatch past who left goes in the note as an error.

A connection without our invite (`invitedSql`) gets no "just accepted my invite" draft, no invite record, and no model first message. It stays DM-able by hand.

Not done: a touch for a hand-made connection (who asked first is unknown).

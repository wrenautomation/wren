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
| own posts | LinkedIn `/rest/posts`, X user tweets, IG media, Page posts, TikTok video/list, YouTube uploads, Threads, Reddit submitted | `platform_objects` via `resolveObject`, `content_drafts` | next: first find where the analytics readers land; a flag on that reader, never a second reader |
| own comments | Reddit `/comments`, X replies | `comments` | later |
| DMs | LinkedIn `/messaging`, Meta conversations | `reach_messages` | the reply watch reads these already |

Every site shows its own following list. Instagram, TikTok and Threads keep it out of their official APIs, so a desk-browser flow reads each page. Instagram calls the page's own friendships JSON. TikTok and Threads scroll the profile's Following dialog through one shared reader. Threads runs on the instagram site, because Threads signs in through Instagram. One read a day each, under the account's caps.

## Follows (all six built)

`ContentChannel.following()` lists every account ours follows. `SocialWatch` reads it once a day per platform (`FOLLOWING_EVERY_MS`), in the same pass as activity.

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

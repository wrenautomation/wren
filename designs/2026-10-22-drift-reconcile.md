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
| follows | X `/2/users/me/following` | touches `follow` ours | next: `backfillOutreachTouches` pattern |
| own posts | LinkedIn `/rest/posts`, X user tweets, IG media, Page posts, TikTok video/list, YouTube uploads, Threads, Reddit submitted | `platform_objects` via `resolveObject`, `content_drafts` | next: first find where the analytics readers land; a flag on that reader, never a second reader |
| own comments | Reddit `/comments`, X replies | `comments` | later |
| DMs | LinkedIn `/messaging`, Meta conversations | `reach_messages` | the reply watch reads these already |

No lister, so no reconcile: IG following, YouTube subscriptions, TikTok, Threads and Reddit follows. We do not emulate one.

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

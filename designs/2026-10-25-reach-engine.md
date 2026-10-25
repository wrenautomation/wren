# Reach engine (2026-10-25)

William: tighten reach. Fewer round trips, more data per action, and a system that makes all the
platform busywork (comments, invites, follows, likes, DMs) by itself.

## Now (7 days to 10-24)

Platform calls come from autobrowse's call ledger (`~/.config/autobrowse/caps-calls`). Outputs come
from `touches`, `reach_posts` and `reach_messages`.

| | Calls a day | Our actions in 7 days |
|---|---|---|
| Reddit (reach is parked) | 393 | 7 comments and replies |
| LinkedIn reach | 41 | 118 invites, 11 comments, 8 likes |
| LinkedIn content (our own posts) | 184 | |
| X, Instagram reach (inside content and reach) | about 60 | 7 X follows, 15 IG follows, 0 comments |
| YouTube, TikTok, Threads, Meta learn | 240 | |
| All | 1,074 | about 165 (24 a day) |

What the numbers say:

1. **A parked platform takes the most calls.** The 2 reach accounts (reddit@wren, reddit@alt)
   each read the inbox and `/api/v1/me` about 45 times a day on the 30-minute cold cadence.
   Content reads William's own inbox about 64 times a day. Reddit is 37% of all calls for 1
   action a day.
2. **Per-item reads.** LinkedIn post metrics read one post per call: 94 calls a day, and 656 of
   them failed in 7 days (capped, paced or refused). X reads one account per call
   (57 a day).
3. **Search reads the wrong people.** LinkedIn reach read 640 posts. 298 did not name the trade,
   101 were job ads, 191 ranked under fit 70. 46 reached fit 70 and 11 got a comment (2%). X read
   88 and kept 0. Instagram read 25, all too old.
4. **Invites stall on a filter, not on people.** 58 untouched recruiting decision-makers have a
   LinkedIn page. The size floor (50+, known size only) holds all 58: 26 have no known size, 32
   are under 50. Agencies (18 more) is not in the invite niches. 148 invites wait; 29 accepted
   (16%).
5. **Follows and likes sit unused.** 22 follows and 8 likes in 7 days, against caps of 20 to 40
   a day each.
6. **The facts guard drops true drafts.** It wants one fact to back a whole sentence. A sentence
   with two true clauses ("I founded Wren and I run its outreach") fails. In 14 days it dropped
   16 content drafts, 38 Reddit drafts and 11 DMs. 13 of 16 accepted invites have no DM draft,
   and `draft_at` blocks a second try.

## Target

The unit of reach is a **person**, not a post. One graph of chosen people per platform, three
stages per pass, and one read per surface per pass.

```
Grow   firms -> people (company people page, 30 a load) -> follow + invite, auto, under caps
Read   one feed read per platform, scrolled deep: posts only from people we chose
       one inbox/notifications read per platform, shared by every loop
       keyword search only to find new people; a good author joins the graph
Act    likes: auto       follows, invites: auto
       comments, DMs: drafted, wait for William's yes
```

Why the feed: a search returns strangers: 425 of 640 dropped. A feed returns the people we picked by
firm and title, so the rank works on fit, not on noise. One feed load holds 20 to 50 posts from
many people. Today each account read is one call.

Why follows lead: an invite waits for a yes (16% so far). A follow does not. Each follow puts that
person's posts in the feed the next pass.

### The rules

- **One read per surface per pass.** An inbox, notifications page or feed is read once, and
  every loop (content, reach, health) uses that read. No loop polls on its own clock.
- **Batch or skip.** A per-item read (metrics, profile, account posts) goes through a batch
  route where the platform has one. Where it has none, the item waits for the next list read
  that holds it.
- **Back off on empty.** A read that returns nothing new doubles its interval, to a ceiling.
  New items reset it.
- **Parked means silent.** A parked platform makes no reads.
- **Every action writes a touch** (`social touches`), through the shared helpers.

## Phases

**Phase 0: bugs (build now, no design choice).**

- Facts guard per clause. Split a sentence at ", ", "; ", " and I ", " but ". Each clause needs
  its own backer. The deed check stays. Synthetic tests in `grounded.test.ts`.
- Redraft path for accepted invites with `draft_at` set and no draft.
- Reddit: reach inboxes read every 2 hours at most (`READ_FLOOR_MS`), and replies use the known
  handle, so no `/api/v1/me` read per pass. About 70% fewer reach calls.
- Post metrics: a capped read holds that platform's one-by-one reads until the cap resets
  (`capHolds` in the loop's state). The other posts are skipped, not failed.
- A draft kept as none (guard drop, empty, too long) gets one more try every 3 days.

**Built 10-25: auto likes and follows.** Each posts pass likes fit posts (`minFit`, not dropped,
7 days at most) and follows their authors, with no yes. At most 5 of each per pass, per platform,
under autobrowse's day caps (LinkedIn 30 likes / 20 follows, X 50/20, Instagram 40/15). One author
is followed once. A used cap holds that act in ReachWatch's `actHolds` till the reset. At today's
supply this is about 3 to 4 acts a day on LinkedIn and none on X or Instagram: volume comes from
Phase 1.

**Phase 1: Grow.** Supply from `/company/{company}/people` (in channel-linkedin already). Firms
with a LinkedIn company page go first. Auto follow on LinkedIn, X and Instagram under caps, then
invite. Fewer than 1% of recruiting firms hold a LinkedIn company page today, so the people
search by firm name (`/search/results/people`) is the fallback.

**Phase 2: Read.** Three new autobrowse routes, each one load scrolled deep:

| Platform | Route | Leg | Meter |
|---|---|---|---|
| LinkedIn | `GET /feed` | browser | `feed` |
| Instagram | `GET /web/feed` | browser | `feed` |
| X | `GET /2/users/{id}/timelines/reverse_chronological` (flow `x/home`, the Following tab) | browser | `feed` |

All three need a walk on the desk's Chrome. X keeps the API's path with `prefer: "browser"`, as
every X read does. Promoted rows are left. X account reads use the browser leg today
(`prefer: "browser"`), so they cost $0. The API timeline bills each post read, so it costs more
than the reads it replaces: not built (decision 3).

**Phase 3: Act.** Search narrows to finding new people (one search a
pass per platform). Keyword drops stop counting against the day.

## Out

- Reddit reach stays parked: 1,676 ranked posts wait with no draft.
- YouTube reach.
- Paid people data (Exa bulk): spend.

## Decisions (William, 10-25)

1. Follows and likes: auto, no yes.
2. Invite filter: the 50+ floor stays on. Make the filter settable.
3. X home timeline: only if it costs no more than the account reads it replaces. Result: the API
   costs more than the free browser reads, so X gets a browser feed walk like the other two.
4. Feed walks: the session records them on the desk's Chrome.
5. LinkedIn invites: send with no note. Accepted invites get no DM draft for now; they wait in
   the backlog for William.

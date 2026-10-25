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

1. **A parked platform takes the most calls.** Reddit reach and Reddit content each poll the inbox
   and `/api/v1/me` about every 13 minutes: 108 + 51 inbox reads and 107 `me` reads a day. Reddit
   is 37% of all calls for 1 action a day.
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
- Reddit: no reach or content polls while reach is parked. One shared inbox read with backoff
  for the rest.
- LinkedIn metrics: skip a post the cap refused until the next day, not the next pass.

**Phase 1: Grow.** Supply from `/company/{company}/people` (in channel-linkedin already). Firms
with a LinkedIn company page go first. Auto follow on LinkedIn, X and Instagram under caps, then
invite. Fewer than 1% of recruiting firms hold a LinkedIn company page today, so the people
search by firm name (`/search/results/people`) is the fallback.

**Phase 2: Read.** Three new autobrowse routes, each one load scrolled deep:

| Platform | Route | Leg | Meter |
|---|---|---|---|
| LinkedIn | `GET /feed` | browser | `feed` |
| Instagram | `GET /web/feed` | browser | `feed` |
| X | `GET /2/users/{id}/timelines/reverse_chronological` | API | `posts` |

The X API bills by item read, so the timeline costs about what the account reads cost now, for
fewer calls. The LinkedIn and Instagram flows need a recorded walk on the desk's Chrome.

**Phase 3: Act.** Likes on fit posts go auto. Search narrows to finding new people (one search a
pass per platform). Keyword drops stop counting against the day.

## Out

- Reddit reach stays parked: 1,676 ranked posts wait with no draft.
- YouTube reach.
- Paid people data (Exa bulk): spend.

## Decisions for William

1. Auto follows and likes, no yes. They are public actions with no words.
2. Invite filter: drop the 50+ floor or allow unknown size; add agencies to the niches.
3. The X home timeline on the API: it bills per post read.
4. Record the LinkedIn and Instagram feed walks on the desk's Chrome.

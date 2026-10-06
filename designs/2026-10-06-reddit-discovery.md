# Reddit discovery and enrichment (2026-10-06)

William, 10-06: "also might need reddit enrichment as well. and well thought out things for
locating relevant subreddits threads, and posts for the comments. that requires reasoning and
potentially research."

## Answer first

Three read loops. All free. Nothing posts without his click.

1. **Places** (monthly): find subreddits where our buyers ask questions. A model reads each
   one's about, rules and a sample of posts, and says how well it fits and what the rules
   allow. William picks which to watch and which of our accounts works each one.
2. **Threads** (every 2 hours, watched places only): new posts, filtered in code, ranked by a
   model. The day's best go to Marketing → Threads with an angle and a draft in his voice. He
   edits and clicks; it comments from that place's account under the rung's caps and the
   thread guard. Replies come back through the comments source built today.
3. **People** (on demand): a Reddit profile read into who the person is: role, business, site,
   fit, each fact quoting their own words. For commenters on our posts, OPs of queued threads,
   and DM contacts.

Research happens per draft: the whole thread, the OP's profile, and our own facts. All reads go
through a logged-out profile, never through our two accounts.

## Places

- **Audience, a setting per client:** a description of who we talk to, the topics it implies,
  and subreddits William names. The model proposes topics from the description once; he edits
  them. Wren's today: "medium-sized businesses that charge a lot per client" (agencies,
  consultancies, recruiters, B2B services, clinics and firms like them).
- **Candidates (free):**
  - Reddit's `/subreddits/search?q=<topic>` (new autobrowse route).
  - Search pages: Google by browser, Exa within its free credits, `site:reddit.com <topic>`;
    subreddit names come from the result URLs.
  - Co-occurrence: subreddits where the people we read (People) also post.
- **Read per candidate:** `/r/{sub}/about` (new route: subscribers, active, description,
  type), `/about/rules`, 25 top posts of the week and 25 new.
- **The model judges** (one call per subreddit):
  - fit 0-10: do people like our buyers ask questions here that our work answers;
  - rules in plain words: comments, posts, links, flair, karma or age minimums, and three flags
    (may comment, may post, profile link only);
  - pace: posts a day, median comments per post;
  - why, quoting titles from the sample.
- **Stored:** `reddit_places`, unique on subreddit. It holds the raw about, rules and sample,
  plus stats, fit, why, the rules summary, `state` (found, watching, skipped), `account`, and
  `read_at`. Re-read monthly, with rule changes diffed and flagged.
- **William picks** in Marketing → Places: Watch or Skip. Nothing is watched until he picks.
- **Accounts:** a small pool whose job is building karma. Each watched place gets one account,
  so two of ours never meet in one subreddit. Watch picks the pool account with the fewest
  places whose rung the place's karma minimum allows; he can move it. A new account joins the
  pool when he adds one to reach.

## Threads

- **Read:** every 2 hours per watched place, `/r/{sub}/new?limit=50`. A big subreddit also gets
  `/r/{sub}/search?q=<topic>&sort=new&t=day` per topic. Every post is kept raw in
  `reddit_threads`, unique on post id.
- **Code filter ($0).** A thread is dropped when it is:
  - over 24 hours old, or past 40 comments (late comments sink);
  - locked, archived, removed, stickied or NSFW;
  - written by one of our accounts, or already holds one of them (the thread guard);
  - in a place whose rules forbid comments.
- **The model ranks** the survivors, 10 per call:
  - kind: asks for help, asks for tools, shares a story, venting, hiring, other;
  - fit 0-10: can we say something concrete from what we built or did;
  - angle: one line;
  - target: the post itself, or a top-level comment inside it that asks the question. This is
    the "thread inside the post".
- **Queue:** the top N a day go to Marketing → Threads, where N is the place's account comment
  cap (3 a day on the comment rung). Each comes with a draft in his voice, written with
  content's `voice.ts` and Reddit rules: no links, no pitch, at most 4 sentences, concrete.
- **Send:** he edits and clicks Comment. It posts through `/api/comment` from the place's
  account, under the rung's cap, and the thread guard is checked again at send. Replies to it
  arrive as `comment` events (built 2026-10-06).
- **Learn:** the comment's score and replies are read after 2 days. Each place's hit rate feeds
  its fit.

## Research, per draft

This runs for a thread he opens, and for the day's top 5:

- the whole thread (`/comments/{id}`), so the draft adds something new;
- the OP (People);
- our own facts: designs and SOPs matched by topic, with a local text search ($0);
- Exa only when the thread asks a factual question we don't hold (free credits, off by default).

The sources show beside the draft.

## People (Reddit enrichment)

- **Read:** `/user/{name}/about`, plus the last 100 posts and last 100 comments: 3 reads. Kept
  raw in `reddit_people`, unique on handle, re-read after 30 days.
- **Code facts:** account age, karma, subreddits by count, domains they linked, and active hours
  (a rough timezone).
- **Model facts** (one call): role, business type, size, location, website, what they struggle
  with, and fit 0-10. Every fact quotes the comment it came from, as studies do.
- **Links:** a domain they call their own ("my agency, x.com") becomes a person link to the firm.
  It is never guessed.
- **Who gets read:**
  - commenters on our posts;
  - OPs of threads in his queue;
  - DM contacts.

  Never a sweep of a subreddit's users.
- **Used by:**
  - comment sort (a fitting commenter ranks first);
  - thread rank (OP fit);
  - the DM draft;
  - the Replies row ("runs a 10-person agency").

## Read identity and pace

- **Logged out:** every read goes through a logged-out desk profile, `reddit@public` (like
  `fb-public`). Our accounts only post, comment and read their own inbox. Read volume on a
  logged-in account is what Reddit flags. Logged out, the only cost is the rate limit.
- **Pace:** 1 read every 6 seconds, at most 400 reads a day.
- **Estimate:**
  - places: about 150 reads a month;
  - threads: 15 places × 12 passes = 180 a day;
  - research: 10 a day;
  - people: 60 a day.

  That comes to about 260 reads a day.
- **Unproven:** old.reddit.com logged out from the Mac's IP. It is proven before anything is
  built on it.

## Cost

$0. About 30 model calls a day, batched, on the `claude-code` login or Cohere credits. About 300
Restate steps a day, roughly 9k actions a month of the free 100k.

## Posts

William writes the posts. Places gives him what he needs for each: whether posts are allowed,
flair, karma or age minimums, the place's pace and its top posts of the week. A post goes out
through the content channel (`channel-reddit`) from the place's account, on his click.

## Not built

- Auto-commenting.
- Writing posts for him.
- Sweeps of a subreddit's users.
- Paid tools (GummySearch and the like). Pushshift is gone.

## Overlap: radar

The radar (feeds scored against our SOPs, in the Watch) is ours too. It reads to learn; this
reads to find places to talk. Nothing is shared.

## Build order (after his answers)

1. autobrowse: `/subreddits/search`, `/r/{sub}/about`, and the `reddit@public` profile, with a
   logged-out read proven first.
2. People (the smallest piece; today's comment sort uses it).
3. Places, with Marketing → Places.
4. Threads, with Marketing → Threads and drafts.
5. Research per draft.

## Decision log

- 2026-10-06: Proposed. Waiting on decisions 1 to 5.
- 2026-10-06: William's answers. (1) Logged out. (2) The audience is a setting per client;
  Wren's is medium-sized businesses that charge a lot per client. (3) Drafts in his voice that
  he edits. (4) One account per place, but the point is a few accounts building karma; my call,
  so Watch spreads places across a small pool. (5) Yes, read OPs. He also writes the posts
  himself, so Places shows what a post needs and posts go through `channel-reddit`.

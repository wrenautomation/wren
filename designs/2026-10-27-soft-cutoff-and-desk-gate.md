# Soft age cutoff and the desk gate (WA-895)

## Goal

- A post worth a comment two days on still gets one. A fixed 72-hour cut dropped it.
- An offline Mac costs one quick ask a pass, not ten-minute waits per platform.
- Each job type merges the way its kind allows: syncs merge, discovery merges, writes never do.

## The three job types

| Type | Examples | When missed | Built where |
|---|---|---|---|
| sync | inbox replies, thread reads | merges: the next read sees all of it (unread state, a whole thread merged by ref) | already so: `pullReplies`, `mergeReads` |
| discovery | post search, pages, feed | merges: the next search reaches back to the guard | `postsPass`, this change |
| write | comment, like, follow, DM | unique: keyed once, checked again before it lands, paced | already so: `sendAtMostOnce`, `stillDue`, the desk's caps |

No new queue was built. Restate already holds the work, and the three rules already hold, except the two below.

## Decision 1: how a post's age counts

Options:

1. Fixed window (what it was): drop past `maxAgeHours`, freshness falls linearly to 0. Simple. Drops a viral post the day it still pays.
2. Half-life with momentum (chosen): timing points fade on a per-platform half-life; pace (engagement per half-life so far) adds points. A guard of 4 half-lives still drops dead posts.
3. A learned model of comment yield by age. Best in theory. No data yet: too few comments to fit.

Priorities, in order: a late viral post is kept; one rule for all platforms; no new data needed.
Option 2 meets all three. Option 3 waits on data.

Built:

- `halfLifeHours` per platform: X 8, Threads 12, Instagram 24, LinkedIn 36, TikTok 168, YouTube 720.
- `maxAgeHours` stays (the guard, default 4 half-lives, up to 8760). The name stays: the settings schema is strict, and a rename resets every platform's block.
- `momentum` gives 0 to 14 points, the same as the old freshness 6 + engagement 8, so `minFit` 70 keeps its meaning. More than 150 comments costs 1 point, more than 500 costs 2: a new comment there is buried.
- `postsToDraft` counts timing points again at the post's age now. A post that went quiet sinks.
- The send deadline is the guard, or one half-life after we found the post, whichever is later.
- Search reaches back to the guard: past-24h, past-week or past-month.

Prod rows may hold `maxAgeHours: 72`. Set each platform with `reach posts set --half-life-hours --max-age-hours`.

## Decision 2: what happens when the desk is off

Options:

1. Per-unit strikes only (what it was). A down platform is marked slow after 2 timeouts, so it takes no holds. But each pass waits 2 × 10 minutes per platform, and marks every read done with nothing read.
2. One ask before the pass (chosen): `answers` asks the desk's `status` (a registry read, no browser) with a 1-minute limit. No answer: no reads, nothing marked read, drafts still run, asked again in 10 minutes.
3. A real queue: park each read as a job, replay on reconnect. More moving parts for the same result, since reads are already idempotent by type.

Priorities, in order: no false holds; no lost reads; least new code. Option 2 meets all three.

The helper is in `@wren/core/restate` (`answers`). Only `ReachWatch` uses it now. `SocialWatch` can use it next.

The three open `unit_holds` (6, 7, 8) are not from an offline Mac. Each is a route that hung while its platform answered other calls. They stay held.

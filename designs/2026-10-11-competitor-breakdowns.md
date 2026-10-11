# Competitor breakdowns

2026-10-11. From a reel in William's notes: a dashboard that pulls competitors' reels each
morning, tags each by hook style, breaks the script into beats, keeps the CTA and the numbers.
"We kinda have this already with our SOP generation, but formalizing it and attaching it to our
UI would be cool."

## What we had

Learn follows creators (Instagram, X, TikTok), reads each reel's transcript on the Mac and scores
it against the SOPs. It dropped the numbers Instagram already returns and never asked how a reel
was made.

## Decision

- **Numbers:** a followed post keeps `items.stats` (likes, comments, views when the platform gives
  them) and `stats_at`. Each creator pass refreshes them on posts seen before
  (`onConflictDoUpdate`, `xmax = 0` keeps "added" to new posts). Instagram gives likes and
  comments, not views; TikTok gives all three.
- **Breakdown:** `learn.breakdowns`, one row a reel or video, written right after its score by
  the same judge (a client's on its own allowance). Hook style from a fixed set of 12, the hook
  line, why it works, topic, format, 3 to 8 beats with times, CTA kind and the ask.
- **Fixed styles, not free tags:** reels only group if the set is closed. `other` catches the
  rest; a style earns a slot when `other` fills up.
- **Reach:** views when given, else likes plus comments, so Instagram and TikTok rank in one list.
  Not comparable across platforms in absolute terms; good enough to rank within a creator set.
- **UI:** Learn → Competitors (overview: counts, median reach, hooks that reach, best reels),
  Reels (every breakdown; views Best reach, Newest, Followed, Comment a word), Hooks (each style:
  reels, creators, median and best reach).
- **Backfill:** `wren learn breakdown [ids] [--limit n]` for reels read before this.

## Why not

- **Apify for scraping:** autobrowse's Graph `business_discovery` and yt-dlp already read the
  creators, free.
- **A separate spine step:** one more port for a call that always follows the score. It lives
  in `scoreItem`; a retry after a thrown breakdown does the breakdown alone.

## Code

`packages/learn/src/breakdown.ts`, `schema.ts` (`breakdowns`, `breakdown_records`,
`hook_records`, `items.stats`), `creators.ts` (`statsOf`), `records.ts` (`learn.breakdown`,
`learn.hook`), `apps/cli/src/learn.ts` (`breakdown`), portal `modules/learn/index.ts`.

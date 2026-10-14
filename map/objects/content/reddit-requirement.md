---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-14 @ 9a0bce5f (reddit gates build)
entity: packages/outreach/src/schema.ts:587
---

# reddit-requirement (what a subreddit asks of an account before our comment stays up)

A sub's karma, account age and unknown-gate record. A comment in a sub we don't qualify for stays queued with the reason ("r/X needs 50 karma, reddit@alt has 1"), is never sent and never dropped, and goes from the other account when only that one qualifies.

## Why this shape

2026-10-14 (`designs/2026-10-14-reddit-gates.md`): AutoModerator removed our comment in r/SalesTechniques (10+ days old, 50+ karma) and both accounts had about 1 karma. William: queue it, don't spam, until we meet the requirements.

## Shape

- Table `reddit_requirements` (`packages/outreach/src/schema.ts:587`, migration 0255): pk (`subreddit`, `source`); `source` removal|rules|manual; `min_age_days`, `min_karma`, `min_comment_karma`, `other` (a gate we can't count, shown only), `hold` (removal that stated nothing), `item` (the proof it came from), `evidence`, `cleared_at`. FK to `reddit_places` cascades. 0255 seeds r/salestechniques where the place exists
- Learning (`packages/outreach/src/discovery/requirements.ts`): `parseNeed` (days, weeks, months; total vs comment karma; post karma and verified email go to `other`), `learnFromProof` (called by `keepProof`: hidden or missing with numbers sets the floor, without sets `hold`, live lifts a hold from the same item), `keepRulesNeed` (called by `keepPlace`: the model's `karmaMin`/`ageMinDays` and rule lines about comments), `setNeed`, `learnText`, `clearGate`, `backfillFromProofs`
- Why a removal states numbers: `modNoteIn` (`packages/core/src/content/proof.ts:124`) appends a mod's or AutoModerator's reply under our comment to a hidden or missing proof's note
- Standing: `standingOfAccount` reads the stored health (age, karma, `raw.comment_karma`); the watch pass refreshes it, so no new Reddit reads
- The gate: `gatesFor` (`:241`) and pure `decide` give `{ok, reason, accountId, switched}` per sub. Used by `planThreadComment` (`packages/outreach/src/discovery/threads.ts:456`, throws `ThreadHeld`), `scheduleThreads` via `applyGates` (`packages/outreach/src/scheduled.ts:118`: clears `send_at` of gated queued threads, moves a place to the account that qualifies), and the rows below
- Send: `commentThread` (`packages/outreach/src/restate/discovery.ts:441`): held with a slot returns `{ref: null, held}` and unschedules; held on a click is a terminal error carrying the reason
- Console: `marketing.thread` and `marketing.place` rows (`packages/outreach/src/records.ts`) carry `held`/`gate`; To approve and Engage show state Held (hover explains) and "Held because"; Places has a Held view; Engage a Held view (`packages/content/src/social/records.ts`)
- CLI `wren reach gates` (list with the gate now), `gates set r/X --days --karma --comment-karma`, `gates learn r/X "<words>"`, `gates clear r/X`, `gates backfill`

## Connected to

- **joins:** [[content/reddit-thread]] (the threads held), [[content/comment-proof]] (a removal teaches the floor)
- **joins:** reach accounts (`health` is the standing)
- **looks-like-but-is-not:** `PlaceJudged.karmaMin` (the model's reading of a place's rules; feeds the `rules` row)

## If you change this

- Not gated: `answerComment` (replies under our own comments)
- A hold lifts only on `gates clear` or a live check of the same comment
- A new comment path to Reddit threads must go through `planThreadComment`, or it skips the gate

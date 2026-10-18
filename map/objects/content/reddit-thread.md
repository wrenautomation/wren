---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-18 @ 83b009b9 (karma places)
entity: packages/outreach/src/schema.ts:414
---

# reddit-thread (Reddit discovery: places, threads, people)

New posts in subreddits William chose to watch, filtered in code, ranked by a model, the day's best queued with a draft in his voice. He edits and clicks Comment; it posts from the place's account. Places and people are the same loop's other two tables.

## Why this shape

William, 2026-10-06: reads logged out; the audience is a setting per client (Wren's: medium-sized businesses that charge a lot per client); drafts in his voice that he edits; a few karma-building accounts, one per place; read OPs; he writes posts himself. Reads go through autobrowse `reddit-public` (signed out, 400 a day, one every 6 to 9 s; since 2026-10-15 split 240 `reads` and 160 `threads`, so profile reads cannot starve thread drafting), so read volume never lands on an account. Facts the model reads off a profile must quote the person's words, or they're dropped.

## Shape

- `reddit_places` (`schema.ts:381`): subreddit pk; `found_by`, raw about/rules/sample, `judged` (fit, rules in words, may comment/post, karma and age floors, pace), `state` found/watching/skipped, `account_id` (one pool account per place), `read_at` (monthly), `threads_at` (every 2 h)
- `reddit_threads` (`:414`): post fullname pk; raw post, `dropped` (code's reason), `kind`/`fit`/`angle` (model), `target` (the post or a top-level comment that asks), `draft`, `sources`, `state` new/dropped/ranked/queued/commented/skipped, `answer_ref`, `score` (read back after 2 days)
- `reddit_people` (`:345`): handle pk (lowercase); raw reads, code `facts` (age, karma, places, domains, peak hour), model `read` (quoted facts), `fit`, `site` (only a host in their own words)
- Code: `packages/outreach/src/discovery/`: `reads.ts` (`signedOut`, `reader`: `searchPlaces` Reddit, `exaPlaces` Exa via `web /search`, `subredditsIn`), `places.ts` (`discoverySettingsSchema`, `topicsOf`, `judgePlace`, `keepPlace` flags rule changes, `accountFor`, `watchPlace`), `threads.ts` (`dropReason`, `rankThreads` (each pass ranks every unranked thread of the place, `unrankedThreads`, so one the model left out isn't stuck), `queueThreads` under the rung's cap, counted per account across all its subs (queued plus sent today), so the queue never outgrows what the account sends; `expireStale` skips any unslotted new or queued thread past 36 h in every sub, each pass, `draftThread` (the prompt carries Wren's facts, `factsBlock`; then the facts guard, `guardDraft`: made up twice is `dropped`, a `runs` row `guard`), `planThreadComment` (holds a sub whose karma or age rule we don't meet, [[content/reddit-requirement]]), `commentsToday`), `people.ts` (`personFacts`, `readWords`, `readPerson` 30-day fresh, `peopleToRead`: commenters on our posts and Reddit DM contacts)
- A person read (`channel-reddit` `enrich`, 2026-10-15): one `/user/{h}/overview` (posts and comments together) plus the card; `find` and `learn` remember `author_fullname` ids so the first card read takes up to 100 cards in one `/api/user_data_by_account_ids` read; a 403 on a card reads the person without one and is not asked again that run. The signed-out reader (`reader` with no account) reads no cards at all (`cards: false`): Reddit has refused every signed-out card read (`/user/{h}/about`, `/api/user_data_by_account_ids`) with 403 since 2026-10-13, and autobrowse spent a read on each
- Caps: a used daily cap (autobrowse's 429 with a wait of hours, `capWaitMs`) holds that reader until it resets, in the object's state `capHolds` (`reddit-public`, or an account), so no pass asks it again (2026-10-15). No error and no 6-hour sleep: while signed out is held, places, listings, people and scores wait; a draft reads its thread signed in as its account, a thread with no account waits. `place` lets a cap end the read instead of reading about and rules as unknown
- Karma places (designs/2026-10-18-reddit-karma.md): `reddit_places.purpose` reach/karma (migration 0293). Wren's pass upserts `KARMA_PLACES` (`addKarmaPlaces`), reads each signed in as one of ours (signed-out rules 403), judges without the audience, and `settleKarmaPlace` watches it when its rules allow us. Threads at most 6 h old with at most 15 comments, own listing (1 page every 2 h), newest first; `draftThread({karma})` writes a plain answer with no facts, and `pitchIn` (Wren, link, domain, "dm me") redrafts once, then drops
- Day caps (`roomFor`): the comment rung's 5 a day per account; under 50 karma reach places take at most `reachComments` (2), karma the rest. `planThreadComment` holds a third reach comment with `ThreadHeld`; `scheduleThreads` takes over-share reach slots off (`overShare`) and slots karma first. Days count in Toronto (`dayStart`). Thread hours 8 to 22 Toronto, every day (`THREAD_PACE`)
- Per client: `RedditReads/<c>/daily` on the client's own About (never Wren's default), into its database, reads metered on its `reddit` and `exa` vendors, model on `models`; posting a comment waits on its live flag
- Time limits: desk reads wait `LIMITS.desk` (the worker's `limitMs`); a signed-out read with no answer is noted and passed, held after three passes (`unit_holds`, stage `loop.reddit-reads/<key>`); two in a pass with nothing answered leave the rest of the pass's signed-out reads. The topics model call is cut at `limits.http` (2 min) a try, three tries; a miss retries the month's search next pass (`packages/outreach/test/integration/reddit-topics-limit.test.ts`)
- Loop: `RedditReads/wren` (`restate/discovery.ts:92`); desk handlers on `ReachDesk` (`discoveryHandlers`, `:259`): `watchPlace`, `skipPlace`, `movePlace`, `commentThread` (effect sends), `skipThread`. One pass on demand: `wren reach discovery run` (alias of `sync`) and Places/Thread replies → Read now (`RedditReads/wren/sync` through `ConsolePortal.call`); neither starts the loop
- Account per draft (designs/2026-10-15-accounts-first-class.md): a pick in `draft_accounts` (`thread:<id>`, `packages/outreach/src/draft-accounts.ts`) sends the comment from that account; it skips the numeric karma/age gate (warned on the picker, `warnOf`) but not a sub's hold. `movePlace` takes `{subreddit, account}`; Places edits the account inline, `wren accounts assign` from a terminal
- Paste: `ReachDesk.paste` (Outreach → Engage) watches a pasted subreddit, or reads a pasted thread signed out and queues it fit 10, angle "you pasted it" (`queuePastedThread`), then wakes `RedditReads/wren` to draft it
- Console: records `marketing.place`, `marketing.thread` (Outreach → Places, Thread replies); queued threads also wait in `marketing.engage`; component `reddit.discovery` (settings: about, topics, subreddits, floors, `exaSearches`, in `wren_settings` via `settingsFor(db, null)`)

## Connected to

- **joins:** [[content/reddit-requirement]] (a sub's karma, age or unknown-gate hold: the comment stays queued, none sent, or goes from the other account)
- **joins:** [[content/send-attempt]] (`commentThread` claims `thread:<id>` before sending; an unknown outcome is found on the site, sent once more, or waits in To approve)
- **joins:** [[content/comment-proof]] (each sent comment checked at 2 min, 1 h, 24 h: live, hidden or missing)
- **joins:** [[leads/touch]] (our comment is an ours touch `rt:<id>` on the OP, or a reply to the commenter who asked)
- **joins:** [[content/comment]] (replies to our thread comments come back as comments; one daily cap counts both, `commentsToday`; a comment's author is read into `reddit_people`, shown as "Who they are" and in Replies)
- **joins:** reach accounts (the pool; `warmupOf` sets each one's comments a day and its reach share, `reachComments`)
- **joins:** [[content/playbook]] (the SOP texts a draft reads, matched by shared words)
- **looks-like-but-is-not:** [[learn/item]] (`packages/learn`): those read to learn, these read to find places to talk
- **joins:** [[content/funnel]] (places pick a promo's subreddit; thread decisions become comment examples)
- `send_at` (migration 0243): the scheduler's slot; scheduling and our-posts sourcing in [[content/reach-post]]


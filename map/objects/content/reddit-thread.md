---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 42b1013e (facts guard: grounded-drafts)
entity: packages/outreach/src/schema.ts:414
---

# reddit-thread (Reddit discovery: places, threads, people)

New posts in subreddits William chose to watch, filtered in code, ranked by a model, the day's best queued with a draft in his voice. He edits and clicks Comment; it posts from the place's account. Places and people are the same loop's other two tables.

## Why this shape

William, 2026-10-06: reads logged out; the audience is a setting per client (Wren's: medium-sized businesses that charge a lot per client); drafts in his voice that he edits; a few karma-building accounts, one per place; read OPs; he writes posts himself. Reads go through autobrowse `reddit-public` (signed out, 400 a day, one every 6 to 9 s), so read volume never lands on an account. Facts the model reads off a profile must quote the person's words, or they're dropped.

## Shape

- `reddit_places` (`schema.ts:381`): subreddit pk; `found_by`, raw about/rules/sample, `judged` (fit, rules in words, may comment/post, karma and age floors, pace), `state` found/watching/skipped, `account_id` (one pool account per place), `read_at` (monthly), `threads_at` (every 2 h)
- `reddit_threads` (`:414`): post fullname pk; raw post, `dropped` (code's reason), `kind`/`fit`/`angle` (model), `target` (the post or a top-level comment that asks), `draft`, `sources`, `state` new/dropped/ranked/queued/commented/skipped, `answer_ref`, `score` (read back after 2 days)
- `reddit_people` (`:345`): handle pk (lowercase); raw reads, code `facts` (age, karma, places, domains, peak hour), model `read` (quoted facts), `fit`, `site` (only a host in their own words)
- Code: `packages/outreach/src/discovery/`: `reads.ts` (`signedOut`, `reader`: `searchPlaces` Reddit, `exaPlaces` Exa via `web /search`, `subredditsIn`), `places.ts` (`discoverySettingsSchema`, `topicsOf`, `judgePlace`, `keepPlace` flags rule changes, `accountFor`, `watchPlace`), `threads.ts` (`dropReason`, `rankThreads`, `queueThreads` under the rung's cap, `draftThread` (the prompt carries Wren's facts, `factsBlock`; then the facts guard, `guardDraft`: made up twice is `dropped`, a `runs` row `guard`), `planThreadComment`, `commentsToday`), `people.ts` (`personFacts`, `readWords`, `readPerson` 30-day fresh, `peopleToRead`: commenters on our posts and Reddit DM contacts)
- Per client: `RedditReads/<c>/daily` on the client's own About (never Wren's default), into its database, reads metered on its `reddit` and `exa` vendors, model on `models`; posting a comment waits on its live flag
- Loop: `RedditReads/wren` (`restate/discovery.ts:92`); desk handlers on `ReachDesk` (`discoveryHandlers`, `:259`): `watchPlace`, `skipPlace`, `movePlace`, `commentThread` (effect sends), `skipThread`. One pass on demand: `wren reach discovery run` (alias of `sync`) and Places/Threads → Read now (`RedditReads/wren/sync` through `ConsolePortal.call`); neither starts the loop
- Console: records `marketing.place`, `marketing.thread` (Marketing → Places, Threads); component `reddit.discovery` (settings: about, topics, subreddits, floors, `exaSearches`, in `wren_settings` via `settingsFor(db, null)`)

## Connected to

- **joins:** [[content/comment]] (replies to our thread comments come back as comments; one daily cap counts both, `commentsToday`; a comment's author is read into `reddit_people`, shown as "Who they are" and in Replies)
- **joins:** reach accounts (the pool; `warmupOf` sets each one's comments a day)
- **joins:** [[content/playbook]] (the SOP texts a draft reads, matched by shared words)
- **looks-like-but-is-not:** the radar's feeds (`packages/watch`): those read to learn, these read to find places to talk
- **joins:** [[content/funnel]] (places pick a promo's subreddit; thread decisions become comment examples)

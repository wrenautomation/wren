---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 9107a062 (reach targeting)
entity: packages/outreach/src/schema.ts:568
---

# linkedin-post (others' LinkedIn posts we comment on)

A post by someone else, found by the watch's daily read, ranked by code, and drafted for a comment in his voice. Up to `perDay` (10) a day wait in To approve with the post shown; only his Comment posts, from Wren's account. Built dark: off until `linkedin.comments` names an account.

## Why this shape

William, 2026-10-07: "10 comments a day on others' posts", all gated for his approval (`designs/2026-10-07-posting-flow.md` item 4). The first drafts made up stories and numbers and some posts were job ads, so: a draft claims only Wren's facts (`@wren/core/facts`) and the code guard drops what it can't back; posts outside recruiting/staffing growth, job ads and posts under `minFit` get no draft. Most of the first pool was job ads and vendors to our buyers, so code drops job posts, ranks owners in the audience's world above vendors, and search words earn their place by yield (`designs/2026-10-07-reach-targeting.md`). Reads by content search, not the people activity flow: that page's cards carry no post urn, and the comment route needs one. Reads go as `linkedin@wren` only; the settings refuse `linkedin` (his own) and `linkedin@alt` (research).

## Shape

- Table `linkedin_posts` (`schema.ts:568`, migration 0163): one row per post `urn`; state `found` → `queued` → `commented`, or `skipped`, `dropped` (`state_reason`: too old, ours, too short, a job ad, a job seeker, for job seekers, not about …, made things up: …, fit N under M, nothing worth adding); `fit` 0..100 and `why`; `draft`, `queued_at`; `comment`, `commented_at`, `commented_by`; the read kept whole in `raw`
- Code `packages/outreach/src/linkedin-posts.ts`: `commentsSettingsSchema` (`:60`, component `linkedin.comments`: `account`, `perDay` 10, `topics`, `companies`, `people` on, `maxAgeHours` 72, `minFit` 70, `audience` words, `about` who the buyers are, `newTopics` 3), `postReader` (`:122`), `jobPost` (`:219`: a job ad, a job seeker, for job seekers; headline too), `authorFit` (`:231`: buyer, owner, manager, seller), `rankPost` (`:260`: audience words, growth words, owner voice, author fit, topic hits, people we know, engagement, freshness, minus a pitch; `off` for a job post, or no audience word unless a buyer wrote it), `keepPosts` (`:332`), `postsToDraft` (`:404`: fit ≥ `minFit`, one per author, none by an author queued or commented on this week), `guardedComment` (`commentGuide` + his voice + last 5 `lipost` edits + `factsBlock`, then `guardDraft`; a hit is a `runs` row `guard`), `draftPost` (`:498`: `recordDraft` generated), `redraftPosts` (`:549`: queued only, from the kept `text`, no read; ranks again; a new draft is `generated` via model with `meta.redraft`, off target or under `minFit` is `rejected` via wren by `rank`, a guard drop by `guard` reason `facts`), `topicYields` (`:675`: posts and on-target per search word, 14 days), `planTopics` (`:699`: his words by yield, rest after 15 posts with none on target, then proven model words, then new ones), `proposeTopics` (`:742`: model call `linkedin.post_topics` from `about` and yields; code drops job words and known ones), `keyPeople` (`:777`: accepted invites and LinkedIn engagers, 3 a day in turn), `postsPass` (`:819`: 10 reads at most, key people always among them; a 429 ends reads; stats carry `topics` and `rested`), `planPostComment` (`:951`), `markPostCommented` (`:960`: `keepSentEdit`, `recordDraft` sent), `skipPost` (`:991`: `recordDraft` rejected with his why, `by`)
- Loop: `ReachWatch/daily` once a day (state key `posts`, `restate/index.ts:182`; `postsFor` `:434`), Wren only. Desk: `commentPost` (`:1224`, effect sends: `Content.reply` on LinkedIn with the post urn, Wren's token), `skipPost` (`:1248`, `by` from the viewer, else the request), `redraftPosts` (`:1269`), `posts` (`:1300`), `postsNow` (`:1311`)
- autobrowse (`linkedin-posts` branch, `src/sites/linkedin.ts`): `GET /search/results/content`, `GET /company/{company}/posts`, meter `posts` 12 a day on `linkedin@wren`, 0 on the others
- Training record: kind `linkedin_comment`, items `lipost:<id>` (`PREFIX_KIND`, `packages/core/src/draft-record.ts`)
- Console: `marketing.approval` items `lipost:<id>` "Comment to post" (`liPostRows`, `packages/content/src/social/records.ts:179`; tab Comments), draft box "Your comment, posted under their post", actions `marketing.lipostComment`, `marketing.lipostSkip`; Ask Claude kind `lipost` (`packages/content/src/draft-ask.ts:254`)
- CLI `wren reach posts status|set [--min-fit n] [--audience …] [--about …] [--new-topics n]|run|list|comment <id>|skip <ids...> [--by --reason --note]|redraft <ids...>`; `status` shows each search word's yield; `run` and `redraft` send the call and poll its output (`apps/cli/src/poll.ts`), so no HTTP wait times out
- Facts: `wren drafts facts [add|remove|reset]`, component `drafts.facts` in `wren_settings` (`packages/core/src/facts.ts`); the guard is `packages/core/src/grounded.ts`

## Connected to

- **joins:** [[content/linkedin-invite]] (key people: accepted invites), [[content/draft-event]] (`lipost:` items)
- **looks-like-but-is-not:** [[content/comment]], comments others leave on our posts

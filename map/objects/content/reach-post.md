---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-09 (reach on X and Instagram)
entity: packages/outreach/src/schema.ts:581
---

# reach-post (others' posts we comment on: LinkedIn, X, Instagram)

A post by someone else, found by the watch's daily read, ranked by code, and drafted for a comment in his voice. Up to `perDay` (10) a day per platform wait in To approve with the post shown; only his Comment posts it, then a like on the post and a follow of its author when the settings ask, each a touch. Each platform is off until its settings block (`linkedin.comments`, `x.comments`, `instagram.comments`) names an account. LinkedIn is on (`linkedin@wren`); X and Instagram are built dark.

## Why this shape

William, 2026-10-07: "10 comments a day on others' posts", all gated for his approval (`designs/2026-10-07-posting-flow.md` item 4). The first drafts made up stories and numbers and some posts were job ads, so: a draft claims only Wren's facts (`@wren/core/facts`) and the code guard drops what it can't back; posts outside recruiting/staffing growth, job ads and posts under `minFit` get no draft. Most of the first pool was job ads and vendors to our buyers, so code drops job posts, ranks owners in the audience's world above vendors, and search words earn their place by yield (`designs/2026-10-07-reach-targeting.md`). 2026-10-09 (gaps item 4): one table for every platform (was `linkedin_posts`), with the like and follow sends that touches.md listed as not built. LinkedIn reads go as `linkedin@wren` only; the settings refuse `linkedin` (his own) and `linkedin@alt` (research).

## Shape

- Table `reach_posts` (`schema.ts:581`, migrations 0163, 0209): one row per (`platform`, `ref`): LinkedIn's urn, X's post id, Instagram's shortcode; `handle` the author's (vanity or username, lowercased); state `found` → `queued` → `commented`, or `skipped`, `dropped` (`state_reason`: too old, ours, too short, a job ad, a job seeker, for job seekers, not about …, made things up: …, fit N under M, nothing worth adding); `fit` 0..100 and `why`; `draft`, `queued_at`; `comment`, `commented_at`, `commented_by`; `liked_at`, `followed_at`; the read kept whole in `raw`
- Code `packages/outreach/src/reach-posts.ts`: `COMMENTS_COMPONENTS`, `COMMENT_MAX` (LinkedIn 1250, X 280, Instagram 2200), `READS_PER_PASS` (10, 10, 3), `commentsSettingsSchemaFor` (`:103`: `account`, `perDay` 10, `topics`, `pages` (company handles or usernames), `people` on, `authorTitle` (LinkedIn search filter), `like` on, `follow` off, `maxAgeHours` 72, `minFit` 70, `audience` words, `about` who the buyers are, `newTopics` 3), `allCommentsSettings` (`:164`), `postReader` (`:290`: LinkedIn content search, company posts, a person by name; X recent search with `lang:en -filter:replies -filter:retweets since:`, an account's posts without reposts and the pinned one; Instagram keyword search then each post page, an account through `meta GET /instagram/{username}`), `jobPost` (`:508`), `authorFit` (`:520`), `rankPost` (`:549`), `keepPosts` (`:621`), `postsToDraft` (`:707`: per platform, fit ≥ `minFit`, one per author, none by an author queued or commented on this week), `guardedComment` (`:764`: the platform's `commentGuide` + his voice + last 5 `onpost` edits + `factsBlock`, then `guardDraft`; length rule per platform; run name `<platform>.comment_draft`), `draftPost` (`:811`), `redraftPosts` (`:862`: each post under its platform's settings and guide), `topicYields` (`:994`, per platform), `planTopics` (`:1018`), `proposeTopics` (`:1061`), `keyPeople` (`:1106`: LinkedIn accepted invites and engagers; X and Instagram handles that touched us), `postsPass` (`:1154`), `planPostComment` (`:1300`), `markPostCommented` (`:1309`), `postActs` (`:1348`: the Instagram comment, the like and the follow as site calls), `markPostActed` (`:1388`), `skipPost` (`:1402`)
- Loop: `ReachWatch/daily` once a day per platform with an account (state keys `posts`, `posts:x`, `posts:instagram`, `restate/index.ts:200`; `postsFor` `:507`), Wren only. Desk: `commentPost` (`:1340`, effect sends: LinkedIn and X through `Content.reply` as Wren's page, Instagram through `POST /web/p/{shortcode}/comments` as the settings' account; then like and follow as that account, neither failing the comment), `actOnPost` (effect sends: a like or follow alone, any post not skipped, once each, a touch), `skipPost` (`:1390`), `redraftPosts` (`:1411`), `posts` (`:1448`), `postsNow` (`:1459`: every platform on)
- autobrowse: LinkedIn `GET /search/results/content` (`authorTitle`), `GET /company/{company}/posts`, `POST /feed/update/{urn}/like`, `/in/{vanity}/follow`, `/company/{company}/follow`; X `GET /2/tweets/search/recent`, `GET /2/users/{id}/tweets`, `POST /2/users/me/likes`, `/2/users/me/following`; Instagram `GET /web/search`, `GET /web/p/{shortcode}`, `POST /web/p/{shortcode}/comments`, `/like`, `/web/{username}/follow`. Each metered per account
- Training record: kind `post_comment`, items `onpost:<id>` (`PREFIX_KIND`, `packages/core/src/draft-record.ts`)
- Console: `marketing.approval` items `onpost:<id>` "Comment to post" (`onPostRows`, `packages/content/src/social/records.ts:218`; tab Comments; the row's platform is the post's), actions `marketing.onpostComment`, `marketing.onpostSkip`; Ask Claude kind `onpost` (`packages/content/src/draft-ask.ts:276`, cap from `COMMENT_MAX`)
- CLI `wren reach posts status|set [--platform linkedin|x|instagram] [--account …] [--pages …] [--author-title …] [--like on|off] [--follow on|off] [--min-fit n] …|run|list|comment <id>|skip <ids...>|redraft <ids...>`
- Facts: Marketing → Facts or `wren drafts facts`, into component `drafts.facts` (`packages/core/src/facts.ts`); the guard is `packages/core/src/grounded.ts`

## Connected to

- **joins:** [[leads/touch]] (ours on their post: `rp:<id>` comment, `rp:<id>:like`, `rp:<id>:follow`; `touchesFromReachPost`)
- **joins:** [[content/linkedin-invite]] (key people: accepted invites), [[content/draft-event]] (`onpost:` items)
- **looks-like-but-is-not:** [[content/comment]], comments others leave on our posts

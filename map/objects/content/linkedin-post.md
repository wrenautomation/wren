---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ bbf429c3
entity: packages/outreach/src/schema.ts:568
---

# linkedin-post (others' LinkedIn posts we comment on)

A post by someone else, found by the watch's daily read, ranked by code, and drafted for a comment in his voice. Up to `perDay` (10) a day wait in To approve with the post shown; only his Comment posts, from Wren's account. Built dark: off until `linkedin.comments` names an account.

## Why this shape

William, 2026-10-07: "10 comments a day on others' posts", all gated for his approval (`designs/2026-10-07-posting-flow.md` item 4). Reads by content search, not the people activity flow: that page's cards carry no post urn, and the comment route needs one. Reads go as `linkedin@wren` only; the settings refuse `linkedin` (his own) and `linkedin@alt` (research).

## Shape

- Table `linkedin_posts` (`schema.ts:568`, migration 0163): one row per post `urn`; state `found` → `queued` → `commented`, or `skipped`, `dropped` (`state_reason`: too old, ours, too short, nothing worth adding); `fit` 0..100 and `why`; `draft`, `queued_at`; `comment`, `commented_at`, `commented_by`; the read kept whole in `raw`
- Code `packages/outreach/src/linkedin-posts.ts`: `commentsSettingsSchema` (`:33`, component `linkedin.comments`: `account`, `perDay` 10, `topics`, `companies`, `people` on, `maxAgeHours` 72), `postReader` (`:84`), `rankPost` (`:124`: topic hits, the author's title tier, people we know, engagement, freshness), `keepPosts` (`:155`), `postsToDraft` (`:225`: one per author, none by an author queued or commented on this week), `draftPost` (`:261`: one model call, `commentGuide` + his voice + last 5 `lipost` edits, `recordDraft` generated), `keyPeople` (`:315`: accepted invites and LinkedIn engagers, 3 a day in turn), `postsPass` (`:354`: 10 reads at most; a 429 ends reads), `planPostComment` (`:450`), `markPostCommented` (`:459`: `keepSentEdit`, `recordDraft` sent), `skipPost` (`:491`: `recordDraft` rejected with his why)
- Loop: `ReachWatch/daily` once a day (state key `posts`, `restate/index.ts:180`; `postsFor` `:425`), Wren only. Desk: `commentPost` (`:1210`, effect sends: `Content.reply` on LinkedIn with the post urn, Wren's token), `skipPost` (`:1234`), `posts` (`:1249`), `postsNow` (`:1260`)
- autobrowse (`linkedin-posts` branch, `src/sites/linkedin.ts`): `GET /search/results/content`, `GET /company/{company}/posts`, meter `posts` 12 a day on `linkedin@wren`, 0 on the others
- Training record: kind `linkedin_comment`, items `lipost:<id>` (`PREFIX_KIND`, `packages/core/src/draft-record.ts`)
- Console: `marketing.approval` items `lipost:<id>` "Comment to post" (`liPostRows`, `packages/content/src/social/records.ts:179`; tab Comments), draft box "Your comment, posted under their post", actions `marketing.lipostComment`, `marketing.lipostSkip`; Ask Claude kind `lipost` (`packages/content/src/draft-ask.ts:254`)
- CLI `wren reach posts status|set|run|list|comment <id>|skip <ids...>`

## Connected to

- **joins:** [[content/linkedin-invite]] (key people: accepted invites), [[content/draft-event]] (`lipost:` items)
- **looks-like-but-is-not:** [[content/comment]], comments others leave on our posts

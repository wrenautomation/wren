---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 42b1013e (facts guard: grounded-drafts)
entity: packages/outreach/src/schema.ts:242
---

# comment (comments on our posts, as events)

Every comment on our posts and every answer to our comments. Two sources (`channel`): `reach`, as each reach account's inbox lists it; `content`, as `SocialWatch/wren` reads Wren's own posts on every content platform (designs/2026-10-06-social-inbox.md). A row, then one `comment` event on the `reach.comments` workflow. William answers, DMs or drops each one from Marketing → Inbox; nothing goes out without his click. TikTok comments come from the box's `/web/videos/{id}/comments` (no reply API): our reply made by hand under one marks it answered at the reply's time (`answeredByHand`, `social/store.ts`), so the reply rate counts it; a TikTok post is read every 6 h while young, daily after.

## Why this shape

Comments work like a webhook (William, 2026-10-05): the reader is a source, reach is one subscriber. One inbox read per account serves DMs and comments, and marks nothing read. Reads follow the warm cadence (William, 2026-10-06: "frequent checks at first, then decays"): every 2 minutes for 15 minutes after the account's last touch (a DM either way, a comment, our answer, a post on its platform), every 5 to the hour, every 15 to 6 hours, then every 30, each ±20%. A send, an answer or a post wakes the watch. Health stays every 30. Our two Reddit accounts never write in one thread, so an answer reads the thread's authors first.

## Shape

- Reviews of the business are comments too (designs/2026-10-09-review-replies.md): kind `review`, `stars` 1 to 5 (0219), kept by `keepReviews`; an owner reply read from the source sets it answered. Each new one goes to `AutoReply` (`autoReplyReviews`) for a drafted reply. Record `marketing.review` (`packages/content/src/social/review-record.ts`), Marketing → Reviews. A client with a Place ID and no Profile reading reviews gets them off Google Maps every 6 hours (`SocialWatch` dep `maps`, autobrowse `web GET /place/reviews`, `social/maps-reviews.ts`), `raw.source = maps`; `keepReviews` keeps one row per review across sources (author plus time within a minute or same words; the API's read takes over a Maps row). A Maps review's reply option carries `copy` (the place URL): sending marks it answered (`ReplySender.posted`) and hands back the words to paste on Google (`copy` in the answer; `copyAndOpen` in `@wren/ui`). A new 1 or 2 star review `@`s the client's owners in an Inbox note (`social/review-ring.ts`).

- `comments` (`schema.ts:242`): unique (platform, ref); `platform` any content platform; `channel` reach|content, a reach row needs `account_id` (null for content); `sort` asked/question/chat/hostile/ours; `state` new/waiting/answered/dropped; `draft`, `answer`, `contact_id` once DMed (migration 0119)
- Readers: `redditOutreach().comments` (`packages/channel-reddit/src/outreach.ts`), shared inbox read with `replies`; `Content.comments` on posts of the last 14 days (`packages/content/src/social/store.ts` `keepPostComments`, ours kept as dropped)
- Drafts: `sortStep` takes a guide per platform, the worker passes `commentGuide` (`packages/content/src/playbook.ts`: the post playbook plus the `comments` SOP) and his last 5 comment edits (`editsFor`); none keeps the old prompt. Wren's sort carries Wren's facts (`factsBlock`) and an answer goes through the facts guard (`guardDraft`, a `runs` row `guard`); a client's carries none, so it claims nothing first-person
- Answer: a content comment goes through `Content.reply` (`ReachDesk/answerComment`); reach's DM path refuses it (no account)
- Code: `packages/outreach/src/comments.ts`: `keepComments` (`:45`), `sortComment` (`:154`, words then the Monitor's model), `sortStep` (`:230`, spine step `comments.sort`), `planAnswer` (`:199`, rung caps), `checkThread` (`:218`), `answerComment` (`:235`), `dmCommenter` (`:254`, one DM per person, rung must allow messages)
- Per client: `ReachWatch/<c>/daily` reads the client's Reddit logins (`accounts.reddit`, `packages/outreach/src/clients.ts`) into its own database, every read through its vendor gate (`meteredSites`, `@wren/core/metered`); a stop is `stats.stopped`. Its comments go on the spine with its id; `sortStep`'s `forClient` sorts them in its database with the model only when `comments.sort` is installed and its `models` gate is open. `SocialWatch/<c>/social` (`content.social`) reads comments on its own posts through `Content.comments` with `client`, into its database; nothing answers until its `content.posting` sends are on
- Loop: `ReachWatch/daily` (`restate/index.ts:225`), cadence `@wren/core/warm` (`warmEveryMs`), touches `lastTouches` (`accounts.ts`) plus content's `published_at` via the worker; state `reads`, `health`; desk handlers `ReachDesk/answerComment|dmComment|dropComment` (`:667`)
- Console: record `marketing.comment` (Marketing → Comments, platform/channel/kind filters) and `marketing.inbox` (`packages/content/src/social/records.ts:171`; inbound only: Marketing → Inbox and the Inbox app's "Waiting on you", one page `INBOX_PAGE` in `apps/portal/web/src/modules/marketing/index.ts:428`; comments, DMs, email replies `:87` (ids `email:<invite id>` with the replies page's Send and Don't answer, `reply:<thread_event id>` without), text threads `:106` (detail is the SMS thread), activity; what we'd send (post drafts, videos, Reddit thread comments, accepted invites) is `marketing.approval` `:361`, Marketing → To approve `APPROVAL_PAGE` `:455`; default view "Waiting on you", soonest `due` first); the detail draws `draft` as a box (`packages/ui/src/draft.tsx`, declared per page by `withDraft` in `apps/portal/web/src/modules/marketing/ask.tsx`): blur/⌘S save (`DraftAsk/set`), ⌘Enter sends, Ask Claude and Undo under it; `wren drafts set comment:<id>` too, each a `runs` row the detail shows; `wren drafts edits` lists his before/after

## Connected to

- **joins:** [[content/inbox-thread]] (in the Inbox a comment opens as the commenter's whole conversation; the reply box answers it through `ReachDesk/answerComment`, or asks in To approve)
- **joins:** [[leads/touch]] (each comment is a theirs touch `c:<id>`, our answer an ours reply `ca:<id>`; a reply to our answer marks it replied)
- **joins:** reach accounts and contacts (a DM makes a `reach_contacts` row and a manual `reach_messages` row the sender sends with the live gate off)
- **joins:** [[content/draft]] (the posts these comments sit under are content drafts)
- **looks-like-but-is-not:** `content_metrics.comments` (a count per post, no bodies)
- **joins:** [[content/funnel]] (his approved and rejected answers become examples for the next drafts)

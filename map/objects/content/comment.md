---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ bfbc526
entity: packages/outreach/src/schema.ts:242
---

# comment (comments on our posts, as events)

Every comment on our posts and every answer to our comments. Two sources (`channel`): `reach`, as each reach account's inbox lists it; `content`, as `SocialWatch/wren` reads Wren's own posts on every content platform (designs/2026-10-06-social-inbox.md). A row, then one `comment` event on the `reach.comments` workflow. William answers, DMs or drops each one from Marketing → Inbox; nothing goes out without his click.

## Why this shape

Comments work like a webhook (William, 2026-10-05): the reader is a source, reach is one subscriber. One inbox read per account serves DMs and comments, and marks nothing read. Reads follow the warm cadence (William, 2026-10-06: "frequent checks at first, then decays"): every 2 minutes for 15 minutes after the account's last touch (a DM either way, a comment, our answer, a post on its platform), every 5 to the hour, every 15 to 6 hours, then every 30, each ±20%. A send, an answer or a post wakes the watch. Health stays every 30. Our two Reddit accounts never write in one thread, so an answer reads the thread's authors first.

## Shape

- `comments` (`schema.ts:242`): unique (platform, ref); `platform` any content platform; `channel` reach|content, a reach row needs `account_id` (null for content); `sort` asked/question/chat/hostile/ours; `state` new/waiting/answered/dropped; `draft`, `answer`, `contact_id` once DMed (migration 0119)
- Readers: `redditOutreach().comments` (`packages/channel-reddit/src/outreach.ts`), shared inbox read with `replies`; `Content.comments` on posts of the last 14 days (`packages/content/src/social/store.ts` `keepPostComments`, ours kept as dropped)
- Drafts: `sortStep` takes a guide per platform, the worker passes `commentGuide` (`packages/content/src/playbook.ts`: the post playbook plus the `comments` SOP) and his last 5 comment edits (`editsFor`); none keeps the old prompt
- Answer: a content comment goes through `Content.reply` (`ReachDesk/answerComment`); reach's DM path refuses it (no account)
- Code: `packages/outreach/src/comments.ts`: `keepComments` (`:45`), `sortComment` (`:119`, words then the Watch's model), `sortStep` (`:152`, spine step `comments.sort`), `planAnswer` (`:199`, rung caps), `checkThread` (`:218`), `answerComment` (`:235`), `dmCommenter` (`:254`, one DM per person, rung must allow messages)
- Loop: `ReachWatch/daily` (`restate/index.ts:225`), cadence `@wren/core/warm` (`warmEveryMs`), touches `lastTouches` (`accounts.ts`) plus content's `published_at` via the worker; state `reads`, `health`; desk handlers `ReachDesk/answerComment|dmComment|dropComment` (`:667`)
- Console: record `marketing.comment` (Marketing → Comments, platform/channel/kind filters) and `marketing.inbox` (`packages/content/src/social/records.ts:146`; the one queue: Marketing → Inbox and the Inbox app's "Waiting on you", one page `INBOX_PAGE` in `apps/portal/web/src/modules/marketing/index.ts:328`; post drafts, comments, DMs, Reddit threads, accepted invites, email replies `:87` (ids `email:<invite id>` with the replies page's Send and Don't answer, `reply:<thread_event id>` without), text threads `:106` (detail is the SMS thread), activity; default view "Waiting on you", soonest `due` first); the detail draws `draft` as a box (`packages/ui/src/draft.tsx`, declared per page by `withDraft` in `apps/portal/web/src/modules/marketing/ask.tsx`): blur/⌘S save (`DraftAsk/set`), ⌘Enter sends, Ask Claude and Undo under it; `wren drafts set comment:<id>` too, each a `runs` row the detail shows; `wren drafts edits` lists his before/after

## Connected to

- **joins:** reach accounts and contacts (a DM makes a `reach_contacts` row and a manual `reach_messages` row the sender sends with the live gate off)
- **joins:** [[content/draft]] (the posts these comments sit under are content drafts)
- **looks-like-but-is-not:** `content_metrics.comments` (a count per post, no bodies)

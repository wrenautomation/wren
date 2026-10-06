---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ f91a3b8
entity: packages/outreach/src/schema.ts:242
---

# comment (comments on our posts, as events)

Every comment on our posts and every answer to our comments, as each reach account's inbox lists it. A row, then one `comment` event on the `reach.comments` workflow. William answers, DMs or drops each one from Replies; nothing goes out without his click.

## Why this shape

Comments work like a webhook (William, 2026-10-05): the reader is a source, reach is one subscriber. One inbox read per account every 30 minutes serves DMs and comments, and marks nothing read. Our two Reddit accounts never write in one thread, so an answer reads the thread's authors first.

## Shape

- `comments` (`schema.ts:242`): unique (platform, ref); `sort` asked/question/chat/hostile/ours; `state` new/waiting/answered/dropped; `draft`, `answer`, `contact_id` once DMed
- Reader: `redditOutreach().comments` (`packages/channel-reddit/src/outreach.ts`), shared inbox read with `replies`
- Code: `packages/outreach/src/comments.ts`: `keepComments` (`:45`), `sortComment` (`:119`, words then the Watch's model), `sortStep` (`:152`, spine step `comments.sort`), `planAnswer` (`:199`, rung caps), `checkThread` (`:218`), `answerComment` (`:235`), `dmCommenter` (`:254`, one DM per person, rung must allow messages)
- Loop: `ReachWatch/daily` (`restate/index.ts:230`); desk handlers `ReachDesk/answerComment|dmComment|dropComment` (`:619`)
- Console: record `marketing.comment` (Marketing → Comments), rows in `inbox.reply` (`apps/worker/src/replies.ts`)

## Connected to

- **joins:** reach accounts and contacts (a DM makes a `reach_contacts` row and a manual `reach_messages` row the sender sends with the live gate off)
- **joins:** [[content/draft]] (the posts these comments sit under are content drafts)
- **looks-like-but-is-not:** `content_metrics.comments` (a count per post, no bodies)

# Engage threads

2026-10-15, bead wa-qx3. William: "i got two double comments from [a Reddit user] it only showed one. this is unacceptable." And: "my first instinct after seeing a notification is to open the full social media and see, and even comment there (but i like having edits tracked so doing it through wren makes sense)."

## What happened

A Reddit user replied to our comment. Engage showed that row. Then they replied to their own reply with a question. Reddit's inbox lists only direct replies to us, so we never saw the second one.

Three things were missing:

1. We read the inbox, never the conversation under our comment.
2. Two messages from one person showed as two unrelated rows (or one was lost).
3. No way to see the post and the whole thread without leaving Wren.

## Follow-ups

`comment_threads` (migration 0277) holds one watch per post we commented on: platform, post, the account, when it was last active, when to check next, how many replies the site hid behind "load more".

- A thread is watched for `followUpDays` after its last comment or answer. Default 7, 0 turns it off. Setting block `comments.read` (`packages/outreach/src/follow-ups.ts`).
- Cadence: warm right after activity, the same curve as the inbox reads (`nextCheckAt`), never sooner than 5 minutes, every 3 hours after a quiet day.
- Each `ReachWatch` pass first asks the site for the post's comment count (`commentCounts`, Reddit's `/api/info`, 100 posts per call). A thread whose count held is skipped until its 12-hour sweep (`needsRead`). At most 3 full thread reads per pass across accounts (`THREAD_READS_PER_PASS`). Every read goes through the account's site facade and its reads budget.
- A full read is the post plus every comment, nested (`ThreadRead`, `@wren/core/outreach`). Reddit: `/comments/{post}` at depth 10, limit 500. When Reddit hides replies, up to 2 focused reads open the conversation under our comments (autobrowse `comment` + `context` params, `focusesOf`).
- `followUpsOf` keeps two kinds of comment: anything anywhere under one of ours, and anything by a person who already talks to us in that thread. Strangers elsewhere on the post are left out. Our own accounts are left out. Deleted comments are left out. Kind `thread_reply`.
- Dedupe is the row's unique (platform, ref). The inbox and the thread read can both see a reply; it's kept once (`keepComments`).
- A reply of ours found on the site under a waiting row marks that row answered (`applyThread`).

## Grouping

One Engage row per person per thread. The record type declares the fold once (`RecordMeta.fold`, `foldRows`, `packages/core/src/records.ts`); `serveRecords` folds before filters, counts and sorts, so "Waiting on you" counts people, not messages.

- The row stands for the person's newest waiting message. Its `messages` field lists every message, newest first, each waiting or answered.
- `get` by any member's id opens the group, so links and the write path's ids keep working.
- `FoldPreview` (table and cards) and `FoldList` (detail) in `packages/ui/src/fold.tsx` draw it everywhere.
- Reply answers the newest waiting message. Answering it closes the same person's older open messages in that thread (`markAnswered`). To answer an older one, use Reply from Wren on it in the thread view.

## The thread view

Every Engage row and every Inbox comment thread opens with "The whole thread" first (`thread-context.tsx`, `withThread`).

- The post: where, who, when, title, body (clamped, "Show the whole post"), a picture, Open on site.
- Our comment and every reply under it, nested. Past 5 levels, a node says who it replies to instead of indenting further.
- Each node: author, time, Us, Waiting/Answered/Skipped, Reply from Wren and Open on site. Reply from Wren shows only on others' comments.
- Reply from Wren goes through `ReachDesk/replyInThread` (`effect: "sends"`). It keeps the comment first if only the thread read saw it (`adoptNode`), then answers it like any comment: same write path, same edits store, same Send as pick, same tracking.
- Refresh calls `ReachDesk/readThread`: one read now, on the same budget.
- The view loads when a row opens and is cached by TanStack Query with the record. "Checked on the site 2 minutes ago" says how fresh it is. "The site hid N more replies" says what we couldn't read.
- On a phone, the detail shows "See the whole thread (N replies)", which opens a full-height sheet.
- No iframes: Reddit, LinkedIn, X and Instagram refuse to be framed, and a framed page would post outside our tracking.

## What each platform can read

| Platform | Replies under our comment | Deep replies | Notes |
|---|---|---|---|
| Reddit (reach) | yes, full tree | yes, to depth 10 | Count probe, focused reads when Reddit hides replies. The only reach platform with a thread watch today. |
| X (our posts) | yes | flat | Conversation search finds every depth but gives no parent in the browser leg. 7-day search window. Paid-tier errors read as none. |
| LinkedIn (our posts) | yes | one level | Parent known only for org pages. |
| Instagram (our posts) | yes | one level | A reply to a reply lands under the top-level comment, with an @mention. |
| YouTube (our videos) | yes | one level | Up to 5 replies ride along per thread. Same @mention answer. |
| Facebook Page | yes | yes | The stream carries parents. |
| TikTok | read only | no | No reply API. |
| Threads (Meta) | top level only | no | |

Not read at all: replies to our comments on other people's LinkedIn, X and Instagram posts (reach posts).

## Gaps

- Fixed (wa-ipi): Inbox team state (assignee, closed) is keyed by row id, so a follow-up that became the group's newest row lost its assignee. A row with no state of its own now takes the newest one any comment in its fold group has; a new word from them still reopens it, as a help desk does.
- A client's Inbox has no thread view yet.
- Refresh works for reach comments. Content comments show what the last post read kept.
- autobrowse needs a desk deploy for focused reads. Until then a plain read still works.

## Tests

- `packages/outreach/src/follow-ups.test.ts`: self-reply caught, deep third-person reply caught, strangers and ours left out, no doubles, deleted, parent loops, cadence.
- `packages/outreach/test/integration/engage-threads.test.ts`: watch window, keep once, fold of 2 newest first, context nested, reply targets the right node.
- `packages/core/src/records-fold.test.ts` and `test/integration/records-fold.test.ts`: fold, counts, get by an older id.
- `apps/portal/web/src/modules/marketing/thread-context.test.tsx`: the nested tree renders.
- `apps/portal/scripts/threads-e2e.ts` on a local preview seeded by `packages/content/test/threads-preview.ts`: at 1440, one row with 2 messages, the tree nested, Reply from Wren on a deep node sends its ref once for a double press, words survive a reload; at 393, the sheet.

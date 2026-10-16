---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-16 (maybe sent build; private, sdm, X look)
entity: packages/outreach/src/schema.ts:866
---

# send-attempt (a send that lands at most once)

One row per comment, answer or DM that must go out at most once: claimed `sending` before the call, settled `sent` with the real ref, or `unsure` when it may have gone out and no read could tell. Unsure rows wait in To approve ("May have gone out") for a person.

## Why this shape

2026-10-16 (`designs/2026-10-16-maybe-sent.md`): two Reddit thread comments posted, the desk answered "already went through", Restate retried a journaled error until it paused, and the rows stayed `queued`, free to post again. A claim row makes a second invocation refuse; a look on the site for our own words, by the sending account, turns an unknown outcome into found, retry once, or unsure. Unsure is terminal for Restate and never resent without a person.

## Shape

- Table `send_attempts` (`packages/outreach/src/schema.ts:866`, migration 0280): `item` PK (`thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`, `private:<comment id>`, `sdm:<reach message id>` in a client's own database), `state` sending|sent|unsure, `platform`, `account`, `words`, `target`, `url`, `tries`, `invocation`, `ref`, `sent_at`, `why`, `settled_by` (`sent`, `found` or the person)
- Rows `packages/outreach/src/send-attempts.ts`: `claimSend` (a fresh `sending` refuses; one older than 10 min is taken over as "may have left"), `settleSent`, `settleUnsure`, `releaseSend` (refused or never left), `parkUnsure` (the sender's DMs), `unsureSends`, `sendOpen` (the schedulers' skip)
- Reconcile `packages/core/src/maybe-sent.ts`: `sendFate`, `sendOnce` (look first when tried; maybe, settle 30 s, look: found, absent sends once more, unclear is unsure), `sameWords`, `seenIn`, `seenInMessages` (a conversation read, oldest first)
- Looks: `OutreachChannel.findSent` (`packages/core/src/outreach/index.ts`): Reddit `/user/{self}/comments` and `/message/sent` (`packages/channel-reddit/src/outreach.ts:404`), LinkedIn relationship and `/messaging` preview (`packages/channel-linkedin/src/outreach.ts:214`); `contentLook` reads `Content.comments` rows marked mine, or `Content.findReply` for X (search of our own posts, `packages/channel-x/src/content.ts:291`), on Wren's channels or a client's (`packages/outreach/src/restate/maybe-sent.ts`); `seenInDms` reads a client's conversation through `readDms` (`packages/content/src/connect/dms.ts`)
- On Restate `sendAtMostOnce` (`packages/outreach/src/restate/maybe-sent.ts:58`), used by `commentThread` (`restate/discovery.ts:576`), `answerOne` (answerComment, replyInThread; `restate/index.ts:1311`), `dmComment`'s private reply (`:1753`, no look) and `commentPost`; a client's `SocialInbox/send` (`sdm:`) and `answer` (`comment:`) (`packages/content/src/restate/social-inbox.ts:151`, `:226`). A refused claim throws `SendTaken` (409), which changes nothing. The sender's `tick` uses `sendOnce` directly (`packages/outreach/src/tick.ts:717`); unsure leaves the message `unknown` and parks `dm:<id>`
- Settle: `ReachDesk/settleSend {item, outcome: posted|again}` (effect sends), with `markPosted` and `requeueDm` (`packages/outreach/src/settle-send.ts`); a client's through `MarketingConsole/sendSettle` (its approver) → `SocialInbox/settle` (`social-inbox.ts:281`)
- Console: `marketing.approval` rows `unsure:<item>`, view "May have gone out", actions `marketing.sendPosted`, `marketing.sendAgain` (`packages/content/src/social/records.ts`); a client's in `marketing.asked_reply`; Engage hides parked items

## Connected to

- **joins:** [[content/reddit-thread]] (`thread:<id>`), [[content/comment]] (`comment:<id>`), [[content/reach-post]] (`onpost:<id>`)
- **joins:** [[content/comment-proof]] (same item ids; Mark posted schedules its checks)
- **looks-like-but-is-not:** [[content/comment-proof]] (proof asks whether a stranger sees a sent comment; this asks whether it was sent)

## If you change this

- **Hits:** every send handler above, `schedulePosts` and `scheduleThreads` (they skip open items), To approve and Engage rows
- **Does not hit:** follows and likes (idempotent on the site); keyword DMs (`keyword-dm.ts`, straight `Content.privateReply`). No read yet: Meta private replies (no Page-token conversations route in autobrowse `meta`), Instagram comments on others' posts

## Surfaces

| Surface | Role |
|---|---|
| ReachDesk sends, sender tick, SocialInbox sends | writes |
| Marketing → To approve (Wren's and a client's) | reads, settles |

## See

- Source: `packages/outreach/src/send-attempts.ts`, `packages/core/src/maybe-sent.ts`
- Design: `designs/2026-10-16-maybe-sent.md`

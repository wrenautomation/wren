---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-16 (maybe sent build)
entity: packages/outreach/src/schema.ts:866
---

# send-attempt (a send that lands at most once)

One row per comment, answer or DM that must go out at most once: claimed `sending` before the call, settled `sent` with the real ref, or `unsure` when it may have gone out and no read could tell. Unsure rows wait in To approve ("May have gone out") for a person.

## Why this shape

2026-10-16 (`designs/2026-10-16-maybe-sent.md`): two Reddit thread comments posted, the desk answered "already went through", Restate retried a journaled error until it paused, and the rows stayed `queued`, free to post again. A claim row makes a second invocation refuse; a look on the site for our own words, by the sending account, turns an unknown outcome into found, retry once, or unsure. Unsure is terminal for Restate and never resent without a person.

## Shape

- Table `send_attempts` (`packages/outreach/src/schema.ts:866`, migration 0280): `item` PK (`thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`), `state` sending|sent|unsure, `platform`, `account`, `words`, `target`, `url`, `tries`, `invocation`, `ref`, `sent_at`, `why`, `settled_by` (`sent`, `found` or the person)
- Rows `packages/outreach/src/send-attempts.ts`: `claimSend` (a fresh `sending` refuses; one older than 10 min is taken over as "may have left"), `settleSent`, `settleUnsure`, `releaseSend` (refused or never left), `parkUnsure` (the sender's DMs), `unsureSends`, `sendOpen` (the schedulers' skip)
- Reconcile `packages/core/src/maybe-sent.ts`: `sendFate`, `sendOnce` (look first when tried; maybe, settle 30 s, look: found, absent sends once more, unclear is unsure), `sameWords`, `seenIn`
- Looks: `OutreachChannel.findSent` (`packages/core/src/outreach/index.ts`): Reddit `/user/{self}/comments` and `/message/sent` (`packages/channel-reddit/src/outreach.ts:404`), LinkedIn relationship and `/messaging` preview (`packages/channel-linkedin/src/outreach.ts:214`); `contentLook` reads `Content.comments` rows marked mine (`packages/outreach/src/restate/maybe-sent.ts`)
- On Restate `sendAtMostOnce` (`packages/outreach/src/restate/maybe-sent.ts:58`), used by `commentThread` (`restate/discovery.ts:550`), `answerOne` (answerComment, replyInThread; `restate/index.ts:1290`, `:1319`) and `commentPost` (`:1857`). The sender's `tick` uses `sendOnce` directly (`packages/outreach/src/tick.ts:717`); unsure leaves the message `unknown` and parks `dm:<id>`
- Settle: `ReachDesk/settleSend {item, outcome: posted|again}` (`restate/index.ts:1922`, effect sends), with `markPosted` and `requeueDm` (`packages/outreach/src/settle-send.ts`)
- Console: `marketing.approval` rows `unsure:<item>`, view "May have gone out", actions `marketing.sendPosted`, `marketing.sendAgain` (`packages/content/src/social/records.ts`); Engage hides parked items

## Connected to

- **joins:** [[content/reddit-thread]] (`thread:<id>`), [[content/comment]] (`comment:<id>`), [[content/reach-post]] (`onpost:<id>`)
- **joins:** [[content/comment-proof]] (same item ids; Mark posted schedules its checks)
- **looks-like-but-is-not:** [[content/comment-proof]] (proof asks whether a stranger sees a sent comment; this asks whether it was sent)

## If you change this

- **Hits:** every send handler above, `schedulePosts` and `scheduleThreads` (they skip open items), To approve and Engage rows
- **Does not hit:** Meta private replies and Inbox replies on connected accounts (through `Content`, not wired)

## Surfaces

| Surface | Role |
|---|---|
| ReachDesk sends, sender tick | writes |
| Marketing → To approve | reads, settles |

## See

- Source: `packages/outreach/src/send-attempts.ts`, `packages/core/src/maybe-sent.ts`
- Design: `designs/2026-10-16-maybe-sent.md`

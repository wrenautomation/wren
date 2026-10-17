---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-16 (send verdicts build; send_key, drop outcome, no wren words; clients' looks kept)
entity: packages/outreach/src/schema.ts:866
---

# send-attempt (a send that lands at most once)

One row per comment, answer, DM or post of ours that must go out at most once: claimed `sending` before the call, settled `sent` with the real ref, or `unsure` when it may have gone out and no read could tell. Unsure rows wait in To approve ("May have gone out") for a person.

## Why this shape

2026-10-16 (`designs/2026-10-16-maybe-sent.md`): two Reddit thread comments posted, the desk answered "already went through", Restate retried a journaled error until it paused, and the rows stayed `queued`, free to post again. A claim row makes a second invocation refuse. The claim also makes the send's key, and autobrowse answers a verdict under that key: sent, not sent, or unknown. Wren reads no words and looks at no site for its own sends. A send autobrowse does not serve (a client's connected account, the direct Reddit API) keeps a look for its own words. Unsure is terminal for Restate and never resent without a person.

## Shape

- Table `send_attempts` (`packages/outreach/src/schema.ts:866`, migrations 0280, 0286): `item` PK (`thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`, `private:<comment id>`, `sdm:<reach message id>` in a client's own database, `draft:<content draft id>` for a post of ours), `state` sending|sent|unsure, `platform`, `account`, `words`, `target`, `url`, `tries`, `invocation`, `send_key`, `ref`, `sent_at`, `why`, `settled_by` (`sent`, `found` or the person)
- Rows `packages/outreach/src/send-attempts.ts`: `claimSend` (a fresh `sending` refuses; one older than 10 min, `SENDING_STALE_MS`, is taken over with the same key), `settleSent`, `settleUnsure`, `releaseSend` (refused or never left), `forgetUnsure` (a person dropped it), `parkUnsure` (the sender's DMs and posts), `unsureSends`, `sendOpen` (the schedulers' skip)
- The key: `restateSites` (`packages/core/src/content/restate.ts:162`) runs a write under `withSendKey` (`packages/core/src/send-verdict.ts`). `sites/call` and `desk/call` take `sendKey`; a keyed non-GET answers `SendVerdict`; Restate's idempotency key is the send key; a killed call asks `verdict {sendKey}`. It throws `SentFound`, `NotSent` (`before_submit`, `verified_absent`; `refused` is thrown as the platform's own failure) or `SendUnknown`. An error after a write answered is `unknown`. Across `Content` (`publish`, `reply`, `privateReply`) the request carries `sendKey` and `recheck`, the handler runs under `deliveryOf` and answers a `Delivery`, and the caller unwraps with `sendAcross` (`currentSendKey()`); a plain answer from an older callee counts as sent
- Reconcile `packages/core/src/maybe-sent.ts`: `sendOnce` answers `sent`, `found`, `not_sent` or `unsure`. With a look it reads first on a take-over or `again`, and upgrades `unknown` (or a failure that is not the platform's no) to `found`; absent or unclear stays unsure. Without a look the verdict is all it reads. `seenIn`, `seenInMessages`, `seenPost` build looks
- Looks kept (autobrowse gives no verdict there): `contentLook` for a client's `comment:` answer and `Content.reply` on a connected account (`packages/outreach/src/restate/maybe-sent.ts:176`); `seenInDms` for a client's `sdm:` (`packages/content/src/connect/dms.ts:448`); `Content.findPost` for a client's own post (`seenPost`); `Content.findPrivateReply` (Page inbox, `packages/core/src/content/page-inbox.ts`; no sender uses it yet); the direct Reddit API when `WREN_REDDIT_*` is set (no key, a take-over could send twice). `ContentChannel.listsLate` (TikTok, YouTube, Facebook and Instagram video) never proves absent
- Our own posts: `ContentScheduler` (`packages/content/src/restate/scheduler.ts`) claims `draft:<id>` and calls `Content.publish` under its key. Sent or found: `markPublished`, the first comment under `<sendKey> comment`. Not sent: `markWaiting` (`packages/content/src/queue.ts:160`, back to `approved`, "Waiting for the browser") for `before_submit` and `verified_absent`. Refused (a 4xx but 408 and 409): `failed`. Unknown (and any other terminal error): `parkUnsure`, the draft left `publishing` (`markUnsure`, `queue.ts:192`). A client's publish also reads `Content.findPost` once
- On Restate `sendAtMostOnce` (`packages/outreach/src/restate/maybe-sent.ts:88`): claim, `sendOnce`, settle. It throws `SendUnsure` (409) when unsure, `SendNotSent` (503) when the verdict was not sent, `SendTaken` (409) on a refused claim. Used by `commentThread` (`restate/discovery.ts:584`), `answerOne` (answerComment, replyInThread; `restate/index.ts:1370`, `:1401`), `dmComment`'s private reply (`:1793`), `commentPost` (`:1955`); a client's `SocialInbox/send` (`sdm:`) and `answer` (`comment:`) (`packages/content/src/restate/social-inbox.ts:220`, `:271`). The sender's `tick` uses `sendOnce` directly (`packages/outreach/src/tick.ts:729`): unsure leaves the message `unknown` and parks `dm:<id>`; not sent holds it 5 min (`NOT_SENT_HOLD_MS`) and the next try takes a new key; a scheduled post or thread goes through `sendHeld` (`packages/outreach/src/scheduled.ts:258`)
- Settle: `ReachDesk/settleSend {item, outcome: posted|again|dropped}` (effect sends), with `markPosted`, `requeueDm` and `dropItem` (`packages/outreach/src/settle-send.ts`); a client's through `MarketingConsole/sendSettle` (its approver) then `SocialInbox/settle` (`social-inbox.ts:314`); both send `draft:` to `ContentDesk/<key>/settlePost` (`packages/content/src/restate/desk.ts:823`). A Wren post asks autobrowse again (`Content.publish` with `recheck`, under 29 days) and a client's reads `Content.findPost`. Found or sent: `markPublished`. `posted`: `markPostedBy` (no id). `again`: `sendAgain` (`queue.ts:203`) and a scheduler wake. `dropped`: `dropDraft` (`queue.ts:216`, rejected, slot cleared)
- Dropped per kind: `thread` skipped, `comment` dropped, `onpost` skipped, `dm` message skipped and contact finished, `sdm` message skipped, `draft` rejected; `private` only clears the ledger row. All call `forgetUnsure`; a second drop refuses
- Console: `marketing.approval` rows `unsure:<item>`, view "May have gone out", actions `marketing.sendPosted`, `marketing.sendAgain`, `marketing.sendDrop` ("Not sent, drop") (`packages/content/src/social/records.ts`); a client's in `marketing.asked_reply`; Engage hides parked items

## Connected to

- **joins:** [[content/reddit-thread]] (`thread:<id>`), [[content/comment]] (`comment:<id>`), [[content/reach-post]] (`onpost:<id>`)
- **joins:** [[content/comment-proof]] (same item ids; Mark posted schedules its checks)
- **joins:** [[content/draft]] (`draft:<id>`, its record's item id)
- **looks-like-but-is-not:** [[content/comment-proof]] (proof asks whether a stranger sees a sent comment; this asks whether it was sent)

## If you change this

- **Hits:** every send handler above, `ContentScheduler` and `ContentDesk/settlePost`, `schedulePosts` and `scheduleThreads` (they skip open items), To approve and Engage rows, and the other side: autobrowse `sites`/`desk` `sendKey`, `SendVerdict` and `verdict` (`autobrowse/designs/2026-10-16-send-verdicts.md`)
- **Does not hit:** follows and likes (idempotent on the site); keyword DMs (`keyword-dm.ts`, straight `Content.privateReply`; no key yet). Still unsure: a desk send autobrowse answered `unknown` and could not verify; a client's send whose look could not read

## Surfaces

| Surface | Role |
|---|---|
| ReachDesk sends, sender tick, SocialInbox sends, ContentScheduler | writes, under a send key |
| Marketing → To approve (Wren's and a client's) | reads, settles |

## See

- Source: `packages/outreach/src/send-attempts.ts`, `packages/core/src/maybe-sent.ts`
- Design: `designs/2026-10-16-maybe-sent.md`

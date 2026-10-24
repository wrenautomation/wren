---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-16 (callers on the verdict: no looks, direct send journal, keyword DMs on the ledger)
entity: packages/outreach/src/schema.ts:866
---

# send-attempt (a send that lands at most once)

One row per comment, answer, DM or post of ours that must go out at most once: claimed `sending` before the call, settled `sent` with the real ref, or `unsure` when it may have gone out and no read could tell. Unsure rows wait in To approve ("May have gone out") for a person.

## Why this shape

2026-10-16 (`designs/2026-10-16-maybe-sent.md`): two Reddit thread comments posted, the desk answered "already went through", Restate retried a journaled error until it paused, and the rows stayed `queued`, free to post again. A claim row makes a second invocation refuse. The claim also makes the send's key, and autobrowse answers a verdict under that key: sent, not sent, or unknown. Wren reads no words and looks at no site for any send. A send autobrowse does not serve (a client's connected account, the direct Reddit API) runs under wren's own direct journal, which answers the same verdict. Unsure is terminal for Restate and never resent without a person.

## Shape

- Table `send_attempts` (`packages/outreach/src/schema.ts:866`, migrations 0280, 0286): `item` PK (`thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`, `private:<comment id>` (also a keyword DM), `sdm:<reach message id>` in a client's own database, `draft:<content draft id>` for a post of ours), `state` sending|sent|unsure, `platform`, `account`, `words`, `target`, `url`, `tries`, `invocation`, `send_key`, `ref`, `sent_at`, `why`, `settled_by` (`sent`, `found` or the person)
- Rows `packages/outreach/src/send-attempts.ts`: `claimSend` (a fresh `sending` refuses; one older than 10 min, `SENDING_STALE_MS`, is taken over with the same key; one with no key, from an older wren, is parked `unsure` with no send), `settleSent`, `settleUnsure`, `releaseSend` (refused or never left), `forgetUnsure` (a person dropped it), `parkUnsure` (the sender's DMs and posts), `unsureSends`, `sendOpen` (the schedulers' skip)
- The key: `restateSites` (`packages/core/src/content/restate.ts:167`) runs a write under `withSendKey` (`packages/core/src/send-verdict.ts`). `sites/call` and `desk/call` take `sendKey`; a keyed non-GET answers `SendVerdict`; Restate's idempotency key is the send key; a killed call asks `verdict {sendKey}`. It throws `SentFound`, `NotSent` (`before_submit`, `verified_absent`; `refused` is thrown as the platform's own failure) or `SendUnknown`. An error after a write answered is `unknown`. Across `Content` (`publish`, `reply`, `privateReply`) the request carries `sendKey` and `recheck`, the handler runs under `deliveryOf` and answers a `Delivery`, and the caller unwraps with `sendAcross` (`currentSendKey()`); a plain answer from an older callee counts as sent
- Reconcile `packages/core/src/maybe-sent.ts:47`: `sendOnce` answers `sent`, `found`, `not_sent` or `unsure` from the verdict alone. It reads nothing from a site
- Route kinds `packages/core/src/content/routes.ts:90`: `routeKind(site, method, path)` says `read`, `staging` or `send` for every site call. A GET is a read. A write is a send unless a row names it. A send is keyed and never retried blind
- Direct journal `packages/core/src/send-journal.ts:50` (`dbSendJournal`, table `send_journal`, migration 0288) and `journaledSites` (`packages/core/src/content/restate.ts:392`): for calls with no autobrowse between (a client's connected account, the direct Reddit API). A record is written under the key before the act, then the verdict; a replay or take-over reads it and never writes twice. No verify read exists, so a record with no verdict stays `unknown`. Wren's database holds its own, a client's database its own
- Our own posts: `ContentScheduler` (`packages/content/src/restate/scheduler.ts`) claims `draft:<id>` and calls `Content.publish` under its key. Sent or found: `markPublished`, the first comment under `<sendKey> comment`. Not sent: `markWaiting` (`packages/content/src/queue.ts:160`, back to `approved`, "Waiting for the browser") for `before_submit` and `verified_absent`. Refused (a 4xx but 408 and 409): `failed`. Unknown (and any other terminal error): `parkUnsure`, the draft left `publishing` (`markUnsure`, `queue.ts:192`); a client's own post goes the same way with `client`. Found or sent runs `afterPublish` (`packages/content/src/restate/after-publish.ts:67`): `markPublished`, the first comment, a "comment failed" note, the `posted` hook
- On Restate `sendAtMostOnce` (`packages/outreach/src/restate/maybe-sent.ts:79`): claim, `sendOnce`, settle. It throws `SendUnsure` (409) when unsure, `SendNotSent` (503) when the verdict was not sent, `SendTaken` (409) on a refused claim. Used by `commentThread` (`restate/discovery.ts:584`), `answerOne` (answerComment, replyInThread; `restate/desk.ts:457`, `:488`), `dmComment`'s private reply (`:880`), `commentPost` (`:1042`); a client's `SocialInbox/send` (`sdm:`) and `answer` (`comment:`) (`packages/content/src/restate/social-inbox.ts:209`, `:257`); a keyword DM `private:<comment id>` and its public reply `comment:<comment id>` (`packages/content/src/restate/keyword-dm.ts:138`, `:169`). A keyword DM that is unsure waits in To approve, its hit is `failed` with "may have gone out", and no reply goes; not sent or refused fail the hit and free the row. The sender's `tick` uses `sendOnce` directly (`packages/outreach/src/tick.ts:729`): unsure leaves the message `unknown` and parks `dm:<id>`; not sent holds it 5 min (`NOT_SENT_HOLD_MS`) and the next try takes a new key; a scheduled post or thread goes through `sendHeld` (`packages/outreach/src/scheduled.ts:258`)
- Settle: `ReachDesk/settleSend {item, outcome: posted|again|dropped}` (effect sends), with `markPosted`, `requeueDm` and `dropItem` (`packages/outreach/src/settle-send.ts`); a client's through `MarketingConsole/sendSettle` (its approver) then `SocialInbox/settle` (`social-inbox.ts:314`); both send `draft:` to `ContentDesk/<key>/settlePost` (`packages/content/src/restate/desk.ts:823`). A Wren or client post asks autobrowse again at any age (`Content.publish` with `recheck` and `verifyOnly`, so it never writes). Found or sent: `afterPublish`. Any other answer leaves his word. `posted`: `markPostedBy` (no id, no comment) and the `posted` hook. `again`: `sendAgain` (`queue.ts:203`) and a scheduler wake. `dropped`: `dropDraft` (`queue.ts:216`, rejected, slot cleared)
- Dropped per kind: `thread` skipped, `comment` dropped, `onpost` skipped, `dm` message skipped and contact finished, `sdm` message skipped, `draft` rejected; `private` only clears the ledger row. All call `forgetUnsure`; a second drop refuses
- Console: `marketing.approval` rows `unsure:<item>`, view "May have gone out", actions `marketing.sendPosted`, `marketing.sendAgain`, `marketing.sendDrop` ("Not sent, drop") (`packages/content/src/social/records.ts`); a client's in `marketing.asked_reply`; Engage hides parked items

## Connected to

- **joins:** [[content/reddit-thread]] (`thread:<id>`), [[content/comment]] (`comment:<id>`), [[content/reach-post]] (`onpost:<id>`)
- **joins:** [[content/comment-proof]] (same item ids; Mark posted schedules its checks)
- **joins:** [[content/draft]] (`draft:<id>`, its record's item id)
- **looks-like-but-is-not:** [[content/comment-proof]] (proof asks whether a stranger sees a sent comment; this asks whether it was sent)

## If you change this

- **Hits:** every send handler above, `ContentScheduler` and `ContentDesk/settlePost`, `schedulePosts` and `scheduleThreads` (they skip open items), To approve and Engage rows, and the other side: autobrowse `sites`/`desk` `sendKey`, `SendVerdict` and `verdict` (`autobrowse/designs/2026-10-16-send-verdicts.md`)
- **Does not hit:** follows and likes (idempotent on the site). Still unsure: a desk send autobrowse answered `unknown` and could not verify; a direct-journal record with no verdict

## Surfaces

| Surface | Role |
|---|---|
| ReachDesk sends, sender tick, SocialInbox sends, ContentScheduler | writes, under a send key |
| Marketing → To approve (Wren's and a client's) | reads, settles |

## See

- Source: `packages/outreach/src/send-attempts.ts`, `packages/core/src/maybe-sent.ts`, `packages/core/src/content/routes.ts`, `packages/core/src/send-journal.ts`, `packages/core/src/send-journal-schema.ts`
- Design: `designs/2026-10-16-maybe-sent.md`

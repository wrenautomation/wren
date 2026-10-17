# Maybe sent

2026-10-16. A send whose outcome is unknown is recorded once or parked for a person. It never pauses Restate and never sends twice. Since the same day, autobrowse says whether a send went out (a verdict), and wren reads no words and looks at no site for any send.

## What happened

On 2026-10-15 two Reddit thread comments (`ReachDesk/commentThread`, called by `RedditReads/wren/loop`) posted, but the send step failed with a 502: `"save the comment" already went through on an earlier try of this step; check it before running again`. `restateSites` journals each desk write, so a retry replayed the same error. `commentThread` made only 4xx terminal, so Restate retried, then paused both calls. The `reddit_threads` rows stayed `queued` with no `answer_ref`, so a later schedule pass could have posted them again.

On 2026-10-16 a TikTok publish came back the same way, and the scheduler marked the draft `failed` though the video was live.

## Decision log

**2026-10-16, send verdicts (wa-8q7, wren half wa-8q7.2; autobrowse half `autobrowse/designs/2026-10-16-send-verdicts.md`).** First build (morning): wren read autobrowse's error words (`sendFate`, `sentState`, "may have gone through"), waited 30 s, then looked for its own words on the site (`findSent`, `Content.findPost`, `igCommentLook`). It was a guess on top of a guess, and a wrong guess sent twice or hid a post. Now autobrowse owns the answer.

- **The contract.** `sites/call` and `desk/call` take a `sendKey` (1-200 chars). A keyed write answers a `SendVerdict`: `sent` (`how` `answer` with the output, or `verified`: the post found, with its id), `not_sent` (`how` `refused` with the platform's status, `before_submit`, or `verified_absent`), or `unknown`. An unkeyed call answers as before. wren sets Restate's idempotency key to the send key too. A call killed in flight gives a repeat of the same key the kill's failure, so wren calls `verdict {sendKey}` on the same service. autobrowse keeps the verdict 30 days.
- **The key.** One per attempt, kept on the ledger row (`send_attempts.send_key`, migration 0286), shaped `<item> <random>`. A first claim makes it. A take-over of a stale `sending` row (10 min) keeps it and sets `recheck`: autobrowse answers the stored verdict and runs only its verify read for an `unknown`. Send again by a person is a new send, so a new key. A stale `sending` row with no key (an older wren sent it) has no verdict: the take-over parks it `unsure` and sends nothing (`KEYLESS_TRY`).
- **One path.** `restateSites` (`packages/core/src/content/restate.ts`) runs a write under the key, asks `verdict` after a kill, and throws one of three typed errors: `SentFound`, `NotSent`, `SendUnknown` (`packages/core/src/send-verdict.ts`). A refusal throws `SiteCallError`. Across a service boundary (`Content.publish`, `reply`, `privateReply`) the handler takes `sendKey` and `recheck`, runs under `deliveryOf`, and answers a `Delivery`; the caller passes `currentSendKey()` and unwraps with `delivered`. `sendAcross` accepts a plain answer from an older callee as sent. An error after a write answered is `unknown`, never a retry.
- **One reconcile.** `sendOnce` (`packages/core/src/maybe-sent.ts`) answers `sent`, `found`, `not_sent` or `unsure`. A refusal is thrown as it came. `sendAtMostOnce` (`packages/outreach/src/restate/maybe-sent.ts`) claims the row, runs `sendOnce`, and settles the row: `sent`, `unsure` (throws `SendUnsure`, 409), or released (`SendNotSent`, 503; a refusal; a send that never left).
- **Not sent.** `before_submit` and `verified_absent` leave nothing on the site. The ledger row goes. The item waits for the next pass under a new key: a DM holds 5 minutes (`NOT_SENT_HOLD_MS`), a scheduled post leaves its slot (`sendHeld`), a draft goes back to `approved` with "Waiting for the browser". A refusal (`refused`, a 4xx but 408) is the platform's no: the item fails the way it did before.
- **The words are gone.** `sendFate`, `sentState`, `mayHavePosted`, `browserBusy`, `saysBrowserBusy`, the word constants, `OutreachChannel.findSent` and its fake, `igCommentLook`, `refuseUnsure`, and the scheduler's `lost` branch. Only migration 0287 still names the old words, to move failed drafts that carried them back to To approve.
- **Own-channel posts have a claim.** `ContentScheduler` claims `draft:<id>` on the ledger before `Content.publish` and publishes under that key (`draft:<id> <random>`). Sent or found: `markPublished` (a found post has its id; the first comment runs under the key `<sendKey> comment`; the `posted` hook runs). Unknown: the draft stays `publishing` and its row is `unsure` in To approve. Not sent: back to `approved`. Refused: `failed`.
- **A person settles with three words.** Mark posted, Send again, Not sent, drop (see below).

**2026-10-16, callers on the verdict (wa-8q7.3).** Brief B closes the last looks and puts every send on one path.

- **Route kinds.** Every site call is `read`, `staging` or `send`. One rule, `routeKind` in `packages/core/src/content/routes.ts`. A GET is a read. A write is a send unless a row names it a read (TikTok creator and status queries) or staging (a container that no person sees). A send is keyed and never retried blind. A refused publish after only staging writes is the platform's no.
- **The direct send journal.** `send_journal` (migration 0288) is wren's copy of autobrowse's journal for calls with no autobrowse between: a client's connected account and the direct Reddit API. Wren's Reddit API is no longer a gap: it is keyed through the journal.
- **Verify-only.** `Content.publish`, `reply` and `privateReply` take `verifyOnly` beside `sendKey` and `recheck`. Autobrowse answers the stored verdict and runs its verify read, and never writes. An unseen key answers `not_sent` (`before_submit`).
- **settlePost asks at any age.** The 29-day guard is gone (`ASK_AGAIN_MS`). `ContentDesk/settlePost` asks `Content.publish` with `{sendKey, recheck, verifyOnly}` for Wren's post and for a client's post (with `client`). Only `found` or `sent` matters. Any other answer leaves his word standing.
- **Found runs the shared after-publish.** `afterPublish` (`packages/content/src/restate/after-publish.ts`) is the one step for the scheduler's finish and for `settlePost` found: `markPublished` with the link, the first comment under `<sendKey> comment`, a "comment failed" note, then the `posted` hook. Mark posted (his word) runs the `posted` hook and posts no comment.
- **Keyword DMs on the ledger.** `packages/content/src/restate/keyword-dm.ts` sends through `sendAtMostOnce` and `sendAcross`: the DM as `private:<comment id>`, the public reply as `comment:<comment id>`. Sent or found: the hit is `sent` with the ref, then the reply. Unsure: the row waits in To approve, the hit is `failed` with "may have gone out", and no reply goes. Not sent: the row goes, the hit is `failed` with "Nothing went out". Refused: the hit is `failed` with the reason. A failed public reply never undoes a sent DM.
- **The looks are deleted.** `contentLook`, `seenIn`, `seenInMessages`, `seenInDms`, `seenPost`, `seenPrivateReply`, `findPost`, `findReply`, `findPrivateReply`, `listsLate`, `sameWords` and the clock slack. A client's send keeps its ledger key and runs under the direct journal. Send again is a new send under a new key, with no read first.

### Sends with no autobrowse between

A client's connected account and wren's direct Reddit API go straight to the platform on a token. No autobrowse desk keeps a verdict for them, so wren keeps one: the direct send journal (`send_journal`, `packages/core/src/send-journal.ts`, migration 0288). `journaledSites` (`packages/core/src/content/restate.ts`) wraps the `sites` seam. It writes a record under the send key before the act, then the verdict. A replay or a take-over with the same key reads the record and never writes twice. These routes have no verify read, so a record with no verdict stays `unknown`, and a person settles it. Wren's database holds its own sends; a client's database holds its own.

Wren reads no words for any send.

Every send reads only a verdict, from autobrowse or from the direct journal: Reddit threads, replies and DMs through the desk, LinkedIn and X replies, Instagram comments, Meta private replies, the sender's DMs and connects, and Wren's own posts on every channel.

### Not sent, drop

Third word beside Mark posted and Send again. It means the item did not go out and must stay out. `outcome` `dropped` on `ReachDesk/settleSend`, `MarketingConsole/sendSettle` (then `SocialInbox/settle`) and `ContentDesk/settlePost`. Each kind closes as that kind's skip closes it, and the ledger row goes:

| Item | State on `dropped` |
|---|---|
| `thread:<id>` | thread `skipped` (a drafted one keeps a rejected draft event) |
| `comment:<id>` | comment `dropped` (no change if already answered); a client's the same |
| `onpost:<id>` | post `skipped` ("dropped in To approve: it was not sent") |
| `private:<id>` | ledger row only; the comment stays as it was |
| `dm:<id>` | message `skipped`, contact `finished`, as a skipped invite does |
| `sdm:<id>` | message `skipped` (client database, `dropDm`) |
| `draft:<id>` | draft `rejected`, slot cleared, a "rejected" draft event (`dropDraft`) |

A second word on the same item is refused: nothing waits on it.

### Notes for the deploy

- Deploy autobrowse first. A desk that ignores `sendKey` answers the raw output, and wren counts that as sent. A desk that ignores `verifyOnly` would write on a `settlePost` ask.
- `settlePost` asks at any age, verify-only. It never writes: autobrowse keeps a verdict 30 days, and an unseen key answers `not_sent`. Deploy autobrowse's `verifyOnly` before wren.
- Run migration 0288 (`send_journal`) on wren's database and on each client database before the wren deploy.
- 408 and 409 from a Content hop count as unknown. A non-4xx terminal error from `Content` also counts as unknown in the scheduler.
- A `settlePost` rerun on a long `unknown` can take minutes: the verify read waits up to 3 reads (30 s, 3 min, 10 min).

## Decisions

- **One ledger, `send_attempts`** (`packages/outreach/src/schema.ts`, migrations `0280_send_attempts`, `0286_send_attempts_key`). One row per item that must land at most once, keyed by its typed id: `thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`, `private:<comment id>` (a DM from a comment on our own post, by hand or by a keyword), `comment:<id>` also covers a keyword's public reply, `sdm:<reach message id>` (a client's DM answer through its connected account, in the client's own database), `draft:<content draft id>` (a post of ours). A claim marks it `sending` with its send key before any call. A second invocation meanwhile is refused (409). A claim on a `sending` row older than 10 minutes takes it over with the same key. Settled `sent` (with the real ref and `settled_by`: `sent`, `found` or the person) or `unsure`. A refusal, or a send that never left, deletes the row so the item sends as if never tried.
- **On Restate, `sendAtMostOnce`.** Claim and settle are steps; the send is the caller's journaled site call, never inside a step. Unsure throws `SendUnsure`, a `TerminalError` (409), so nothing retries or pauses. A scheduled slot leaves the schedule. `sendError` makes a refusal or a journaled site error terminal too. A client's connected account uses the same path, with a verdict from the direct journal.
- **Before sending, our own words.** The "someone of ours already wrote here" guard (`threadAuthors`, `checkThread`) runs only on a first send (`before`), not on a take-over: our own earlier send is there, and autobrowse's stored verdict answers for it.
- **A person settles `unsure`** in To approve (view "May have gone out"): Open on site, Mark posted, Send again, Not sent, drop. All go to `ReachDesk/settleSend {item, outcome}` (effect sends). Mark posted records it the way a send does (`markCommented`, `markAnswered`, `markPostCommented`, or the sender's `recordSent` with its sequence step) and schedules the proof checks. Send again calls the item's own handler with `again: true`. A DM goes back in the sender's queue. A private reply records through `privateReplied`; Send again calls `ReachDesk/dmComment` with the ledger's words.
- **A client settles its own** in its To approve (`marketing.asked_reply` lists its `unsure` rows). The words go to `MarketingConsole/sendSettle`, its approver only, then `SocialInbox/settle` on its database: `sdm:` records through `sentDm`, `comment:` through `markAnswered`; Send again calls `SocialInbox/send` or `answer` with `again: true`. `planDm` reuses a row still `sending` or `unknown` with the same words, so a second click is the same item; the same words sent under 10 minutes ago are refused.
- **A person settles a post** with the same words. `ReachDesk/settleSend` (Wren's) and `SocialInbox/settle` (a client's) send `draft:` to `ContentDesk/<key>/settlePost` (service calls only). Wren's own post: ask autobrowse again under its key (`Content.publish` with `recheck` and `verifyOnly`, at any age). A client's: the same, with `client`. Found or sent: `afterPublish`, published with the platform's id, whatever he chose. Any other answer leaves his word. Mark posted marks it published on his word, with no id and no first comment, so its numbers are not read, and runs the `posted` hook. Send again puts it back to `approved` and wakes the scheduler. Not sent, drop rejects it.
- **Schedulers leave open items alone.** `schedulePosts` and `scheduleThreads` skip any item with a `sending` or `unsure` row. Engage hides them; To approve shows them in place of the queued row.

## Paths

What each send reads on an unknown outcome. "Verdict" is autobrowse's `SendVerdict` under the item's send key. "Direct journal" is `send_journal`: the same verdict, kept by wren for a call with no autobrowse between.

| Send | Reads | On unknown |
|---|---|---|
| Reddit thread comment (`commentThread`, desk) | verdict | unsure |
| Reddit reply to a comment (`answerComment`, reach path) | verdict | unsure |
| Reddit DM, LinkedIn connect and DM (sender `tick`) | verdict | the message stays `unknown`, parked as `dm:<id>`; not sent holds it 5 minutes |
| Answer on our own post (`answerComment`, content path, `Content.reply`) | verdict through the Content hop | unsure |
| Comment on someone's post: LinkedIn, X (`commentPost`, `Content.reply`) and Instagram (a site call) | verdict | unsure |
| Meta private reply (`dmComment`, `private:`) | verdict through `Content.privateReply` | unsure; Meta takes one private reply per comment |
| Keyword DM (`KeywordDm`, `private:<comment id>`) and its public reply (`comment:<comment id>`) | verdict through `Content.privateReply` and `Content.reply` | unsure: the hit is `failed` with "may have gone out", no reply goes |
| Our own post (`ContentScheduler`, `draft:`), every channel | verdict through `Content.publish`; the first comment under `<sendKey> comment` | stays `publishing`, unsure in To approve |
| Wren's direct Reddit API (`WREN_REDDIT_*`) | direct journal, keyed | unsure |
| Client's comment answer (`SocialInbox/answer`, `comment:`) | direct journal | unsure |
| Client's DM answer (`SocialInbox/send`, `sdm:`) | direct journal | unsure |
| Client's own post (`draft:` in its database) | verdict through `Content.publish` with `client` | stays `publishing`, unsure in To approve |

No read can confirm these, so the item is `unsure` and waits on a person: every direct-journal record with no verdict, and every desk send autobrowse answered `unknown` and could not verify.

Not on the ledger: follows and likes (`postActs`, `actOnPost`) are idempotent on the site, so a second send changes nothing.

## Tests

Each test fails on the old code. The fake desk keeps a journal by send key and answers verdicts.

- `packages/core/src/send-verdict.test.ts`, `packages/core/src/content/restate.test.ts` and `packages/core/src/maybe-sent.test.ts`: the keyed path, a kill then `verdict`, `deliveryOf` and `delivered`, `sendOnce` on every outcome. `packages/core/src/content/routes.test.ts` (route kinds) and `packages/core/test/integration/send-journal.test.ts` (the direct journal).
- `packages/outreach/test/integration/maybe-sent.test.ts` on Postgres: `sendAtMostOnce` under each verdict, a take-over on the same key, a key-less take-over parked unsure, a double invocation, the 10-15 Reddit case end to end (`commentThread`), the sender's DMs (found, unknown, not sent holds, refused, send again, drop), Not sent, drop for every kind, and a client's send on its connected account (a lost send is unsure, a second invocation is refused, Send again is a new key, a refusal and a not-sent release the row, no read for words).
- `packages/content/test/integration/loop.test.ts` on Restate: a busy browser takes a new key next pass, a verified post is published with its id and its first comment key, the 10-16 unknown stays `publishing`, a Content call that stops after the write is parked unsure, Send again and Mark posted, Not sent, drop, a settle at any age that asks verify-only and writes nothing, settle found that runs the after-publish (one first comment under its own key, the `posted` hook), Mark posted that runs the hook with no comment, a failed draft approved on the first yes. `packages/content/test/integration/social-access.test.ts`: a client's lost DM answer, Send again is a new send with no read, Mark posted, Not sent, drop. `packages/content/test/integration/keywords.test.ts`: a keyword DM and reply on the ledger (sent), unsure, not sent, refused, and a refused reply that leaves the DM sent.
- `packages/outreach/test/integration/reach-posts.test.ts`: the reply carries its send key; no look before a desk send.

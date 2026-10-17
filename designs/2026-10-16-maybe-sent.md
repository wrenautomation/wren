# Maybe sent

2026-10-16. A send whose outcome is unknown is recorded once or parked for a person. It never pauses Restate and never sends twice. Since the same day, autobrowse says whether a send went out (a verdict), and wren no longer reads words or looks at a site for its own sends.

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

### Sends that keep a look

A look reads the site for our words. It only upgrades `unknown` (or a failure that is not the platform's no) to `found`. Absent or unclear stays unknown for a person. These sends keep one, because autobrowse's desk and `sites` do not serve them, so no verdict exists:

- **A client's connected account.** `SocialInbox/send` (`sdm:`) reads the conversation (`readDms`, `seenInDms`). `SocialInbox/answer` (`comment:`) and a client's `Content.reply` use `contentLook`. A client's own-post publish (`draft:` in its database) reads its listing (`Content.findPost`). These go straight to the platform API on the client's token. The platform keeps no key we can ask. `Content.findPrivateReply` and the Page-inbox read (`seenPrivateReply`) stay for a client's private reply; no sender uses them yet, because the keyword DMs call `Content.privateReply` straight.
- **Wren's direct Reddit API** (`WREN_REDDIT_*` set; `redditFrom`, `apps/worker/src/services.ts`). A journaled step ends in `SendUnknown` after a write. There is no key for the API. Not set in prod. A take-over could send once more there. This is a known gap.
- Send again on one of these reads first. Found: recorded, not sent twice. A read that cannot tell does not stop a person who chose to send again.

Every other send reads only the verdict: Reddit threads, replies and DMs through the desk, LinkedIn and X replies, Instagram comments, Meta private replies, the sender's DMs and connects, and Wren's own posts on every channel.

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

- Deploy autobrowse first. A desk that ignores `sendKey` answers the raw output, and wren counts that as sent. A `settlePost` rerun against an older desk would write again.
- Wren asks the old key again only under 29 days (`ASK_AGAIN_MS`). The journal keeps 30, and an unseen key writes.
- 408 and 409 from a Content hop count as unknown. A non-4xx terminal error from `Content` also counts as unknown in the scheduler.
- A `settlePost` rerun on a long `unknown` can take minutes: the verify read waits up to 3 reads (30 s, 3 min, 10 min).

## Decisions

- **One ledger, `send_attempts`** (`packages/outreach/src/schema.ts`, migrations `0280_send_attempts`, `0286_send_attempts_key`). One row per item that must land at most once, keyed by its typed id: `thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`, `private:<comment id>` (a DM from a comment on our own post), `sdm:<reach message id>` (a client's DM answer through its connected account, in the client's own database), `draft:<content draft id>` (a post of ours). A claim marks it `sending` with its send key before any call. A second invocation meanwhile is refused (409). A claim on a `sending` row older than 10 minutes takes it over with the same key. Settled `sent` (with the real ref and `settled_by`: `sent`, `found` or the person) or `unsure`. A refusal, or a send that never left, deletes the row so the item sends as if never tried.
- **On Restate, `sendAtMostOnce`.** Claim and settle are steps; the send is the caller's journaled site call, never inside a step. Unsure throws `SendUnsure`, a `TerminalError` (409), so nothing retries or pauses. A scheduled slot leaves the schedule. `sendError` makes a refusal or a journaled site error terminal too.
- **Before sending, our own words.** The "someone of ours already wrote here" guard (`threadAuthors`, `checkThread`) runs only on a first send (`before`), not on a take-over: our own earlier send is there, and autobrowse's stored verdict answers for it.
- **A person settles `unsure`** in To approve (view "May have gone out"): Open on site, Mark posted, Send again, Not sent, drop. All go to `ReachDesk/settleSend {item, outcome}` (effect sends). Mark posted records it the way a send does (`markCommented`, `markAnswered`, `markPostCommented`, or the sender's `recordSent` with its sequence step) and schedules the proof checks. Send again calls the item's own handler with `again: true`. A DM goes back in the sender's queue. A private reply records through `privateReplied`; Send again calls `ReachDesk/dmComment` with the ledger's words.
- **A client settles its own** in its To approve (`marketing.asked_reply` lists its `unsure` rows). The words go to `MarketingConsole/sendSettle`, its approver only, then `SocialInbox/settle` on its database: `sdm:` records through `sentDm`, `comment:` through `markAnswered`; Send again calls `SocialInbox/send` or `answer` with `again: true`. `planDm` reuses a row still `sending` or `unknown` with the same words, so a second click is the same item; the same words sent under 10 minutes ago are refused.
- **A person settles a post** with the same words. `ReachDesk/settleSend` (Wren's) and `SocialInbox/settle` (a client's) send `draft:` to `ContentDesk/<key>/settlePost` (service calls only). Wren's own post: ask autobrowse again under its key (`Content.publish` with `recheck`, under 29 days). A client's: read its listing. Found: published with the platform's id, whatever he chose. Else Mark posted marks it published on his word, with no id, so its numbers are not read. Send again puts it back to `approved` and wakes the scheduler. Not sent, drop rejects it.
- **A channel whose listing is late never proves absent.** `ContentChannel.listsLate(media)` names why (TikTok, YouTube, Facebook and Instagram video). It matters only for a client's listing look now.
- **Schedulers leave open items alone.** `schedulePosts` and `scheduleThreads` skip any item with a `sending` or `unsure` row. Engage hides them; To approve shows them in place of the queued row.

## Paths

What each send reads on an unknown outcome. "Verdict" is autobrowse's `SendVerdict` under the item's send key.

| Send | Reads | On unknown |
|---|---|---|
| Reddit thread comment (`commentThread`, desk) | verdict | unsure |
| Reddit reply to a comment (`answerComment`, reach path) | verdict | unsure |
| Reddit DM, LinkedIn connect and DM (sender `tick`) | verdict | the message stays `unknown`, parked as `dm:<id>`; not sent holds it 5 minutes |
| Answer on our own post (`answerComment`, content path, `Content.reply`) | verdict through the Content hop | unsure |
| Comment on someone's post: LinkedIn, X (`commentPost`, `Content.reply`) and Instagram (a site call) | verdict | unsure |
| Meta private reply (`dmComment`, `private:`) | verdict through `Content.privateReply` | unsure; Meta takes one private reply per comment |
| Our own post (`ContentScheduler`, `draft:`), every channel | verdict through `Content.publish`; the first comment under `<sendKey> comment` | stays `publishing`, unsure in To approve |
| Wren's direct Reddit API (`WREN_REDDIT_*`) | nothing (no key) | unsure; known gap |
| Client's comment answer (`SocialInbox/answer`, `comment:`) | look: `contentLook` on its channels | found, else unsure |
| Client's DM answer (`SocialInbox/send`, `sdm:`) | look: `readDms` as the connected account (`seenInDms`) | found, retry once (the read reaches back past the send), else unsure |
| Client's own post (`draft:` in its database) | look: `Content.findPost`, the channel's `list` (`seenPost`) | found, else unsure; a late listing never proves absent |

No read can confirm these, so the item is `unsure` and waits on a person: a client's post on a channel with no `list`, a client's DM whose read is cut before the send, and every desk send autobrowse answered `unknown` and could not verify.

Not on the ledger: follows and likes (`postActs`, `actOnPost`) are idempotent on the site, so a second send changes nothing. Keyword DMs (`packages/content/src/restate/keyword-dm.ts`) still call `Content.privateReply` straight; they move to `private:` with the next change there.

## Tests

Each test fails on the old code. The fake desk keeps a journal by send key and answers verdicts.

- `packages/core/src/send-verdict.test.ts`, `packages/core/src/content/restate.test.ts` and `packages/core/src/maybe-sent.test.ts`: the keyed path, a kill then `verdict`, `deliveryOf` and `delivered`, `sendOnce` on every outcome, the look-on-failure branch, send again with a look.
- `packages/outreach/test/integration/maybe-sent.test.ts` on Postgres: `sendAtMostOnce` under each verdict, a take-over on the same key, a key-less take-over parked unsure, a double invocation, the 10-15 Reddit case end to end (`commentThread`), the sender's DMs (found, unknown, not sent holds, refused, send again, drop), Not sent, drop for every kind, and the client looks (X reply, the Page-inbox read for a private reply, `sdm:`).
- `packages/content/test/integration/loop.test.ts` on Restate: a busy browser takes a new key next pass, a verified post is published with its id and its first comment key, the 10-16 unknown stays `publishing`, a Content call that stops after the write is parked unsure, Send again and Mark posted, Not sent, drop, the 29-day age guard, a failed draft approved on the first yes. `packages/content/test/integration/social-access.test.ts`: a client's lost DM answer, Send again finds it, Mark posted, Not sent, drop.
- `packages/outreach/test/integration/reach-posts.test.ts`: the reply carries its send key; no look before a desk send.

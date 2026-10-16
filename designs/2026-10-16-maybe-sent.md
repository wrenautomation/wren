# Maybe sent

2026-10-16. A send whose outcome is unknown is checked on the site, recorded once, or parked for a person. It never pauses Restate and never sends twice.

## What happened

On 2026-10-15 two Reddit thread comments (`ReachDesk/commentThread`, called by `RedditReads/wren/loop`) posted, but the send step failed with a 502: `"save the comment" already went through on an earlier try of this step; check it before running again`. `restateSites` journals each desk write, so a retry replayed the same error. `commentThread` made only 4xx terminal, so Restate retried, then paused both calls. The `reddit_threads` rows stayed `queued` with no `answer_ref`, so a later schedule pass could have posted them again. A fresh resend would have read the thread, found our own handle in it, and refused without recording anything.

## Decisions

- **One ledger, `send_attempts`** (`packages/outreach/src/schema.ts`, migration `0280_send_attempts`). One row per item that must land at most once, keyed by its typed id: `thread:<id>`, `comment:<id>`, `onpost:<id>`, `dm:<reach message id>`. A claim marks it `sending` before any call. A second invocation meanwhile is refused (409). A claim on a `sending` row older than 10 minutes takes it over and knows an earlier try may have left. Settled `sent` (with the real ref and `settled_by`: `sent`, `found` or the person) or `unsure`. A refusal, or a send that never left, deletes the row so the item sends as if never tried.
- **One reconcile, `sendOnce`** (`packages/core/src/maybe-sent.ts`). `sendFate` reads autobrowse's words before the status: "may have gone through" or "already went through" is maybe; a refusal, or any 4xx but a 408, left nothing; "not sent" or a busy browser is not sent. On maybe it waits 30 s (`ctx.sleep`), then looks for our words by the sending account. Found: recorded with its ref and time. Absent (a listing that reaches back past the send): one more send. Unclear, or absent a second time: `unsure`. It also looks before the first send when the claim says an earlier try may have left, and an unreadable look then is `unsure` with no send.
- **On Restate, `sendAtMostOnce`** (`packages/outreach/src/restate/maybe-sent.ts`). Claim and settle are steps; the send and the look are the caller's journaled site calls. Unsure throws `SendUnsure`, a `TerminalError` (409), so nothing retries or pauses. A scheduled slot leaves the schedule. `sendError` makes a refusal or a journaled site error terminal too.
- **Before sending, our own words.** The look runs first whenever the item was tried. The existing "someone of ours already wrote here" guard (`threadAuthors`, `checkThread`) runs only after the look says our words are not there, so a resend after a crash records the comment instead of refusing.
- **A person settles `unsure`** in To approve (view "May have gone out"): Open on site, Mark posted, Send again. Both go to `ReachDesk/settleSend {item, outcome}` (effect sends). Mark posted records it the way a send does (`markCommented`, `markAnswered`, `markPostCommented`, or the sender's `recordSent` with its sequence step) and schedules the proof checks. Send again calls the item's own handler with `again: true`, which looks first. A DM goes back in the sender's queue.
- **Schedulers leave open items alone.** `schedulePosts` and `scheduleThreads` skip any item with a `sending` or `unsure` row. Engage hides them; To approve shows them in place of the queued row.

## Paths

| Send | Look | On unknown |
|---|---|---|
| Reddit thread comment (`commentThread`) | `findSent`: `/user/{self}/comments`, parent and words | found, retry once, or unsure |
| Reddit reply to a comment (`answerComment`, reach path) | `findSent` on the comment | same |
| Reddit DM (sender `tick`) | `findSent`: `/message/sent`, recipient and words | found or retry; unsure leaves the message `unknown` and parks it |
| LinkedIn connect (sender) | `/in/{vanity}/relationship`: pending or connected | found, absent, or unclear |
| LinkedIn DM (sender) | `/messaging` preview, our words | found only; else unsure |
| Answer on our own post (`answerComment`, content path) | `Content.comments`, rows marked mine | found only; else unsure |
| Comment on someone's post, LinkedIn (`commentPost`) | `Content.comments`, mine | found only; else unsure |

No read can confirm these, so an unknown outcome is `unsure` and waits on a person:

- Comments on others' posts on X (X's comments don't mark ours) and Instagram (site call, no reader).
- A connect anywhere but LinkedIn.
- Meta private replies (`dmComment` on our own post) and Inbox replies on connected accounts (`InboxDesk/reply`) go through `Content`. Not wired yet; they fail as before.

## Tests

`packages/core/src/maybe-sent.test.ts` (reconcile), `packages/channel-reddit/src/outreach.test.ts` and `packages/channel-linkedin/src/outreach.test.ts` (the looks), `packages/outreach/test/integration/maybe-sent.test.ts` on Postgres: found after unknown is marked once with no second send; not found sends once more; unreadable parks unsure with no send; a double invocation sends once; a refusal releases; DMs park and Mark posted moves the sequence on; the scheduler skips an unsure item.

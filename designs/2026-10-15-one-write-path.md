# One write path

2026-10-15, P0. William: "i just did a send for a reply to [a lead] on linkedin, i switched away from the tab as it was sending, now the UI is descyned this is unacceptable [...] there needs ot be global code / interface / helpers to ensure all of these operations don't have bullshit edge cases".

## What happened

Inbox → Waiting on you → a LinkedIn comment thread → Reply → Send.

1. The reply box kept its words and its "Sending" state in plain React state. The send was one held-open request: `console/call` → `InboxDesk/reply` → `ReachDesk/answerComment`. It carried no request id.
2. Three seconds in, he clicked another row. The box unmounted, so the words and the "Sending" state were gone. He came back to an empty box saying Send, then switched apps.
3. 53 s later the send failed: LinkedIn answered `400 Invalid input`. The only sign was a toast, fired into a hidden tab.
4. The server was right: thread still waiting, nothing sent. The page showed nothing.

Two bugs:

- Portal: a write's state lived in the component that started it, and only a held-open request could report the outcome. Unmount, hide or reload, and the outcome had nowhere to go.
- LinkedIn: a member's comment is listed by its bare numeric id. `reply()` only built `object`/`parentComment` for full URNs, so a bare id posted a body with no `object` → 400. Fixed: `commentUrnOf` (`packages/channel-linkedin/src/content.ts`) builds `urn:li:comment:(<post>,<id>)` from the post the comment is on, and refuses before sending if it can't. Not yet tried live.

## The write path

`WRITES` (`packages/ui/src/save/writes.ts`) carries every portal write. `api.ts`'s `call` sends every write route (`isWrite`) through it. Record actions use `callOnce`, held set-asides use `hold`, and a hand-drawn page's write goes through `call`. No page keeps its own copy.

- One request id per press, made once and reused on a retry after a lost answer and on a resend after a reload. The Worker turns it into Restate's idempotency key (`writeKey`), so the server runs it once.
- Each press and its wire calls go to session storage the moment they go. A reload or deploy resends a lost call under the same id. A press that never reached the wire says "The page reloaded before it was sent. Send it again."
- A press that takes rows out of a list (`hide`) is an overlay on the server's rows. It drops only after the server answers and the page reads again. A refusal puts the rows back and says why.
- On visibilitychange, focus, pageshow and online: held presses past their deadline go, lost calls go again, sends are asked about, and every read on screen reads again. An outcome that landed while hidden is said then.
- No timer decides a write. An undo window is a wall-clock deadline. It is checked on return, on a reminder, and on pagehide/freeze (keepalive). Timers only remind.
- A box reads its press from the store (`useLastWrite(record, actions)`), so a remount still shows "Sending", "Sent." or "Not sent: <reason>". A refusal also gives the words back.
- Other tabs hear each landed write over BroadcastChannel and read again.

## Sends: accept, then track

Sends are writes that reach a person on another platform: Inbox reply, Engage DM reply, comment answer, comment DM, SMS reply (`SENDS`, `SEND_HANDLERS` in `apps/portal/src/services.ts`).

- The Worker gives a send to Restate's `/send` under its idempotency key and answers `202 { accepted, state: "queued", requestId }` at once. A send without a request id is refused.
- The outcome is Restate's own record of that invocation. `POST /api/writes/status {path, requestId}` reads `/restate/invocation/<svc>/<handler>/<key>/output` and answers sending, sent (with the answer), failed (with the reason) or unknown. That record is durable and is kept a day.
- The tab asks on a backoff reminder (0.4 s doubling to 5 s) and on every return. It never infers the outcome from a held-open request. A refused send is always said, even when the box that sent it is gone.
- The box says "On its way. It sends even if you leave this page."
- Not yet: push over the portal socket instead of polling, and showing Restate's retry reason while a send retries (the ingress doesn't expose it; the admin API does).

Edits keep their row version: record edits send `expect` (`EditRequest`), and draft saves send the text they started from.

## The data layer (decided)

Constraints from William: free and open source, self-hosted, behind the Worker's auth. Postgres is never exposed. It must respect client logins, view-as and scoped grants.

| Option | Verdict |
|---|---|
| TanStack Query + IndexedDB persister + broadcastQueryClient | Chosen. MIT, runs in the browser only. Covers cache, focus/reconnect refetch, mutations with optimistic rollback, persisted paused mutations resumed after reload, cross-tab sync. Our record definitions and `console/call` stay on top, unchanged. |
| Rocicorp Zero | Needs its own sync server with direct Postgres replication and its own permission rules. That duplicates our guard and bypasses the Worker. |
| ElectricSQL | Self-hostable, but streams Postgres shapes over its own HTTP service. Each tenant database, view-as and scoped grant would need a proxy that re-implements the guard. |
| PowerSync | Open edition is self-hostable, but it brings a sync service and replication slots per database. Heavy for our multi-tenant setup. |
| Redux Toolkit + RTK Query + redux-persist | No. Nearly all portal state is server data. A second global store would duplicate the sync layer, and RTK Query has no persisted offline mutation queue or cross-tab sync built in. |

Delta sync rides our own API: each records read takes a cursor (row version or `updated_at`) and returns rows changed since. It is pushed over the portal socket when one is open and pulled on focus and reconnect otherwise. A sync engine only comes in if TanStack + IndexedDB can't do that.

Local copy safety: keyed per signed-in user and client, holds only rows the guard returned, wiped on sign-out, device forget and view-as switch, never secrets.

## Order

1. This commit: `WRITES`, accept-then-track sends, reconcile on return, LinkedIn fix, lint guard, tests.
2. Next: move the read side and the press plumbing onto TanStack Query: one query client in `packages/ui` for every page and the phone shell, an IndexedDB persister for the local copy, delta reads, broadcastQueryClient. `WRITES` keeps its shape (`press`, `hold`, `call`, `useLastWrite`) but runs on TanStack mutations, and its own storage, resume and tab code goes. Also replaced: `apps/portal/web/src/snapshot.ts`, `load.ts`, pulse polling where it overlaps, and the action runner's optimistic and undo plumbing. One send-status component and one pending/offline indicator, shared.

## Guard

`./scripts/gates.sh lint` runs `writes()`. It fails on a raw `fetch` to `/api/` in the portal web or `packages/ui`, except `api.ts` and dictation's audio post. It also fails on a record action calling `acts.call`/`deps.call` around `callOnce`.

## Left outside, and why

- Public booking page (`book.tsx`, `/__book/`): no sign-in, its own idempotent booking handler.
- Dictation (`/api/dictate`): audio to text, writes nothing.
- File bytes PUT to signed URLs (`uploadFile`, Notes' editor): the write that names the file goes through `WRITES`.
- Notes' live document sync (Yjs over its socket): its own durable sync.

## Tests

- `packages/ui/src/save/writes.test.ts`: double press, hidden mid-call, refused while hidden, lost answer keeps its id, out-of-order answers, reload mid-call, hand-drawn call, offline resend, long call asks status, hold/undo, deadline passed while hidden, page leaves inside the undo window, accept-then-track (lands, refused while hidden, reload mid-send), cross-tab reread.
- `apps/portal/test/worker.test.ts`: request id becomes the idempotency key; a send goes to `/send` and answers 202; `writes/status` maps Restate's answers.
- `apps/portal/test/writes.test.ts`: `isWrite` matches every service's writes; sends are writes.
- `apps/portal/scripts/writes-e2e.ts` (`pnpm e2e:writes`, Chrome on a local preview): the reported case (Inbox reply, row switch, hidden, refused), a reply that lands while hidden, a reload mid-send, Engage DM (draft save lands before the send), Engage comment answer refused while hidden, Drop with undo past its deadline while hidden.

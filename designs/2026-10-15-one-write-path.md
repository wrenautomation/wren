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
- A landed write tells the data layer, which reads again here and in the person's other tabs.

## Sends: accept, then track

Sends are writes that reach a person on another platform: Inbox reply, Engage DM reply, comment answer, comment DM, SMS reply (`SENDS`, `SEND_HANDLERS` in `apps/portal/src/services.ts`).

- The Worker gives a send to Restate's `/send` under its idempotency key and answers `202 { accepted, state: "queued", requestId }` at once. A send without a request id is refused.
- The outcome is Restate's own record of that invocation. `POST /api/writes/status {path, requestId}` reads `/restate/invocation/<svc>/<handler>/<key>/output` and answers sending, sent (with the answer), failed (with the reason) or unknown. That record is durable and is kept a day.
- The Worker also hands the send to the person's `WriteWatch` Durable Object (`apps/portal/src/watch.ts`). It reads the state with backoff (1 s doubling to 10 s, gives up after a day) and pushes each change to their tabs over `/api/live/writes`. The token rides in the socket protocol, as live notes do. A tab that connects late gets every open send's last state.
- While Restate retries, the watch reads why from the admin API's invocation table (first line, at most 200 characters, tokens masked). The box says "Trying again (2): <reason> It keeps trying even if you leave this page."
- The tab's socket (`apps/portal/web/src/write-socket.ts`) pings every 30 s and drops a socket that misses a pong. While it's open, the tab asks `writes/status` only every 20 s. When it closes, or where there's no watch (the local preview), the tab asks on a backoff reminder (0.4 s doubling to 5 s) and on every return. It never infers the outcome from a held-open request. A refused send is always said, even when the box that sent it is gone.
- One line under every send box, `SendStatus` (`packages/ui/src/data/status.tsx`): going, on its way, trying again and why, sent, not sent and why.

Edits keep their row version: record edits send `expect` (`EditRequest`), and draft saves send the text they started from.

## The data layer

Constraints from William: free and open source, self-hosted, behind the Worker's auth. Postgres is never exposed. It must respect client logins, view-as and scoped grants.

| Option | Verdict |
|---|---|
| TanStack Query + IndexedDB persister + broadcastQueryClient | Chosen and built. MIT, runs in the browser only. Our record definitions and `console/call` stay on top. |
| Rocicorp Zero | Needs its own sync server with direct Postgres replication and its own permission rules. That duplicates our guard and bypasses the Worker. |
| ElectricSQL | Self-hostable, but streams Postgres shapes over its own HTTP service. Each tenant database, view-as and scoped grant would need a proxy that re-implements the guard. |
| PowerSync | Open edition is self-hostable, but it brings a sync service and replication slots per database. Heavy for our multi-tenant setup. |
| Redux Toolkit + RTK Query + redux-persist | No. Nearly all portal state is server data. A second global store would duplicate the sync layer. |

TanStack plus IndexedDB covers what we need, so there is no sync engine. Pinned at 5.104.0: `@tanstack/react-query`, `query-persist-client-core`, `query-async-storage-persister`, `query-broadcast-client-experimental`.

What's in `packages/ui/src/data/`:

- `query.ts`: the one query client, `QUERIES`, mounted at load so focus and reconnect refetches run (the portal passes it to each hook, with no provider to mount it). `useLoad` runs on `useQuery`, and the last answer stays on screen while the next loads. A null key reads nothing (a closed panel). `freshMs` skips the read on mount for answers that rarely move (record types, 10 minutes). `readCached` is the same read for code outside a component (a picker's people, the types a workspace serves). Focus refetches only reads older than a minute; reconnect refetches all. `writeThrough` patches every cached answer of a scope after a save, and a read still out gets the patch when it lands. `refreshAll` serves pull to refresh and a landed write.
- `local.ts`: the local copy. Answers from named scopes (`nameScope`: the portal's calls, every records API) persist to IndexedDB, throttled to 2 s, at most 4 MB, newest first, kept a week. Only plain data is kept: an answer holding a Map, a Set or a Date would read back in the wrong shape, so it is read again instead. The next load paints from it and reads again behind it. `broadcastQueryClient` shares answers with the person's other tabs.
- `delta.ts` and `@wren/core/records/delta`: change-only list reads. Records are views over many tables with no shared change column, so a row's hash is its change mark. The tab sends the hashes it holds (at most 500). The server sends changed rows whole and a stub for the rest, which the tab fills. A stub it can't fill reads again in full.

## Row versions

Notes boards and cards (`boards`, `notes`) carry a `version` integer since migration 0279. A `BEFORE UPDATE` trigger bumps it on every write, from any path (the notes code, an import, a raw `update`), so no writer can forget. It always bumps: the generated `search` column makes a "did anything change" check unreliable.

- Change-only board reads: a card's mark is `versionMark(id, version, derived)`: its version, plus a hash of its id and what it shows from other rows (open blockers, cards it holds up, comments, client chips). The text isn't hashed. `notes/board` takes `known` like a records list and stubs the cards the tab holds; `readBoard` fills them in (`useBoard`, one key for the board page and a card's page).
- Conflicts: board settings' unsaved name and columns carry the board's version (`useEdit(..., { version })`). `boardSave` takes `expect` and refuses with 409 if the board moved. The dialog reads the board again and shows both, and he picks.
- A card's own fields (column, owner, due) are instant single-field changes: they send no `expect`.

Local copy safety: one copy per signed-in person, keyed by their email; the client is in each query key. It holds only answers the server gave them and their own unsaved words, never tokens. None under View as. `dropLocalCopy` wipes it on sign-out, a refused sign-in, another person signing in, and Forget this device.

`WRITES` did not move onto TanStack mutations, as the first plan said. TanStack resumes only mutations paused offline, and can't follow an accepted send to its outcome. `WRITES` does both under one request id.

In the portal web, `load.ts` wraps these: `useCall(key, fn, { kept })` in a component and `readCall(key, fn)` outside one, both on the portal's named scope (`kept: false` holds an answer for the component only: View as lists, previews of unsaved words). Every records API comes from `recordsApi(name, ask)` (`records-api.ts`), which names its scope, so its lists, rows, panels and types are kept. One name, one API object: the calendar, a workflow's side panel and the record pages share the builder.

Lists moved onto it in wa-ip3: the calendar's records (Wren's and a client's) and its range, a workflow's side panel, its counts, insides and the types a workspace serves, Notes boards, a card's board, board shares and people, proposed cards, broadcast context and month, segment context and versions, a line's work in Reactivation, link targets, surveys due, the View as list, the app menu, draft models, the feed's follows, saved views, snippets and their favorites. Hand-rolled caches deleted with them: workflows' `SERVED` and `APIS`, Reactivation's `WORK_SEEN`, records' `TYPES`, Notes' `peopleOnce`.

Replaced and deleted: `save/cache.ts` (the old answer cache), `snapshot.ts` (the old local copy), `load.ts`'s own cache (now a scope on `QUERIES`), the phone shell's refresh registry, pulse's own focus listeners, and `WRITES`'s own BroadcastChannel. Kept: the action runner's optimistic overlay, which is `WRITES`'s `hide`.

## Unsaved edits

William: "if i were to leave edits in and switch pages then come back it should also be cached".

Every word typed into the portal that the server doesn't hold yet sits in one store, `EDITS` (`packages/ui/src/data/edits.ts`). It lives in memory, writes through to the same IndexedDB as the local copy, and is shared with the person's other tabs. Each entry is keyed by person, client, record and field, and holds the server value and row version it started from.

- Every box uses `useEdit(key, server, { version })` (`data/use-edit.tsx`): spread `.field` on the input. Autosaving boxes (`useSaved`) and dialogs (`useKeptForm`) keep their words in the same store.
- Leaving the page, switching rows or apps, a reload or a closed tab never loses them. Coming back gives them back, marked "Not saved yet".
- If the server's value moved past the base meanwhile, both show (`EditConflict`, `KeptConflict`) and he picks Keep mine or Use saved. Neither is overwritten silently.
- Saving or discarding clears them. Words typed past what a save sent stay. Closing a dialog by accident doesn't discard.
- Entries from the old local storage journal move in once. Entries older than a week drop.

One mark in the shell, `WritesIndicator`: offline, and how many writes wait for an answer.

## Order

1. `WRITES`, accept-then-track sends, reconcile on return, LinkedIn fix, lint guard, tests.
2. The data layer on TanStack Query, the local copy, change-only reads, pushed send states with the retry reason, `SendStatus`, `WritesIndicator`, unsaved edits on every box, the edits guard.
3. Every portal list on the data layer, board and card row versions, the reads guard (wa-ip3).

## Guard

`./scripts/gates.sh lint` runs `writes()`. It fails on a raw `fetch` to `/api/` in the portal web or `packages/ui`, except `api.ts` and dictation's audio post. It also fails on a record action calling `acts.call`/`deps.call` around `callOnce`.

It also runs `edits()` (`scripts/edits-guard.mjs`). Every text box in the portal web and `packages/ui` that takes a `value` keeps its words (`data-edit`, set by `useEdit`, `useSaved` or `useKeptForm`), or says why not in an `edit-ok: <reason>` comment. Today's exemptions are search, filter and find boxes, type-to-confirm boxes, and dev-only scratch inputs.

It also runs `reads()` (`scripts/reads-guard.mjs`, sharing `scripts/portal-sources.mjs` with the edits guard). It fails on an effect (`useEffect`, `useLayoutEffect`) that awaits something, unless a `read-ok: <reason>` comment sits in it or within three lines above. Today's reasons: a live feed or a poll that ends (a run's lines, an ask's answer, the workflow dots), badge counts on the pulse, a write that starts on arrival, a search or preview as it's typed, the graph layout, and effects that take an answer already read through `readCall`. It also fails on a records API built outside `recordsApi`. `engage.tsx` is skipped (`LATER`) while the engage-threads branch changes it.

## Tabs from an older build (wa-ovo, 10-16)

A tab open across a deploy keeps its old bundle. One from before this path pressed Send on a Reddit reply with no request id, and the new Worker answered "A send needs its request id." Nothing reached Restate.

- The web build's id is a hash of the files it emits, so a Worker or Restate-only deploy leaves it alone. Vite writes it into each page's meta tag and into `build.json` (`apps/portal/web/vite.config.ts`, `buildId`).
- The tab sends it on every call as `x-wren-build`. The Worker answers a write from another build, or a send that names none, with 409 `code: "stale"`: "Wren was updated since this tab opened. Reload to send." (`apps/portal/src/build.ts`). A plain write with no build (a script, the phone's Shortcut) still runs.
- The web shows it as one toast with a Reload button. It is never an edit conflict. The words stay in the failed press, the open dialog or the kept box, so the reload gives them back.
- Every refused send is logged: route, handler, both builds, reason. Never the words or the sender. Worker logs keep one request in ten, so the toast, not the log, is what the person sees.
- A React Hook Form form (`useEditForm`) shows the refusal as its error and keeps the typed values in the edits store, so the reload gives them back.

## Left outside, and why

- Public booking page (`book.tsx`, `/__book/`): no sign-in, its own idempotent booking handler.
- Dictation (`/api/dictate`): audio to text, writes nothing.
- File bytes PUT to signed URLs (`uploadFile`, Notes' editor): the write that names the file goes through `WRITES`.
- Notes' live document sync (Yjs over its socket): its own durable sync.

## Tests

- `packages/ui/src/save/writes.test.ts`: double press, hidden mid-call, refused while hidden, lost answer keeps its id, out-of-order answers, reload mid-call, hand-drawn call, offline resend, long call asks status, hold/undo, deadline passed while hidden, page leaves inside the undo window, accept-then-track (lands, refused while hidden, reload mid-send), pushed outcomes and retries.
- `packages/ui/src/data/data.test.tsx`: the IndexedDB store; the local copy paints after a reload, keeps no unnamed scope, and holds nothing for another person; write-through; change-only reads; unsaved edits across a page switch, a reload, clients, a moved server value, save and discard, and a wipe; the send line and the shell's mark.
- `packages/core/src/records-delta.test.ts`: row hashes, checked `known`, stubs and the full-read fallback; version marks (move with the version and derived fields, never the text, apart for two rows at one version).
- `packages/ui/src/data/data.test.tsx` also: `readCached` shares one read and answers from the copy while fresh; a null key reads nothing; the copy keeps no Map, Set or Date.
- `packages/notes/test/integration/boards.test.ts` ("row versions"): every write bumps a board's and a card's version, a raw `update` too; a board read stubs unchanged cards and sends changed ones whole, including a card whose blockers changed; a board save over a moved version is refused with 409.
- `apps/portal/test/watch.test.ts`: the watch's socket, backoff, retry reason and give-up.
- `apps/portal/web/src/write-socket.test.ts`: the tab's socket hands states on and notices a dead one.
- `apps/portal/test/worker.test.ts`: request id becomes the idempotency key; a send goes to `/send` and answers 202; `writes/status` maps Restate's answers.
- `apps/portal/test/writes.test.ts`: `isWrite` matches every service's writes; sends are writes.
- `apps/portal/web/src/sends.test.ts`: every page's action that sends, pressed from a dialog, a row's box and an inline box, plus a hand-drawn call, reaches the real Worker with a request id and the tab's build, and Restate once; a tab on an older build gets the reload line and keeps its words. `packages/ui/src/edit-form.test.tsx`: a form's words survive the stale refusal and the reload. `apps/portal/test/worker.test.ts` ("a tab older than the live build"): the 409s, what passes, and the refusal log.
- `apps/portal/scripts/writes-e2e.ts` (`pnpm e2e:writes`, Chrome on a local preview): the reported case (Inbox reply, row switch, hidden, refused), a reply that lands while hidden, a reload mid-send, Engage DM (draft save lands before the send), Engage comment answer refused while hidden, Drop with undo past its deadline while hidden, the retry reason shown, unsent words back after another app and a reload, a draft moved on the server shown beside unsent words, the list painted from the device copy before its read answers, and a send in one tab read again in another. Then the calendar, a workflow's side panel and a board, each painted from the device copy on a reload and read again after a tab away (a board asking only for changed cards), and a board save refused over a newer one with both names shown. Reads are caught alone or inside a pulse.

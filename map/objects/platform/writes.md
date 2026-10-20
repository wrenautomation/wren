---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-20 @ aa9a34db
entity: packages/ui/src/save/writes.ts:196
---

# writes

The portal's one write path: `WRITES` carries every press, set-aside and hand-drawn write, keeps it until the server answers, and lets any box read how its press went (designs/2026-10-15-one-write-path.md). The read side, the local copy and unsaved edits live beside it in `packages/ui/src/data/`.

## Why this shape

A write's state lived in the component that started it, and only a held-open request could tell the outcome. A row switch, a hidden tab or a reload lost both (William's LinkedIn reply, 2026-10-15). One store per tab owns request ids, pending writes and outcomes; components only read it.

## Shape

- `Writes` (`packages/ui/src/save/writes.ts:196`), the singleton `WRITES` (`:945`): `press` (`:335`) one request id per press, a second press while out gets the first's answer; `hold` (`:352`) an undo window as a wall-clock deadline; `call` (`:387`) every write on the wire, kept in session storage under `wren.writes`; `back` (`:453`) on visible/focus/pageshow/online: due holds go, lost calls resend under their id (`resend` `:619` waits only until the server took the call, never for its outcome), sends asked, reads refresh, hidden outcomes said; a write whose calls all answered but nothing settled is settled from its calls (`decide` `:784`)
- sends are accept-then-track: an `{accepted}` answer makes `call` follow the server's record (`follow` `:657`, `askFollowing` `:718`); one reminder per send (`remindFollowing` `:702`), so a return never piles up chains; `heard` (`:690`) takes a state pushed over the socket, `pushed` (`:683`) slows asking to every 20 s while it's open; `retrying` (`:759`) keeps why Restate is trying again; six unknown answers in a row (`LOST_MAX`) fail the send with its words kept; a send that lands with nobody waiting (after a reload) reads the page again (`settle` `:796`)
- reads: `lastOn` (`:270`), `goingIn` (`:285`), `hiddenIn` (`:297`); React `useHeld`, `useLastWrite` (`packages/ui/src/action.tsx:243`, `:259`); `callOnce` (`:578`) is a record action's press; `WRITES.use` (`:239`) wires reread, toasts and `landed` (the data layer reads again here and in other tabs). `goingIn` is the family's sending write (none while the server is trying it again), so a button draws its busy bar only where `runningOn` (`action.tsx:1129`) finds its own ids: a send on one record never marks a button on another
- the build (wa-ovo): the web build's id, a hash of its emitted files, goes into each page's `<meta name="wren-build">` and `build.json` (`buildId`, `apps/portal/web/vite.config.ts:93`); the tab sends it as `x-wren-build` on every call (`buildOfTab`, `apps/portal/web/src/api.ts:449`); the Worker reads the live one once per isolate (`liveBuild`, `apps/portal/src/worker.ts:123`) and answers a write from another build, or a send naming none, 409 `code: "stale"` (`isStale`, `apps/portal/src/build.ts:27`; `worker.ts:207`); the web says it with a Reload button (`say.stale`, `packages/ui/src/action.tsx:1033`), never as an edit conflict; the words stay in the press, the dialog, the kept box or a `useEditForm` form
- one line under every send box: `SendStatus` (`packages/ui/src/data/status.tsx:48`); one shell mark for offline and waiting writes: `WritesIndicator` (`:91`)
- the web's wire: `call` sends every `isWrite` path through it (`apps/portal/web/src/api.ts:341`), `status` hook at `:508`; the socket, `WriteSocket` (`apps/portal/web/src/write-socket.ts:58`), pings every 30 s and reconnects with backoff
- the Worker: `isWrite`, `SENDS`, `isSend` (`apps/portal/src/services.ts:277`, `:288`, `:300`); a send goes to Restate `/send`, answers 202 and is watched (`apps/portal/src/worker.ts:228`); a refused send is logged by route, handler, builds and reason, never its words (`refusedSend` `:142`); `writeKey`, `retryOf`, `readWrite`, `writeStatus` (`apps/portal/src/writes.ts:24`, `:103`, `:140`, `:181`) read Restate's invocation by idempotency key, the retry reason from the admin API; `WriteWatch` (`apps/portal/src/watch.ts:126`), one Durable Object per person and site, reads with backoff and pushes over `/api/live/writes` (`writesSocketRoute` `:83`)
- the data layer: `QUERIES`, `nameScope`, `writeThrough`, `useLoad`, `readCached` (`packages/ui/src/data/query.ts:36`, `:91`, `:134`, `:192`, `:247`); `Load` (`:160`) says three things apart: `loading` (any read out: a refresh button), `pending` (no answer yet: the only state that draws a skeleton) and `placeholder` (the last key's answer is shown: dim it); a read behind rows already on screen changes `loading` only; the local copy `fitted` (plain data only), `startLocalCopy`, `dropLocalCopy` (`packages/ui/src/data/local.ts:107`, `:143`, `:224`); change-only reads `versionMark`, `changedOnly`, `mergeChanged` (`packages/core/src/records-delta.ts:62`, `:78`, `:103`); the portal's `useCall`, `readCall` (`apps/portal/web/src/load.ts:47`, `:63`) and every records API from `recordsApi` (`apps/portal/web/src/records-api.ts:18`)
- unsaved edits: `EDITS` (`packages/ui/src/data/edits.ts:163`), `useEdit`, `EditConflict` (`packages/ui/src/data/use-edit.tsx:95`, `:154`)
- guards: `writes()`, `edits()` and `reads()` in `scripts/gates.sh:19`, `:27`, `:30` (`scripts/edits-guard.mjs`, `scripts/reads-guard.mjs`, shared file walk `scripts/portal-sources.mjs`); a portal effect that awaits a read, or calls an async function itself (from any file), without `read-ok:` fails lint

## Connected to

- **owned-by:** [[platform/save]]
- **joins:** [[platform/records]] (record actions press through it; lists read change-only), [[platform/worker]] (idempotency key, `/api/writes/status`, `/api/live/writes`)
- **looks-like-but-is-not:** `Saver` (typed values, versions, conflicts), whose saves are writes here too

## If you change this

- **Hits:** every portal write, the Inbox reply box and Engage sends, set-asides with undo, the Worker's send, status and live routes, every read on `useLoad`, every portal read (the reads guard), every text box (the edits guard)
- **Does not hit:** Notes' Yjs sync, dictation, signed-URL uploads, the public booking page's booking

## Surfaces

| Surface | Role |
|---|---|
| portal presses, sends, set-asides | write |
| `/api/writes/status` | read |
| `/api/live/writes` | push |
| IndexedDB `wren-local` | device copy |

## See

- Tests: `packages/ui/src/save/writes.test.ts`, `packages/ui/src/data/data.test.tsx`, `packages/ui/src/data/load.test.tsx`, `packages/ui/src/records-bulk.test.tsx`, `packages/core/src/records-delta.test.ts`, `packages/notes/test/integration/boards.test.ts`, `packages/ui/src/action-run.test.ts`, `apps/portal/test/worker.test.ts`, `apps/portal/test/watch.test.ts`, `apps/portal/test/writes.test.ts`, `apps/portal/web/src/api-send.test.ts`, `apps/portal/web/src/sends.test.ts` (every page's send, from every surface, into the real Worker), `apps/portal/web/src/write-socket.test.ts`, `apps/portal/scripts/writes-e2e.ts` (Chrome on a local preview)

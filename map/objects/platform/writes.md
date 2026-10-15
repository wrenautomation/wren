---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-15 @ 630931a4
entity: packages/ui/src/save/writes.ts:194
---

# writes

The portal's one write path: `WRITES` carries every press, set-aside and hand-drawn write, keeps it until the server answers, and lets any box read how its press went (designs/2026-10-15-one-write-path.md). The read side, the local copy and unsaved edits live beside it in `packages/ui/src/data/`.

## Why this shape

A write's state lived in the component that started it, and only a held-open request could tell the outcome. A row switch, a hidden tab or a reload lost both (William's LinkedIn reply, 2026-10-15). One store per tab owns request ids, pending writes and outcomes; components only read it.

## Shape

- `Writes` (`packages/ui/src/save/writes.ts:194`), the singleton `WRITES` (`:873`): `press` (`:310`) one request id per press, a second press while out gets the first's answer; `hold` (`:327`) an undo window as a wall-clock deadline; `call` (`:362`) every write on the wire, kept in session storage under `wren.writes`; `back` (`:428`) on visible/focus/pageshow/online: due holds go, lost calls resend under their id, sends asked, reads refresh, hidden outcomes said
- sends are accept-then-track: an `{accepted}` answer makes `call` follow the server's record (`follow` `:616`, `askFollowing` `:662`); `heard` (`:639`) takes a state pushed over the socket, `pushed` (`:632`) slows asking to every 20 s while it's open; `retrying` (`:695`) keeps why Restate is trying again
- reads: `lastOn` (`:262`), `hiddenIn` (`:272`); React `useHeld`, `useLastWrite` (`packages/ui/src/action.tsx:246`, `:262`); `callOnce` (`:511`) is a record action's press; `WRITES.use` (`:231`) wires reread, toasts and `landed` (the data layer reads again here and in other tabs)
- one line under every send box: `SendStatus` (`packages/ui/src/data/status.tsx:48`); one shell mark for offline and waiting writes: `WritesIndicator` (`:91`)
- the web's wire: `call` sends every `isWrite` path through it (`apps/portal/web/src/api.ts:345`), `status` hook at `:487`; the socket, `WriteSocket` (`apps/portal/web/src/write-socket.ts:58`), pings every 30 s and reconnects with backoff
- the Worker: `isWrite`, `SENDS`, `isSend` (`apps/portal/src/services.ts:265`, `:276`, `:285`); a send goes to Restate `/send`, answers 202 and is watched (`apps/portal/src/worker.ts:175`); `writeKey`, `retryOf`, `readWrite`, `writeStatus` (`apps/portal/src/writes.ts:24`, `:103`, `:140`, `:181`) read Restate's invocation by idempotency key, the retry reason from the admin API; `WriteWatch` (`apps/portal/src/watch.ts:126`), one Durable Object per person and site, reads with backoff and pushes over `/api/live/writes` (`writesSocketRoute` `:83`)
- the data layer: `QUERIES`, `nameScope`, `writeThrough`, `useLoad` (`packages/ui/src/data/query.ts:36`, `:88`, `:131`, `:176`); the local copy `startLocalCopy`, `dropLocalCopy` (`packages/ui/src/data/local.ts:132`, `:213`); change-only reads `changedOnly`, `mergeChanged` (`packages/core/src/records-delta.ts:56`, `:77`)
- unsaved edits: `EDITS` (`packages/ui/src/data/edits.ts:163`), `useEdit`, `EditConflict` (`packages/ui/src/data/use-edit.tsx:95`, `:154`)
- guards: `writes()` and `edits()` in `scripts/gates.sh:18`, `:26` (`scripts/edits-guard.mjs`)

## Connected to

- **owned-by:** [[platform/save]]
- **joins:** [[platform/records]] (record actions press through it; lists read change-only), [[platform/worker]] (idempotency key, `/api/writes/status`, `/api/live/writes`)
- **looks-like-but-is-not:** `Saver` (typed values, versions, conflicts), whose saves are writes here too

## If you change this

- **Hits:** every portal write, the Inbox reply box and Engage sends, set-asides with undo, the Worker's send, status and live routes, every read on `useLoad`, every text box (the edits guard)
- **Does not hit:** Notes' Yjs sync, dictation, signed-URL uploads, the public booking page's booking

## Surfaces

| Surface | Role |
|---|---|
| portal presses, sends, set-asides | write |
| `/api/writes/status` | read |
| `/api/live/writes` | push |
| IndexedDB `wren-local` | device copy |

## See

- Tests: `packages/ui/src/save/writes.test.ts`, `packages/ui/src/data/data.test.tsx`, `packages/core/src/records-delta.test.ts`, `packages/ui/src/action-run.test.ts`, `apps/portal/test/worker.test.ts`, `apps/portal/test/watch.test.ts`, `apps/portal/test/writes.test.ts`, `apps/portal/web/src/api-send.test.ts`, `apps/portal/web/src/write-socket.test.ts`, `apps/portal/scripts/writes-e2e.ts` (Chrome on a local preview)

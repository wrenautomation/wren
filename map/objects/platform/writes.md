---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-15 @ 630931a4
entity: packages/ui/src/save/writes.ts:185
---

# writes

The portal's one write path: `WRITES` carries every press, set-aside and hand-drawn write, keeps it until the server answers, and lets any box read how its press went (designs/2026-10-15-one-write-path.md).

## Why this shape

A write's state lived in the component that started it, and only a held-open request could tell the outcome. A row switch, a hidden tab or a reload lost both (William's LinkedIn reply, 2026-10-15). One store per tab owns request ids, pending writes and outcomes; components only read it.

## Shape

- `Writes` (`packages/ui/src/save/writes.ts:185`), the singleton `WRITES` (`:845`): `press` (`:304`) one request id per press, a second press while out gets the first's answer; `hold` (`:321`) an undo window as a wall-clock deadline; `call` (`:356`) every write on the wire, kept in session storage under `wren.writes`; `back` (`:422`) on visible/focus/pageshow/online: due holds go, lost calls resend under their id, sends asked, reads refresh, hidden outcomes said
- sends are accept-then-track: an `{accepted}` answer makes `call` follow the server's record (`follow` `:610`, `askFollowing` `:631`) on a backoff reminder and every return
- reads: `lastOn` (`:256`), `hiddenIn` (`:266`); React `useHeld`, `useLastWrite` (`packages/ui/src/action.tsx:244`, `:260`); `callOnce` (`:503`) is a record action's press; `WRITES.use` (`:275`) wires reread and toasts
- cross-tab: `otherTabs` (`packages/ui/src/save/writes.ts:790`) BroadcastChannel, a landed write makes other tabs read again
- the web's wire: `call` sends every `isWrite` path through it (`apps/portal/web/src/api.ts:339`), `status` hook at `:481`
- the Worker: `isWrite`, `SENDS`, `isSend` (`apps/portal/src/services.ts:265`, `:276`, `:285`); a send goes to Restate `/send` and answers 202 (`apps/portal/src/worker.ts:173`); `writeKey` and `writeStatus` (`apps/portal/src/writes.ts:24`, `:39`) read Restate's invocation output by idempotency key
- guard: `writes()` in `scripts/gates.sh:18`

## Connected to

- **owned-by:** [[platform/save]]
- **joins:** [[platform/records]] (record actions press through it), [[platform/worker]] (idempotency key, `/api/writes/status`)
- **looks-like-but-is-not:** `Saver` (typed values, versions, conflicts), whose saves are writes here too

## If you change this

- **Hits:** every portal write, the Inbox reply box and Engage sends, set-asides with undo, the Worker's send and status routes
- **Does not hit:** reads (`console/records*`), Notes' Yjs sync, dictation, signed-URL uploads, the public booking page

## Surfaces

| Surface | Role |
|---|---|
| portal presses, sends, set-asides | write |
| `/api/writes/status` | read |

## See

- Tests: `packages/ui/src/save/writes.test.ts`, `packages/ui/src/action-run.test.ts`, `apps/portal/test/worker.test.ts`, `apps/portal/test/writes.test.ts`, `apps/portal/web/src/api-send.test.ts`, `apps/portal/scripts/writes-e2e.ts` (Chrome on a local preview)

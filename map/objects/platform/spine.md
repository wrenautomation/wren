---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-05 @ f76dff5
entity: packages/core/src/spine.ts:1
---

# spine

The Workflows spine: events move along a workflow's routed wires (`via: "events"`) and run each node's step. Tables `events` (every arrival) and `hooks` (the door's webhooks); Restate service `Spine`.

## Why this shape

A workflow is data (`packages/core/src/workflows.ts`), so one walker runs any of them. One row per workflow, node path, port and subject means nothing enters a node twice. The row's `by` is the Restate call that kept it, so a retried step runs again instead of skipping. A timed wait is that row with `due` plus a delayed `Spine/release`; nothing polls. A step that fails past 3 tries keeps its `error` on the row and the walk goes on.

## Shape

- `events`: `uq_events_entry (workflow, node, port, subject)`; `node` is dotted from the top workflow ("warm.follow"), "out" for its own output. In main and in every client's database.
- `hooks`: main only; `token_hash` (sha256 of a 43-char token), `client` (null is Wren), `workflow`, `input`, `subject` (the payload field, dotted).
- `Spine/emit` (private): events leaving `node.port` or `in.port`. `Spine/release` (private, delayed): a wait is over. `Spine/hook` (public): the phone Worker's door.
- Steps register by part id or custom step name in the worker; none yet. A node with no step keeps the arrival and stops. A custom step at an https URL is POSTed `{port, event}` and answers `{out}`.
- "until <kind>" waits refuse (`waitMs`): nothing uses them yet.

Citations: `packages/core/src/schema.ts:123`, `packages/core/src/schema.ts:156`, `packages/core/src/spine.ts:134`, `packages/core/src/spine.ts:242`, `packages/core/src/spine.ts:298`, `packages/core/src/spine.ts:343`, `apps/phone/src/worker.ts:319`, `apps/worker/src/services.ts:873`

## Connected to

- **owns:** `events`, `hooks`
- **owned-by:** restate-services
- **joins:** workflows by id (code, not a table); `hooks.client` names `clients.id`
- **looks-like-but-is-not:** `run_events` (a run's feed lines), `sms_events` (Telnyx deliveries)

## If you change this

- **Hits:** every workflow with routed wires; renaming a node or port strands waiting rows (release fails terminal) and old arrivals stop counting.
- **Does not hit:** wires `via: "code"`; those parts move work themselves.

## Surfaces

| Surface | Role |
|---|---|
| `wren hooks add/list` (`apps/cli/src/hooks.ts`) | writes hooks; prints the URL once |
| phone Worker `POST /hooks/<token>` | forwards to `Spine/hook` |
| worker (`apps/worker/src/services.ts`) | serves `Spine`; supplies steps and the rule model |

## See

- Source: `packages/core/src/spine.ts`
- Design: `designs/2026-10-05-workflows.md` (The spine)

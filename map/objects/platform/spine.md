---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-05 @ f76dff5
entity: packages/core/src/spine.ts:1
---

# spine

The Workflows spine: events move along a workflow's routed wires (`via: "events"`) and run each node's step. Tables `events` (every arrival), `hooks` (the door's webhooks) and `workflow_saves` (wiring saved on the canvas); Restate service `Spine`.

## Why this shape

A workflow is data (`packages/core/src/workflows.ts`), so one walker runs any of them. One row per workflow, node path, port and subject means nothing enters a node twice. The row's `by` is the Restate call that kept it, so a retried step runs again instead of skipping. A timed wait is that row with `due` plus a delayed `Spine/release`; nothing polls. A step that fails past 3 tries keeps its `error` on the row and the walk goes on.

## Shape

- `events`: `uq_events_entry (workflow, node, port, subject)`; `node` is dotted from the top workflow ("warm.follow"), "out" for its own output. In main and in every client's database.
- `hooks`: main only; `token_hash` (sha256 of a 43-char token), `client` (null is Wren), `workflow`, `input`, `subject` (the payload field, dotted).
- `Spine/emit` (private): events leaving `node.port` or `in.port`. `Spine/release` (private, delayed): a wait is over. `Spine/retry` (private): a failed arrival runs again for the call that took it, its error cleared. `Spine/hook` (public): the phone Worker's door.
- `spine_events` (view): every arrival with `state` failed, waiting or passed. Record `console.event`, the Workflows app's Events page; Retry is `ConsolePortal/retryEvent` (`wren:effect`), which waits on `Spine/retry` and says "Ran again" or "Failed again". Main only.
- `events.sent`, `events.sent_at`: what the arrival's step sent on (`[{port, subject, kind, data}]`, data dropped past 32 KB, `sentOf`), written by `SpineStore.sent` inside the same journaled step. `[]`: the step sent nothing (its own code moves it). Null: not kept (older rows, a wait).
- `spine_executions` (view): one row per workflow and subject. `state` failed, waiting or done; `node` is where it is now (the failed node, else the waiting one, else the newest); `entered`, `last_at`, `steps`. Record `console.execution`; its `load` is every step with in and out data (`executionSteps`, `console.ts`). Main only.
- Steps register by part id or custom step name in the worker, and get `{client, workflow, node, with}` (`with`: the node's settings). Registered: `sms.touch`, `reach.touch`, `watch.triage` ([[watch/mail]]). A node with no step keeps the arrival and stops.
- Follow-ups: `cadenceWorkflow` (`workflows.ts`) makes a cadence a workflow `follow_up.<name>` of touch nodes `s<n>`, waits on the wires. Each text sequence is one (`textCadence`, `packages/channel-sms/src/follow.ts`), and each DM sequence (`reachCadence`, `packages/outreach/src/follow.ts`). A part's own code emits a node's output with `spineEmit`: `SmsSender` and `ReachSender` send `s<n>.sent` for every step they sent, so a wait counts from the send, not the queue. A custom step at an https URL is POSTed `{port, event}` and answers `{out}`.
- `workflow_saves`: main only; one row per save from the canvas, `client` (null is Wren), `workflow`, `edits` (`WorkflowEdits`: the routed wires and custom steps, whole; null is back to the code's), `by`, `at`. The newest per client and workflow runs; older rows are its history. `flowsWith` (`workflows.ts`) merges a save over the code's nodes and built-in wires and checks it. A save that stops passing after a code change is skipped, and the canvas says why. The spine reads the client's saves once per `emit` or `release` call, journaled.
- Saving: `ConsolePortal/workflowSave` (`wren:manage`) refuses a built-in wire, an added step that isn't a custom step at an https URL, an "until" wait, and anything `checkWorkflows` names. A client gets only workflows for clients.
- "until <kind>" waits refuse (`waitMs`): nothing uses them yet.

Citations: `packages/core/src/schema.ts:123`, `packages/core/src/schema.ts:156`, `packages/core/src/schema.ts:185`, `packages/core/src/workflows.ts:263`, `packages/core/src/spine.ts:353`, `packages/core/src/spine.ts:404`, `packages/core/src/console.ts:1178`, `packages/core/src/spine.ts:134`, `packages/core/src/spine.ts:242`, `packages/core/src/spine.ts:298`, `packages/core/src/spine.ts:343`, `apps/phone/src/worker.ts:319`, `apps/worker/src/services.ts:873`

## Connected to

- **owns:** `events`, `hooks`, `workflow_saves`, views `spine_events`, `spine_executions`
- **owned-by:** restate-services
- **joins:** workflows by id (code, not a table); `hooks.client` and `workflow_saves.client` name `clients.id`
- **looks-like-but-is-not:** `run_events` (a run's feed lines), `sms_events` (Telnyx deliveries)

## If you change this

- **Hits:** every workflow with routed wires, and every saved copy of it (a removed node or port makes a save fail its check, so the built-in wiring runs); renaming a node or port strands waiting rows (release fails terminal) and old arrivals stop counting. Renaming a text sequence or its steps strands its cadence's waits the same way. Wherever `SmsSender` or `ReachSender` runs, `Spine` must be bound: their sends go there.
- **Does not hit:** wires `via: "code"`; those parts move work themselves.

## Surfaces

| Surface | Role |
|---|---|
| `wren hooks add/list` (`apps/cli/src/hooks.ts`) | writes hooks; prints the URL once |
| phone Worker `POST /hooks/<token>` | forwards to `Spine/hook` |
| worker (`apps/worker/src/services.ts`) | serves `Spine`; supplies steps and the rule model |
| Workflows app, Canvas (`apps/portal/web/src/modules/wren/workflows.tsx`, pure shaping in `canvas.ts`) | Drawn by the graph kit (`packages/ui/src/graph/`) as nodes (`look.ts`): a role-colored tile, ports per output colored by event kind (`graphOf` passes `ins`, `outs`, `fromPort`), curved wires with a pill, a lavender dot grid (`--ui-graph`). Wires carry 30-day counts, today and the rate from the step before; a spine event runs a dot along its wire (`dotsOf`, polled every 8 s); a funnel of the counted stages under it. Play (`play.ts`, `playback.tsx`) walks a made-up lead down the longest wiring with the live copy filled in, waits cut to seconds; reads only. Edit wiring: drag an output onto an input, a wire's condition and wait, custom steps; `?client=` for a client |
| Workflows app, Canvas > Executions (`executions.tsx`, pure shaping in `trace.ts`) | the workflow's executions by state, searchable by subject; opening one lights its path (`focus`) with each card's state and time, a card shows its in and out data, a failed step its error and Retry (`retryEvent`) |
| Workflows app, Executions | every workflow's executions, the ⌘K way in; its page draws the path the same way |
| Workflows app, Events | failed, waiting and all arrivals; Retry on a failed one |

## See

- Source: `packages/core/src/spine.ts`
- Design: `designs/2026-10-05-workflows.md` (The spine)

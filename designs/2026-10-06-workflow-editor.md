# Workflow editor: n8n-grade, on our own spine (2026-10-06)

William, 10-06: "think we also need an n8n type view of workflows i.e. visual nodes, showing
the steps, etc. (like a comfyui, n8n type thing, not sure. your call)".

## The call

The editor is n8n-style, built on our own workflow model (`2026-10-05-workflows.md`), and n8n
itself isn't used.

- Our model is already n8n's shape: parts with ports, wires with conditions and waits, events
  walked by the spine, and a canvas. What's missing is the editor and the executions view.
- n8n's Sustainable Use License covers internal use only. Offering it to clients needs its
  paid Embed license, and it would be a second engine beside the spine.
- ComfyUI is for data pipelines that run once per click. Ours are long-running and
  event-driven, which is n8n's model. Two ideas come from ComfyUI: ports colored by kind, and
  a preview of each node's last output.

## What's there

The Workflows canvas, on the graph kit, shows:

- parts, nested workflows and custom steps;
- live counts on wires and real-event dots;
- Play;
- a draft of routed wires and custom steps (`wiring.ts`).

The spine keeps every arrival: node, port, event and data, waiting, failed with its error,
and retry.

## 0. Look like nodes

William, 10-06, on the live canvas: "maybe look more node based". Today's canvas draws cards
with stacked shadows, right-angle wires and no ports. Every graph in the kit changes to:

- A dot-grid background.
- Compact nodes: an icon tile colored by what the part does (trigger, channel, logic, AI,
  data, deliver), its name and one line under it, the main number, and a status dot.
- Ports drawn on the node: inputs left, outputs right, each a labeled handle colored by event
  kind. A node with several outputs (replied, no reply, booked) shows each one.
- Curved wires with an arrow, colored by kind, and a pill at the midpoint with the count and
  the condition or wait.
- A nested workflow is a node with a stacked edge and an open icon, not a big card.
- Selection gets a ring, hover lifts the node, and a running or failed node gets a status ring.

## 1. Executions

- A workflow's Executions tab lists subjects ("lead:42") with when they entered, where they
  are now (waiting at a node until a time, done, failed) and how long it's been.
- Opening one lights its path on the canvas. Each node shows the event that came in and the
  events it sent out, as data, with their times. A failed node shows its error, with Retry
  for operators.
- Retry on a step that sends goes through the same gates as any send.
- Search by subject, or by a person or firm (the lead key), from the person's journey and from
  ⌘K.

## 2. Edit like n8n

- **Palette:** every part and workflow from the catalog, plus logic nodes and triggers. Drag
  one onto the canvas, or press `/` and search.
- **Logic nodes**, new parts in core: If (a rule in plain words), Switch, Wait (a time, or
  "until" an event), Split (by percent, feeding experiments), Merge. A custom step covers
  one-off code.
- **Triggers:** door hooks, a schedule, a form, a reply and a booking. Each shows its URL or
  setting on the node.
- **Ports** are colored by event kind. A drag only lands on a matching kind, and the wrong
  kinds dim while you drag.
- **Node panel** (the records side panel):
  - Settings, as a form generated from the part's settings schema.
  - Copy, picked from the template store, with a sample render.
  - The node's last output preview, and its 30-day numbers.
  - Ask Claude, History and Undo, from the edits layer.
- **Whole graph:** Ask Claude with a request like "add a text 2 days after the second email
  if no reply". Claude returns a patch to the graph, shown as a diff on the canvas: green
  added, red removed. Accept applies it.

## 3. Draft and publish

- A workflow has versions, like templates: editing makes a draft, checked by
  `checkWorkflows` on every change, and Publish makes it live. The canvas shows "Draft:
  3 changes".
- Publishing a workflow with a node that sends or spends is William's yes. Every other
  publish is the editor's.
- Running subjects stay on the version they entered, and new subjects take the live one.
- Save as template, and install on a client: the existing Shop path.

## 4. Test

- **Test step:** run one node on a sample event, or on a pinned real one, dry. A step that
  sends or spends returns what it would do and does nothing. Its output shows in the panel.
- **Test workflow:** Play, with real step logic in the same dry mode, so the copy, rules and
  branches are real.
- Dry mode is a flag on `Walk`: `run` returns a stub for effect steps, and nothing is claimed
  in the store.

## Phone

Read, executions and Retry. Editing is desktop only.

## Build order

1. Executions.
2. Palette, logic nodes, ports by kind, the node panel.
3. Draft, publish, Ask Claude on the graph.
4. Test step and test workflow.

Library > Sequences opens a sequence in this editor: a sequence is a cadence on the spine.

## Decision log

- 2026-10-06: William left it to my call. Built on our spine, n8n-style, with ComfyUI's
  colored ports and output previews. Building.
- 2026-10-06: Section 0 built on the kit, so every graph changes (canvas, infra, Map, lineage,
  journey; the run graph gets port rings, lift and a selection ring). Geometry is pure in
  `packages/ui/src/graph/look.ts`: port rows, curves, arrows, pills, shared by the canvas and
  the SVG export. Roles come from the part id's area (`roleOfPart`). The ground is
  `--ui-graph`, paper with 11% of the accent, so it follows the night theme. Fit zoom floors
  at 0.75 and pans past it. Play's wire turns accent and stays lit while its dot rides.
- 2026-10-06: Step 1 built. A step's outputs land on its own `events` row (`sent`, `sent_at`),
  written in the same journaled step, so an execution needs no new table. `spine_executions`
  groups `events` by workflow and subject; record `console.execution`. Executions is a tab on
  the canvas (list left, path lit right) and a page of its own, which is how ⌘K reaches it
  (⌘K jumps to pages; the page searches by subject). Not built: search by person or firm.
  Spine subjects are channel contact ids (`lead:sms:<id>`), and journeys live in client
  workspaces while the spine is main only, so there's no lead key to join on yet.
- 2026-10-06: Step 2 built. Logic nodes are pure entries in `packages/core/src/logic.ts`, not
  Shop parts: every workflow may add them, outside the catalog. Each takes any event kind by a
  `kind` setting, so its ports follow what it's wired to. Wait holds what leaves it, so its
  step just passes. Merge claims both inputs as one port, so a subject passes once. Split
  hashes node and subject, so a subject always lands the same side. The hook trigger works;
  schedule, form, reply and booking draw "In development" and refuse to save. Saving a
  workflow that sends needs `effect`, one that spends `money`, and both need the id typed
  back. Panels float over the canvas, n8n-style, and the drawing fits between them (`inset`).
  The Webhook node's door URL and token wait on Publish (Step 3): "In development".
- 2026-10-06: Step 3 built. A draft is a `workflow_saves` row with `live = false`, one per
  client and workflow. Save keeps it whatever it says, with what won't run; Publish checks it,
  runs the sends/spends gate, and inserts a live row. History lists live rows; Open loads one
  as the draft, to publish again. Running subjects stay on their version: `events.version`
  keeps the save id each subject entered on (0 the code's), and the walker groups a batch by
  it. Ask Claude reuses the record asks (`record-ask` runs, `Ask/edit`); the patch is the whole
  next draft, drawn as a diff, panned to the changes. Undo is client side. The editor zooms no
  lower than 0.7 and pans, so words stay readable. Not built: Save as template and install on
  a client ("In development"); a full `checkWorkflows` on every keystroke (settings and waits
  check live, the rest on Save).
- 2026-10-06: Step 4 built. Dry mode is `Walk.dry`, a step per node, and `packages/core/src/dry.ts`
  runs the spine's own walker on a store in memory with the Postgres claim rules, so nothing is
  claimed, and on its own clock, so a 30-day wait passes at once (capped at 200 arrivals and 50
  waits). Logic runs for real; every rule (wire `when`, If) answers what the test picks, not a
  model. Every other step is a stub: it says "Would send", "Would spend", "Would post to
  <host>" or "Would run <name>", and passes the event on by its outputs of that kind, else down
  every branch. A dry walk follows code wires too, as the parts' code would. Test workflow
  enters at an input or a trigger's output and lights the path on the draft; Test step runs one
  node, or walks the workflow it opens. "Use its last real input" pins a real arrival's data.
  `console/workflowTest` needs `wren:run` only: it writes nothing.

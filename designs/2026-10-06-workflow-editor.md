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

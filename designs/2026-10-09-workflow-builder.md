# AI workflow builder

2026-10-09. Gaps item 9, entry 2 (`2026-10-07-product-audit.md`: GHL Workflow AI Builder, Zapier
Copilot, Maia). The team types what should happen; Claude draws a new workflow as a draft; they
fix it on the canvas and publish through the usual gate.

## Today

Every workflow is code (`defineWorkflow`). A save (`workflow_saves`) adds nodes and wires to one,
per client, as a draft or live. Ask Claude edits an open draft (`workflow-ask.ts`). Nobody can
start a workflow from nothing.

## Shape

- **Made workflows.** Id `made.<slug>`. Nothing in code: the whole graph is its saves. Each save's
  edits carry `made: {name, blurb}`. `flowsWith` reads an unknown id with `made` as a blank base
  (no ports, no nodes; `for` is `wren` when the save has no client, else `client`) and applies the
  edits as it does for any other. So the spine, Schedule clocks, dry tests, executions and History
  work with no new path.
- No new table. Drafts, versions and who saved stay in `workflow_saves`.
- `madeWorkflows(db, client)`: each made id with its newest save (draft or live), name and
  whether it's live. `workflowFor` resolves a made id from it.
- **Build.** `console/workflowBuild {client?, message}`: makes the id from the first words, saves
  an empty draft with `made`, and opens an Ask run on it (the same `Ask/edit` and
  `workflowAnswer`). The prompt adds: a new workflow starts with one trigger. The name is
  his first words until he renames it. Returns `{workflow, ask}`. The canvas opens on it with that ask pending; the diff
  draws against nothing; Accept makes it the draft.
- **Start blank**: the same call with no message: an empty draft, no ask.
- **Publish** is the existing path: checks, the sends and spends yes typed back. Nothing runs
  before it.
- **Rename**: the name field saves `made` on the draft.
- **Delete**: refused while a version is live (turn it off by publishing it empty). Otherwise
  drops its drafts.

## Portal

- Workflows page: a "Made here" row of cards under the drawing (name, live or draft, nodes), and
  "New workflow" with one box: "When a form comes in, text them in 5 minutes; if no reply in a
  day, email." Build, or Start blank. In a client's view (`?client=`) both make that client's.
- A made workflow opens on the canvas at `path=made.<slug>`, the editor open.

## Limits

- Team only, as the editor is. Clients building their own comes with self-serve.
- Save as template: refused for made workflows ("In development"); a template installs onto a
  code workflow.
- Claude never adds a custom step (the Ask rule stands).
- Model: `claude-code:sonnet`, as Ask.

## Shipped

- 2026-10-09: made ids, `madeWorkflows`/`dropMade`, `workflowBuild`/`workflowsMade`/
  `workflowDelete`, rename on save, "Made here" on the Workflows page, canvas opens on the draft.
  Discard before the first publish is refused (delete instead).

## Decision log

- 2026-10-09: William said build it all, no questions until done. My calls: saves carry the
  graph (no table), `made.` ids, team only, delete refused while live.

# Template install: a whole workflow onto a client in one click (2026-10-07)

GHL's snapshot, in our model. Builds on `2026-10-05-workflows.md` (Templates),
`2026-10-07-speed-to-lead.md` (its Install was hidden until this), `2026-10-06-workflow-editor.md`
(drafts, publish), `2026-10-07-templates-live-copy.md` (copy per client) and
`2026-10-07-per-client-runs.md` (accounts).

## Answer first

- A template is a workflow marked for clients, with the parts it installs, each part's settings,
  its copy, and a door when leads come in from outside. It is declared in code beside the workflow.
- Install on a client lands everything at once: each part through the Shop's own install check,
  the copy into the client's database (following Wren's defaults), the workflow as a draft, and the
  door, closed. Nothing starts, sends or spends.
- Publish sends the client's workflow to To approve. A person's yes makes it live: the draft goes
  live, the door opens, the parts' loops start. Decline sends it back to draft.
- Uninstall stops the client's loops and closes the door. Data, copy, settings and saves stay.
  Installing again picks them back up.
- Installing twice changes nothing. After a template update, the plan shows what would change
  before anything does. A client's own copy, settings and wiring are never overwritten.
- A part that needs an account the client hasn't connected still installs, and says "Needs your
  account" with how to connect it.

## Shape

| Piece | Where |
|---|---|
| `Workflow.template`: `parts` (id to settings), `copy` (extra refs), `door` (input, subject) | `core/src/workflows.ts` |
| Plan, install, publish, approve, decline, uninstall | `core/src/template-install.ts` |
| The install check, shared by a lone part and a template | `core/src/installs.ts` (moved out of `console.ts`) |
| `workflow_installs`: client, template, version, state, what it applied, the door, who and when | main, migration 0149 |
| `hooks.open`: a closed door answers 409 and counts the call | main, migration 0149 |
| `Component.comesWith`: a part only a template installs | `core/src/components.ts` |

States: `draft` (installed, not live), `waiting` (asked), `live`, `off` (uninstalled).

The version is a hash of the template's parts, settings, copy, door and wiring. The row keeps the
blocks it wrote. A block still equal to what the install wrote is the template's and may update.
One that differs is the client's and is kept. Copy uses `installDefaults`, which keeps a client's own
version. A client's workflow edits sit on `workflow_saves`. A draft with no edits follows the
template.

## Templates now

- **Speed to lead** (`speed_to_lead`): Texts, Speed to lead, First text, Call now, Text follow-up,
  Text step. Door on its `forms` input, keyed by the payload's phone. Its texts have no default words
  (William writes every text), so the plan says "No words yet" for each.
- **Win back old leads** (`win_back`): Lead reactivation, with its compose prompt. `{}` keeps every
  stage off, so nothing emails anyone. The booked-call block it wires to is listed as not in this
  template.

## Surfaces

- Shop: Templates is its own section, first. A template's page lists the parts with their settings
  and status, the copy, the workflow on the canvas, then Install: pick the client, read the plan,
  install. Installed, it shows its state, Publish, Uninstall, and the changes when the template moved.
- Clients: each client's page lists its templates and their state.
- To approve (Marketing): `workflow:<id>`, Approve and Decline.
- CLI: `wren --client <id> workflows templates|plan|install|publish|uninstall`. The CLI asks and
  never approves.

## Open (William's call)

- Live texts per client: speed to lead lands installed, not live, until William turns texts on.
- Who approves a client's workflow: Wren's admins today, never the client.
- A post to a closed door is refused (409), not held for replay.

## Decision log

- 2026-10-07: written. Parts are listed per template, not every part the workflow touches:
  Win back's wiring reaches the whole outbound stack through Booked call, which would install the
  lead pool and spend. Each listed part's requirements must be listed too (a test checks).
- 2026-10-07: loops start on approval, not at install, so "nothing sends or spends on install"
  holds for every part, reactivation's research included.
- 2026-10-07: the door is made at install, closed, and its URL shown once, so the client's form can
  be set up before going live.
- 2026-10-07: the four speed-to-lead parts run per client through the spine (the door's client,
  `textsOf(client)`, `SmsSender/<c>/fleet`, the client's Speed to lead page). They become ready and
  `comesWith: speed_to_lead`: their own Install points at the template. The dialer stays planned.
- 2026-10-07: a fact a part needs (`requires.facts`, from account setups) and the client lacks
  reads as "Needs your account" in the plan, with its setup step. Like an account, it never
  blocks the install.
- 2026-10-07: a live template's new draft asks again in To approve; the live wiring runs until
  the yes, and a no keeps it live.
- 2026-10-07: the Shop groups by type, Templates first. A part's header facts measure tags by
  their labels, and tags wrap there instead of cutting off.
- 2026-10-07 (review): install asks for the template's name as shown ("Speed to lead"), case
  aside; its id passes too, for the CLI. A client reads "Needs your account"; Wren's team reads
  which ("Needs a phone number"). The part a template is named after reads as its loop. Settings
  render through the shared `Settings` (labels from the form, On/Off, "Not set", lists as items,
  never JSON). The template's canvas fits on load. The client row drops its part ids.
- 2026-10-07: a template can also be saved from a published workflow on the canvas
  (`workflow_templates`, `designs/2026-10-06-workflow-editor.md` step 5). It installs the same way;
  its effects count its whole wiring, not only its parts.

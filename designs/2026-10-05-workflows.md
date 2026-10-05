# Workflows

Living doc. Started 2026-10-05 from William's end-goal notes (`2026-10-05-end-goal.md`) and his calls since: wiring between parts matters most, the radar lives in the UI, every build goes through the component system, and generalization is planned after a part's first use. This is the product those ideas make together. Revise in place and log changes at the bottom.

## The product

Every feature is a part with inputs and outputs. A wire connects an output to an input. Parts wired together make a workflow, and a workflow has inputs and outputs of its own, so it is a part too and nests inside other workflows.

Everything that happens is an event: mail arrives, a form is filled, a webhook fires, a lead replies, a feed posts. An event enters a workflow at an input and moves along its wires. One canvas draws any workflow live, with counts on every wire. A template is a saved workflow with its settings, and a client installs one in one click.

The dashboard, composition, webhooks, long pauses, the mail checker, trigger leads, speed to lead, voice, snapshots and the VSL diagrams all fit this model. Each one is a part, a source of events, a wire or a template.

## Nouns

| Noun | What it is |
|---|---|
| Component | A part. Its manifest (exists) plus inputs, outputs and a hypothesis |
| Port | One input or output. It carries one kind of event and says how it's counted |
| Event | One thing that happened: kind, subject, data, time. Kept in `events` |
| Wire | Output to input, with an optional condition (a rule) and wait ("3 days", "until they reply") |
| Workflow | Nodes and wires, with ports of its own. A node uses a component, another workflow or a custom step |
| Custom step | The escape hatch for a one-off integration: code or a webhook URL, ports declared inline. Drawn and logged like any part |
| Rule | Plain words. Code checks what it can (sender, subject) and a model applies the rest |
| Template | A workflow plus settings and copy. Installing one on a client is GHL's snapshot. An infra template has the same shape, with servers as parts |
| Hypothesis | Written after a part's first use: expected changes, what stays fixed, the config and requirements the next use needs. Each line says whether the code has it yet. Each later use confirms or rejects each line |

## How we build

1. **Component first.** Every build, Wren's or a client's, starts in the catalog: which parts exist, which part is new, how they wire. Nothing ships outside it.
2. **Generalize by hypothesis.** After a part's first use we write its hypothesis on the manifest: what we expect to change, what stays fixed, and what config the next use will need. Each later use marks each line confirmed or rejected, and we generalize to match. The catalog shows it, and a test fails any part without one.
3. **Build the knobs, not just the notes.** The code ships with what the hypothesis names. A part with a pipeline inside is built as a small workflow of steps, and each step's copy, timing and plan is a setting. A piece that could stand alone is its own sub-part. Speed to lead, for example: its steps are the first text, the wait before calling, the call plan and the follow-up. The copy, the wait and the plan are settings, and the follow-up is a sub-part another template can reuse. Opening a part on the canvas shows those steps.
4. **Escape hatches are parts.** A workflow inside a workflow, a part built from parts, a custom step for a one-off. The map, counts and audit cover them too.

## Wires

A wire is built in or routed.

- **Built in:** the parts' own code moves the work today. Sequences hand replies to reply triage through the inbox sync, for example. The canvas draws the wire and counts it from records, but it can't be rewired yet.
- **Routed:** the event log moves it. You can rewire it on the canvas and give it a condition or a wait.

Every new part is routed from day one. An old wire becomes routed when a use needs it, following that part's hypothesis. Its output emits an event where the code already writes the row, and its input gets a handler that calls the code it runs today. The email flow keeps working throughout.

## The spine

- `events`: one table per database (main for Wren, each client's own). One row per workflow, node, port and subject, so nothing enters twice.
- The walker runs a workflow inside one Restate call. An event enters a node, the node's step returns events on its outputs, and the wires pass them on. A step that sends or spends runs in `ctx.run`, so a retry never sends twice. One call per batch keeps Restate's count low.
- A wait is a Restate delayed call, and "until X" is an awakeable that event X resolves. Nothing runs or bills while it waits.
- The door is `POST /hooks/<token>` on the phone Worker. Each hook has its own token, names a client, a workflow and an input, and maps its payload to an event. This is the universal webhook system: invoices, forms, a client's CRM, anything that sends a webhook. cal.com and Telnyx keep their signed routes and emit events as well.

## The canvas

The Workflows app draws any workflow on React Flow, with the layout code the Map and the run view already use.

- A node shows its icon, its name, what it does in this workflow, its main number for the last 30 days and its state (running, paused, held, not installed).
- A wire shows what moves on it and how many ("34 warm replies"), the rate from the node before it, and chips for its condition and wait.
- A nested workflow is a stacked card. Clicking it opens it in place, with a breadcrumb back.
- A custom step is a dashed card with a code mark.
- Clicking a node opens its records. Clicking a wire lists its events.
- Play replays the last week's events as sparks along the wires, on the run view's engine (the reactivation demo uses it). That's the VSL shot.
- On a phone it runs top to bottom, like the run view.
- Editing: drag an output onto an input (the kinds must match), click a wire to set its condition or wait, add a custom step. Saved per client and checked before saving.

The first workflow is Wren's outbound funnel, drawn the way William's diagram meant it. Research is a nested workflow (discovery, crawl, people, verify). Then sequences, replies, booking, reminders and the call, with the no-reply path going through recycling back into sequences. Reach and the SMS sequence sit on it, held and faded. Parts the funnel lacks show as planned cards: visitor ID, speed to lead, the pre-call flow and the 30-day follow-up.

## The Watch

The mail checker and the radar are one workflow, Wren's first routed one. It lives in the Inbox app. Nothing goes to Discord.

- **Sources:** jinwilliam.jin@gmail.com (read only, through autobrowse's `gmail` site) and william@wrenautomation.com (domain-wide delegation). Books already reads both. Feeds come next, from the radar code (RSS and Atom).
- **Triage:** rules in plain words. Code settles a rule that names a sender or subject, for $0. A model reads the rest with every rule in its prompt and answers show, hold or drop, with one line on why. Promotions and social mail never reach the model.
- **Out:** "Needs you" is a queue in the Inbox app. Held mail stays searchable, and a shown email lists held mail from the same sender beside it. The first rule: "Inbox Insiders: hold invoices and receipts. Show order status changes."
- **Hide like this** on any row writes a rule for its sender, plus subject words if you add them. **Show like this** does the opposite.
- **Kept:** sender, subject, a summary, the verdict and why, and a link to the message in Gmail. No bodies. The prod database is private.
- **Runs:** every 15 minutes on the box worker.
- Feed items are scored against our SOPs with the radar prompt and land in the same queue. A flagged one can go deeper with Claude Code on the Mac later. That's the "containerized Claude Code" idea, minus the container.

## Templates

A template is a workflow marked for clients, with default settings and copy. Installing it on a client installs each part it uses with those settings and saves the workflow for that client. Speed to lead comes first (lead door, a text within 60 seconds, a call after a set wait, the follow-up sub-part, booking, reminders), then lead reactivation, which exists. Free templates elsewhere (n8n, GHL snapshots) are a list of what to build. We rebuild their steps and never copy their drawings or words.

## Where each idea lands

| Idea | Lands as |
|---|---|
| One dashboard | The console; every app belongs to a part (exists) |
| Fast composition | Wiring parts on the canvas; templates |
| Infra templates | Templates with servers as parts. Last |
| Diagrams for VSLs | The canvas and play |
| Tenants, branding | Done |
| Custom domains, SSL | Cloudflare for SaaS, once William turns it on |
| Universal webhooks | The door |
| Long pauses | A wire's wait |
| Instagram data | A source part feeding the dossier |
| DMs from recent posts | That source, into AI fills |
| Invoice webhooks | The door, into Books |
| Unified content | The Marketing app, plus feeds in the Watch |
| Claude Code as the analyst | The Watch's model step, with Claude Code for depth on the Mac. No container |
| Client reactivation | A part (held) |
| Trigger leads, LinkedIn triggers | A Signals part: any event becomes a lead with its reason |
| Speed to lead, voice | Parts wired behind the door; the speed to lead template |
| Radar in the UI | The Watch |
| A better funnel diagram | The canvas, with the outbound funnel first |

## Build order

Each step ships and is committed on its own.

1. The model: ports, workflows, custom steps and hypotheses in core, checked by tests. Ports and a hypothesis on every part, each line marked built or not. The outbound funnel declared. Existing parts get their unbuilt knobs when a use or template needs them.
2. The canvas, read only, with live counts. The outbound funnel on it.
3. The spine: `events`, the walker, waits, the door, custom steps.
4. The Watch on the spine, in the Inbox app.
5. Editing on the canvas, saved per client.
6. Templates, speed to lead first.
7. Play.

The end-goal list continues on this base afterwards: custom domains, voice, Signals, infra.

## Costs

- The Watch's model is Cohere Command A on our credits, about $0.003 per email a rule can't settle. At 100 emails a day with promotions skipped, that's about $2-8 a month.
- Restate: one call per Watch run, about 3k a month. We're already past the free tier, which throttles and never bills.
- The canvas, events and the door cost $0.

## Decision log

- 2026-10-05: Written. William: "unify these ideas, make a beautiful product." Generalization is a hypothesis written after first use, then confirmed or rejected by each later use. Escape hatches: workflows in workflows, parts in parts, one-off integrations. The Watch reads his personal Gmail and wrenautomation.com. Same day: the hypothesis covers expected changes and config needs, and the code ships with those knobs (speed to lead: copy, call wait and call plan as settings, follow-up as a sub-part).

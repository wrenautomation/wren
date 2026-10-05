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
| Custom step | The escape hatch for a one-off integration: a registered step name or an https URL, ports declared inline. Drawn and logged like any part. Anything reusable is a component instead |
| Planned part | A component not built yet. Its ports and hypothesis are the design, so workflows wire it today. The catalog shows it as "In development"; once built it keeps its id |
| Rule | Plain words. Code checks what it can (sender, subject) and a model applies the rest |
| Template | A workflow plus settings and copy. Installing one on a client is GHL's snapshot. An infra template has the same shape, with servers as parts |
| Hypothesis | Written after a part's first use: expected changes, what stays fixed, the config and requirements the next use needs. Each line says whether the code has it yet. Each later use confirms or rejects each line |

## How we build

1. **Component first.** Every build, Wren's or a client's, starts in the catalog: which parts exist, which part is new, how they wire. Nothing ships outside it.
2. **Generalize by hypothesis.** After a part's first use we write its hypothesis on the manifest: what we expect to change, what stays fixed, and what config the next use will need. Each later use marks each line confirmed or rejected, and we generalize to match. The catalog shows it, and a test fails any part without one.
3. **Build the knobs, not just the notes.** The code ships with what the hypothesis names. A part with a pipeline inside is built as a small workflow of steps, and each step's copy, timing and plan is a setting. A piece that could stand alone is its own sub-part. Speed to lead, for example: its steps are the first text, the wait before calling, the call plan and the follow-up. The copy, the wait and the plan are settings, and the follow-up is a sub-part another template can reuse. Opening a part on the canvas shows those steps.
4. **Escape hatches are parts.** A workflow inside a workflow, a part built from parts, a custom step for a one-off. The map, counts and audit cover them too.

## Event kinds

A port carries one kind: firm, person, lead, reply (a lead's answer on any channel), call, form, post, video, client, invoice. Add a kind when a part needs one, never a near-synonym.

## The seed

Every workflow lives in code beside its parts and is checked by `checkWorkflows` against the catalog in the worker's tests.

| Layer | Workflows |
|---|---|
| Shared blocks | `research.leads` (discovery, crawl, people, verify), `signals` (visitor ID, triggers), `keep_warm` (follow-up, nurture, replies), `close` (reminders, pre-call brief, outcome, a not-yet back to keep warm after 30 days), `onboarding` (contract, portal, invoices, reviews) |
| Funnels, sold as templates | `outbound` (research, signals, email, texts, DMs, replies, close), `speed_to_lead.steps` (first text, wait 2 minutes, dial, voicemail, keep warm), `paid` (Meta forms into speed to lead), `win_back` (reactivation into close), `content` (planner, posting) |
| Wren | `wren`: outbound, paid, content, onboarding, the Watch, books |

Planned parts, all "In development": speed to lead (its inside is `speed_to_lead.steps`), power dialer, voicemail drop, voice agent, follow-up, nurture, visitor ID, triggers, social reads, pre-call brief, call outcome, the Watch.

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

The first canvas is `wren`, opening into outbound, drawn the way William's diagram meant it. Research and close are nested workflows. The no-reply path waits 90 days and goes back into sequences. Reach and the SMS sequence sit on it, held and faded. Planned parts show as "In development" cards.

Beside the canvas, the catalog shows every part and workflow with its ports, its hypothesis and whether each line is built. That's where the parts get designed and normalized.

## The shop

The catalog reads like an app store: filters down the side, search on top, a card per part or workflow. It is the records layer's Shop template, so any record with status or tags fields can use it.

- **Filters:** type (part, workflow), stage, channel, status (ready, coming, in development), installed, effects, and who it's for. Picks within one filter widen the results; filters together narrow them. Each choice shows how many it would return under every other filter but its own. The URL holds every pick, so a filtered shop is a link.
- **Stages:** find leads, reach out, follow up, book, deliver, content, run Wren.
- **A workflow's channels, effects and status** come from the parts it runs, through nested workflows. It is only as ready as its least ready part.
- **A part's inside** shows as that part, never as a second card.
- **Item page:** what it takes and gives, its inside drawn as a map, how it generalizes (each guess, built or not, and how later uses held), and the workflows it's used in. Parts add needs, settings and install.
- 30-day counts per port wait for the canvas.

## The Watch

The mail checker and the radar are one workflow, Wren's first routed one. It lives in the Inbox app. Nothing goes to Discord.

- **Sources:** William's personal Gmail (read only, through autobrowse's `gmail` site) and william@wrenautomation.com (domain-wide delegation). Books already reads both. Feeds come next, from the radar code (RSS and Atom).
- **Triage:** rules in plain words. Code settles a rule that names a sender or subject, for $0. A model reads the rest with every rule in its prompt and answers show, hold or drop, with one line on why. Promotions and social mail never reach the model.
- **Out:** "Needs you" is a queue in the Inbox app. Held mail stays searchable, and a shown email lists held mail from the same sender beside it. The first rule: "Inbox Insiders: hold invoices and receipts. Show order status changes."
- **Hide like this** on any row writes a rule for its sender, plus subject words if you add them. **Show like this** does the opposite.
- **Kept:** sender, subject, a summary, the verdict and why, and a link to the message in Gmail. No bodies. The prod database is private.
- **Runs:** every 15 minutes on the box worker.
- Feed items are scored against our SOPs with the radar prompt and land in the same queue. A flagged one can go deeper with Claude Code on the Mac later. That's the "containerized Claude Code" idea, minus the container.

## Follow-ups

Texts, DMs and email each run their own sequence today, with the same step shape (a step, days after the last). They become one follow-up part.

- **Steps:** each is `{after, channel, slot}`. The channel is email, text, DM or call, and the slot is the copy. One sequence can mix channels: email, then a text two days later, then a call.
- **Stops** on a reply, a booking or an opt-out, on any channel.
- **Runs on the spine.** Each step's wait is a Restate delayed call, so nothing polls.
- **Moves over by use.** The SMS and DM sequences move first, since they're small and held. Email moves last, after a test run proves it sends the same mail.
- A call step is a task until the power dialer exists.

## Replies

One queue for every lead's answer, on any channel, in the Inbox app.

- **Rows:** email replies, text threads and DM threads whose last message is theirs. Each row shows the channel, who, their words and when.
- **States:** the same everywhere. Needs you, draft ready, answered, left.
- **Answering:** every answer waits on William's approval (as today). Send uses the channel's own path: email approve, a text reply, a DM reply.
- **Reading:** the panel shows the whole thread, whatever the channel. The channel pages stay for detail.
- A client's texts live in their own database, so a client's queue reads theirs and Wren's reads Wren's.

## Ask

A box in the console where William talks to Claude Code about the system, from any page.

- **Runs** on this Mac, as Claude Code under William's Max plan ($0 per question), in `wren_automation`. The desk worker picks up each question and writes the answer back.
- **Read only.** It can read code, designs, the catalog and prod through read-only SQL. It can't edit, send or spend.
- **Team only.** Clients never see it.
- **Context:** the page you asked from goes with the question. Asking from a part's page brings its manifest, hypothesis and wiring.
- **Later:** it proposes a change as a diff for William to approve. It applies and commits only after his yes.

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

Added 2026-10-05, after the canvas: Replies (needs no spine), then Ask, then the spine, then follow-ups on the spine, then the Watch.

The end-goal list continues on this base afterwards: custom domains, voice, Signals, infra.

## Costs

- The Watch's model is Cohere Command A on our credits, about $0.003 per email a rule can't settle. At 100 emails a day with promotions skipped, that's about $2-8 a month.
- Restate: one call per Watch run, about 3k a month. We're already past the free tier, which throttles and never bills.
- The canvas, events and the door cost $0.

## Decision log

- 2026-10-05: Written. William: "unify these ideas, make a beautiful product." Generalization is a hypothesis written after first use, then confirmed or rejected by each later use. Escape hatches: workflows in workflows, parts in parts, one-off integrations. The Watch reads his personal Gmail and wrenautomation.com. Same day: the hypothesis covers expected changes and config needs, and the code ships with those knobs (speed to lead: copy, call wait and call plan as settings, follow-up as a sub-part).
- 2026-10-05, seed: William asked to seed the catalog with every workflow he has described or we've built, composed from shared sub-parts, and for a full UI to work on the design and normalization of parts with me (speed to lead, power dialers, voicemail, SMS, follow-ups, nurture, organic content). Parts not built yet are catalog components shown as "In development". `Own` became only the custom step. Kinds `text` and `visit` dropped: a text reply is a reply, a visit becomes a lead.
- 2026-10-05, shop: William wanted the catalog to look like a shop. His picks: sidebar and card grid, parts and workflows together with a type filter, every filter (stage, channel, status, type, effects), and an item page with takes and gives, inside, hypothesis and knobs, and used in.
- 2026-10-05, normalization: William left three to me. All three are yes. One follow-up part replaces the three sequence engines. One Replies queue covers every channel. Ask lets him talk to Claude Code from the console, read only at first.
- 2026-10-05, canvas: built read only as the Workflows app in Wren's workspace, opening on `wren`. A stacked card opens a workflow, or a part's own steps, in place with a trail back. Numbers are 30-day record stats from each port's `count`, traced through nested workflows to the inner port, the team's only. A line's label sits at its unshared end. A line back into its own node is a note on it. Not yet: the rate between nodes, a wire's events, play, the phone layout. The rate waits on counts for both ends of a wire; events and play wait on the spine.
- 2026-10-05, replies: built as `inbox.reply`, the Inbox app's "Every channel" page and its Waiting tile. Email replies, text threads and DM threads whose lead wrote back, in four states: needs you, draft ready, answered, left. A text or DM is answered when ours came after their last word, needs you while unread, else left. Each row links to its channel's page, where the answer is approved and sent. Not yet: answering from the queue itself, and the thread in its panel. Clients' queues wait on their texts living in their own databases.
- 2026-10-05, Ask: built. ⌘K takes what's typed to Claude Code as a question, with the page it came from; the Ask app (team, `run`) lists questions newest first and checks every 4s while one is thinking. A question is a `runs` row (command `ask`; who, question and page in argv; the answer, seconds and turns in stats), so no new table. `ConsolePortal/question` opens it and sends `Ask/answer`, which calls the desk's `claude/ask` (autobrowse `src/claude/service.ts`) and writes the answer back. The desk runs `claude -p --restricted` in `wren`, reading `autobrowse` and `lander` too, with Bash only for `node scripts/prod-sql.mjs`, env and key files always denied, no MCP and no session kept; 8 minutes at most. Plain text answers, no markdown renderer. A question waits in Restate while the Mac is off. Not yet: follow-ups in one thread, a part's manifest sent along from its page, and proposed diffs.
- 2026-10-05, spine: built in `packages/core/src/spine.ts`. `events` keeps one row per arrival at a node's input, keyed by workflow, dotted node path, port and subject. The row's `by` is the Restate call that kept it: a retry of that call steps again, any other call finds it seen. A timed wait is the target's row with `due` plus a delayed `Spine/release`, so the wait shows in the table. A step that fails 3 times keeps its `error` on the row and the walk goes on, so one bad event never blocks the rest. Every step runs in `ctx.run`, one per arrival. A node with no step (planned parts, and parts their own code moves) keeps the arrival and stops. A custom step at an https URL gets `{port, event}` and answers `{out}`. A wire's rule asks the worker's model yes or no. The door is `POST /hooks/<token>` on the phone Worker, JSON or a form, to `Spine/hook`, which answers 202, 404, 410 (input gone), 413 or 422 (no subject in the payload). Tokens are made by `wren hooks add` and kept as hashes. Not yet: "until <kind>" waits (no wire uses one; they refuse), any part's step (follow-ups are first), and counts from `events` on the canvas.
- 2026-10-05, follow-ups, texts and DMs: built. A cadence is a workflow `follow_up.<name>` of touch nodes `s1`…`sN`, made by `cadenceWorkflow` in core; each wire carries the step's wait. A node can now hold settings (`with`), and a step is told its client, workflow, node and settings. Each text sequence becomes a cadence of `sms.touch` nodes (`packages/channel-sms/src/follow.ts`), and each DM sequence one of `reach.touch` nodes (`packages/outreach/src/follow.ts`). Enroll still queues the opener; on LinkedIn the accepted invite's send queues it, and the sender still waits on the accept. When the sender sends step n, it emits `s<n>.sent` to the spine, so each wait starts at the send, not at the queue. When the wait ends, the touch queues step n+1 due now and the sender paces it as before. A contact who replied answers `replied`; any other end, or an emptied step, sends nothing. The last step finishes the contact. Nothing was in flight: prod had sent no texts or DMs. Not yet: email (last, after a test run), mixing channels (needs one person id across them), and a parent workflow sending a lead into a cadence (the first touch only queues for an enrolled contact).
- 2026-10-05, the Watch: built in `packages/watch`. `Watch/all` on the box reads both inboxes every 15 minutes, from an hour before the newest email kept, with promotions, social and chats left out of the search. The first run looks back 2 days. Each email is a `watch.mail` row with sender, subject and Gmail's preview, sent along the `watch` workflow as `mail:<row id>`. The workflow is `read.mail` → `triage.mail` → `out.needs_you` or `out.held`, and `drop` goes nowhere. Triage forgets the preview once it has read it. A rule with a sender (an address or a domain) and a verdict settles in code. Otherwise Cohere reads the email with every rule's words in its prompt. With no model, an answer that doesn't parse, or a step that keeps failing, the email shows. The Inbox app has Your mail (Needs you, Held, Done, All) and Mail rules, admins only. Done can be undone for 10 seconds. Hide like this writes a rule holding that sender (subject words narrow it) and holds what's still waiting from them. Show like this writes the opposite rule and shows that email. A row links to Gmail and to the sender's held mail. The Inbox Insiders rule is seeded and read by the model. Mailbox access moved to `@wren/core/mailbox`, shared with the books. Costs as planned: 2 Restate calls per run that finds mail, not 1 (the read, then one emit). Not yet: feeds (the radar is another session's work in `packages/research/src/radar`), held mail listed in the email's own panel (a link to the filtered list for now), and Claude Code going deeper on a flagged item.
- 2026-10-05, the Watch, first run: 65 emails from 2 days, 43 shown. Most were mail our own agents caused while setting up accounts: Wren sign-in codes, verify-email, welcomes, orders received and finished. The model read "account or security problem" too broadly and stretched the Inbox Insiders rule to every order. The prompt now says a sender's rule covers only that sender, and agent-caused notices are held unless a step is still his. Sort again (Inbox app, or `wren watch sort`) re-triages what's waiting under today's rules and prompt. The preview is gone by then, so it reads sender and subject only.

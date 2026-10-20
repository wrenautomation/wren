# Business Map

2026-10-19. William: the core of Wren is a visual map of the business, offers and the pipeline first. "A graph that is sort of a map of the business that you can build out from scratch, and then being able to both visually see the business at a high level, and then navigate into sections and manage it directly." Unidirectional, a directed graph, drawn like a Sankey. "Keeping the polymorphism of all the objects, since you can have an offer that is in and of itself a good offer that makes you a lot of money, that also upsells to a 10x backend." Version control, so the business stays "managed, organized, and disciplined". First Wren's shape, then Career Clarity Labs', then run their content and processes on it.

This doc replaces the ordered funnel of `2026-10-18-pipeline-first.md` with a shape graph. Journeys (`2026-10-18-journeys.md`) and the reshape (`2026-10-19-portal-reshape.md`) stay; the Map becomes home.

## Today

- `FunnelBody` is a list: `{name, offer, stages[] ordered, entries[]}` (`packages/pipeline/src/model.ts`). Three live funnels (organic, linkedin-dm, ads) share one offer. A person is at one stage of one funnel. An upsell has no place; a second funnel into the same offer is a second list.
- Versions exist for offers, terms and funnels (`offerVersions`, `termsVersions`, `funnelVersions`); journeys pin a funnel version. Numbers are per stage and per entry (`numbers.ts`, views `stage_counts`, `stage_flow`, `entry_numbers`).
- The GUI reads: Deals board, journeys, funnels pages; offers and terms pages. The one write is "Propose terms version". Offers and funnels are edited by CLI (`wren offers add`, `wren funnels append`).
- A graph kit exists: `packages/ui/src/graph/canvas.tsx` (`GraphCanvas`: nodes, edges, layered or lanes layout, `GraphEdit` with ends, connect, pick; palette drop; `onOpen`), on `@xyflow/react` and `elkjs`. The Wren workflow editor uses it with a palette (`apps/portal/web/src/modules/wren/editor.tsx`); `modules/sites/funnel-graph.tsx` draws a read-only graph.
- Home `/` is Today (`apps/portal/web/src/today.tsx`).
- One business = one database. Wren's DB is Wren's; a client's DB is theirs (tenancy). So one shape per DB.

## Target

One **shape** per business: a directed graph with gravity toward money, drawn top to bottom, edges as ribbons whose width is the number of people who crossed them in the window. The Map is home. Every node opens the app that manages it. Every edit is a version. People sit on nodes; money sits on plan nodes.

### Model

`ShapeBody { name, nodes: Node[], edges: Edge[] }` in `packages/pipeline/src/model.ts`, replacing `FunnelBody`.

| Node kind | Is | Fields | Opens |
|---|---|---|---|
| `source` | where people come from | `channel` (youtube, linkedin, reddit, ads, referral, sourced, manual), `campaign?` | Marketing for that channel; Outreach for DMs; Ads |
| `step` | something a person does or we do | `action` (comment, reply, dm, cta, visit, book, held, proposal, signed, ...), `advance` rule (as today's `Stage.advance`), `idleDays` | the list of people on it (journeys filtered to the node) |
| `offer` | the thing sold | `offer` id (versioned in `offerVersions`) | Offers page |
| `plan` | how it is paid | `terms` id (versioned in `termsVersions`): setup, monthly, unit, share, floor | Payments and deals |

`Edge { id, from, to, kind: flow | loop, label? }`. A `flow` edge points down (toward money). A `loop` edge points back up (re-entry after a drop, lead recycling) and is drawn dashed and left out of layering. The graph of `flow` edges must be acyclic; the store refuses a version that breaks that.

Polymorphism is in the edges, not the types. An offer that also feeds a backend is an `offer` node whose `plan` node has a `flow` edge out to the next offer's first `step`. A webinar that is both an end and a funnel is one `offer` node with two outgoing paths. Adding an upsell later is adding a node and an edge below a plan; nothing above changes.

`depth(node)` = longest `flow` path from any source. It replaces `stage` order where code needs an order (board columns, `stage_counts`, `stage_flow`). The 19 files that read ordered stages read depth. `moves.ts` moves become edge crossings: a person moves along an edge that exists; a move to a node with no edge from the current one is refused, except by an operator with a reason (recorded).

Journey: `{ node, trail: [{edge, at}], version }`. Position is the deepest node reached; the trail is every edge crossed. Entry = the source node and its edge.

### Versions

Every change to the shape writes a `shapeVersions` row (append only: body JSON, author, note, at, parent). Journeys pin the version they were opened on; a person on a node that a later version removed stays on it until moved (the Map draws a removed node that still holds people as a ghost). `wren shape diff <a> <b>` and the Map's History panel show nodes and edges added, removed and renamed. `wren shape export` writes the body as YAML for a commit (Wren's own to the private sops repo, never the public wren repo: it names clients and amounts); `wren shape import` makes a version from a file. The DB stays the source of truth; the file is the committed snapshot William asked for ("source of truth / github + GUI").

### Numbers

Per node: people on it now, arrived in window, left in window, median days there. Per edge: crossings in window (ribbon width). Per plan node: scheduled and collected money in window, from `pipelineDeals` and `schedule.ts`. The existing `NumberRow` kinds `stage | entry | offer` become `node | edge | offer`. The window is the Map's (7, 30, 90 days, all).

### Map page

Home `/` is the Map. Today docks on the right as a panel (collapsible, remembered per viewer). Deals keeps board and journeys; its funnels page goes.

- Layout: `GraphCanvas` layered, direction down. Node width by kind; ribbon edges weighted by crossings (a Sankey look: `@xyflow/react` custom edge with a path whose stroke width maps to the count, min 2px, max 48px). Loop edges dashed, thin. Colors per node kind from the design tokens; money nodes carry the accent. Motion: ribbons grow in on load, counts tick on change. High ticket: dark canvas, no grid, type and whitespace, no chrome.
- Each node shows its name, its kind glyph and one number (people now; for a plan, money this window). Hover: the four numbers. Click: a details panel (people on it, recent crossings, the open-in-app link). Double click or the panel's Open: the managing app, filtered to the node.
- Window picker and client picker (business switch) in the top bar; the client picker is the existing tenancy switch.
- Edit mode: palette of the four kinds (the workflow editor's palette component, new entries), drag to add, connect by handle, rename inline, remove (refused while people sit on the node; the panel shows how many and offers to move them). Save writes a version with a note. History panel lists versions; pick two to see the diff; restore writes a new version with the old body.
- Empty DB: the Map opens with a starter palette and a "Start from Wren's shape" button that imports the committed starter (a kind-only template, no names or amounts).

### Map page, M2.1 (William, 2026-10-19)

The Map is its own surface at `/`: full canvas, edge to edge. It replaces "Today docks on the right" above.

- Today leaves the docked column. A control on the Map opens it as a sheet (slide-over). On a phone it stays a tab. The canvas never shrinks when Today is closed.
- Theme follows the app: light stays light, dark stays dark. App tokens only; no dark Map on a light app. This replaces "dark canvas" above.
- High ticket: ribbons with depth, a calm palette from the tokens, node cards with weight, numbers on hover, soft corners. Motion only on real events (a person moves, a number changes). No decorative loops.
- Node panel and History are overlays on the canvas (sheet or popover). They never squeeze the graph. Edit mode (M3) follows the same rule: the palette and the edit panels float over the canvas.
- No new palette or type scale: the design language is still deferred.
- Stories: full canvas with Today closed, Today open as a sheet, the phone tab, dark theme.

### CLI and agent

`wren shape show|versions|diff|export|import|add-node|connect|remove|move`. Same records through `/api/agent` (`pipeline.shape` record with actions version, diff, import). The agent SKILL gains a shape section.

### Seeds

1. Wren's shape, from `sops/direction/2026-10-18-business-direction.md`: sources youtube, linkedin (organic), reddit, instagram, facebook, x, tiktok, threads, linkedin-dm (outbound), ads (parked, present); steps comment → reply → dm → cta → visit → book → held → proposal → signed; offer Growth Partner; plans share-only (first partners) and setup + share + floor (after); loop edges from dropped steps back to dm after 90 days (today's recycling rule). The three live funnels fold into this shape as paths; journeys keep their position by mapping stage key → node id.
2. Career Clarity Labs' shape, in its client DB: sources youtube and linkedin; steps follow their funnel to a booked call and a sale; offer their program; plan their price with Wren's 15% share recorded on the deal (the share is Wren's terms, not their plan). Seeded from the access and direction notes in sops; names and amounts never in the public repo.

## Not in scope

- Automatic placement of people from signals beyond today's triggers (comments, DMs, bookings, payments already move journeys).
- Forecasting on the Map.
- A public or client-facing view of the Map.

## Order

1. **Model and store** (xhigh): `ShapeBody`, `shapeVersions`, depth, journeys trail, moves as edges, numbers per node and edge, migration (funnels → one shape, stage keys → node ids, journeys keep position, versions kept), CLI `wren shape`, records. Views `stage_counts`, `stage_flow`, `entry_numbers` renamed to `node_counts`, `edge_flow`, `source_numbers` with the old names kept as views over them for one release.
2. **Map page, read**: home `/` with Today docked, Sankey edges, node panel, window and client pickers, drill-downs, History read-only. Stories for the page and the parts (`gates.sh ui`).
2.1. **Map surface** (William's feedback on M2): full canvas at `/`, Today as a sheet, theme matched, overlays for panels. Built with M3's UI.
3. **Editing and seeds**: palette, connect, rename, remove guard, save with note, diff, restore, import/export, starter template, Wren's seed and the CCL seed.

## Decisions

- Directed graph with gravity, not a lattice or free web. Why: William: "unidirectional ... kind of like a directed graph". Every path ends at money; loops are explicit and drawn apart so the picture stays readable.
- Kinds by edges, not type unions. Why: an offer that is also a funnel needs no second type; adding an upsell is one node and one edge below a plan.
- Depth replaces stage order rather than removing order. Why: 19 files and three views need an order; depth gives one without a second model.
- Versions append only, journeys pin one. Why: the same rule the funnels use today; a diff and a restore fall out of it.
- Export to the private sops repo. Why: the shape names clients and amounts; wren is public.
- Build on `GraphCanvas` and the workflow palette. Why: library first; the editor exists and is tested.

## Decisions (planner, 2026-10-19)

Calls the doc left open. Briefs in `designs/briefs/2026-10-19-business-map-*.md`.

- One open journey per person, not per funnel. Why: one shape per DB; an upsell is the same journey going deeper. Migrate keeps the deepest of two open ones and drops the other with a reason.
- A source node keeps today's entry fields under `via` (organic, outbound, ads, referral, sourced, group, manual) plus `parked`. Why: `kind` is the node kind; the entry rules already work. The `funnel` entry kind goes: an edge from a plan or offer does it. `parked` replaces a funnel that is off.
- Nobody sits on a source. An opening crosses the source's edge and lands on its target. Why: matches today's entries; a source's numbers are the journeys it opened.
- The deal is made on arrival at an offer node; arrival at a plan node signs it when live terms exist. Deals are unique per journey and offer node, so an upsell is a second deal.
- Automatic moves take the shortest flow path; every edge on it is a crossing, the nodes between are skipped. Why: today's skip rule, on edges.
- A journey never arrives twice at one node in one version (`events` is unique per workflow, node and subject). A move back is refused with "drop and reopen". Crossing a loop edge closes the journey and opens a new one at the loop's end. Why: one journey is one pass down the graph; re-entry is a new journey, as lead recycling is today.
- Loop edges are drawn and can be crossed by hand or CLI. The 90-day automatic recrossing is not built. Why: "Not in scope" (no new automatic placement).
- Versions carry open journeys to the new version, as funnels do. A journey on a removed node stays on its old version: that is the ghost, and it moves by its old version's edges. A save may carry `moves` (old node to new node) to remap.
- Depths are stored on each version row (`depths`, from `depthOf`). Why: versions never change, so SQL readers (segments, merge, views) read a column, not a recursive query.
- The trail is a column on `journeys` (`{edge, from, to, at}`), rebuilt from events like the rest of the row. Why: segments' "reached" and the panel read it without a body join.
- Migration in two steps. 0306 (was 0304 before the keys migrations landed) is additive and old code runs on it. `wren shape migrate --all` (in the deploy, after `migrate`, a no op once done) builds v1 from the funnels and moves journeys and deals onto node ids. M3 adds the guard, the one-open index and drops the old columns. Why: a deploy runs migrations before the Lambda changes; a pure SQL conversion would be untested.
- Old numbers views stay as views over the new ones; numbers count only `shape.v%` events. Funnel-era numbers (one day of history) are not carried.
- `wren pipeline seed` and `fold-deals` are deleted. Why: both ran on prod (wa-8pi.11, wa-8pi.3) and the deals tables are gone.
- The funnels page goes in M1, not M2. Why: its record goes with the model.
- Shape files are YAML via the `yaml` package. Import may also carry `moves` and `terms` (added through `addTerms`), so a seed file holds the shape and its prices in one commit.
- M3 adds a `growth-partner` registry offer (name "Growth Partner", status `draft`, a one-line blurb from the private direction note, no amounts and no pitch copy). Wren's offer node names it. Partner-1's terms get a new version under it; the old version under `reactivation` stays in history. Why: main's call; the lander export reads only live offers, so nothing publishes until William writes the page.
- "Signed" is arrival at the offer node, not a step before it. Why: the deal is made on offer arrival; a "signed" step would make it twice.
- Real shapes live in the private sops repo (`shapes/wren.yaml`, `shapes/career-clarity-labs.yaml`); main imports them on prod with `wren shape import`. Terms William has not set stay out of the files: a plan node with no live terms signs nothing.
- 0306 indexes `journeys.shape_version` and `shape_versions.parent`. Why: the schema test wants every foreign key column indexed.
- M3 runs in two parts: backend (starter, Growth Partner offer, moves remap deals, guard migration) next to M2, then the Map edit UI after M2. Why: the backend touches no Map files; it saves a serial step.
- M3 removes `wren shape migrate` and its deploy step. 0307 guards (every journey on a node and version, one open journey per person), drops the funnel columns and renames `shape_version` to `version`. Why: after 0307 migrate has nothing to read; prod ran it in the M1 deploy (v1: 17 nodes, 16 edges). An empty database starts from `starter.yaml` (`wren shape start`).
- `offers:export` leaves out draft offers (before, the snapshot did not filter by status). Why: the Growth Partner draft must not reach the lander until William writes its page.
- M2.1 goes to the M3 UI builder, in the same worktree and commit series. Why: both change the same Map files (MapPage, Home, NodePanel, History); two builders would conflict.

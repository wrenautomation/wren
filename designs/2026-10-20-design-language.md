# Design language and the metro map

2026-10-20. William, on artifact v12: "keep this artifact up we are using this as the source of truth for the full redesign, and well iterate through this artifact as well." Green light to build.

**Source of truth:** the private artifact "Wren design language" (claude.ai/artifact/SuhuZqr8NPMQMDdd5UKWuu, v22). The artifact wins over this doc when they differ. A copy of its source at v23 sits in `designs/2026-10-20-design-language/`: `design-language.src.html` (every section, sample data only), `metro-render.js` and `metro-render.css` (the renderer every map on the page uses). Builders port from those files. They never fetch the artifact.

This doc supersedes the "banded funnel" form decision in `2026-10-19-business-map.md`. The shape store, drafts, history, blame, undo, tags and the git mirror from that doc stay.

## Sections of the artifact, and who builds them

| Artifact section | Is | Area |
|---|---|---|
| 01 Tokens and type, 02 Leaf and sweep, 03 Parts, 10 What changes in DESIGN.md | tokens, radius, sweep, press, case | A |
| 04 Metro map, 05 Zoom levels, 06 Scenarios, 09 Logic | lines, stations, tracks, capsules, logic marks, zoom | B (draw), C (store) |
| 07 The map in the app | Map home, Today from person tracks, sidebar | D, E |
| 08 Offers, plans and bundles | pricing model, delivery loops, rewarm | C |
| 11 Target state | the shape model inversion | C |
| 13 To check | sidebar and focus view plans | E, F |
| 14 Loading | every wait and what it shows; rules for the portal below | A (rules), every UI area |

## Areas

**A. Tokens and parts.** Every row of artifact section 10: sentence case everywhere (buttons 650, group labels 12.5/650 ink-3), leaf radius pairs (panel 6/24, button 6/10, chip and nav 3/10 to 12; window and sheet stay 14), the lavender sweep on panel and band tips, night accent `#a596d6`, the press edge (`--edge`, sinks 3 px), Figtree only, line tokens `--l0`..`--l7` with night variants. In `packages/ui/src/tailwind.css` and `DESIGN.md`. Client looks keep the Quiet Client Rule and their own presets.

**B. Metro renderer.** A typed port of `metro-render.js` and `.css` into `packages/ui/src/metro/`: pure layout and SVG output from a plain data shape (lines, stations, tracks, exits, transfers, capsules, logic marks, chips, pills, interrupt frames), plus a React wrapper with zoom (Parts, Groups, Stations), folds and fold tabs, keyboard focus and hover. Every mark in sections 04, 05, 08 and 09. Stories: each section's examples as stories (render, play, axe; no pixel compare). Custom code: no library draws metro maps with these marks. xyflow and elk stay for the workflow editor.

**C. Shape model.** Artifact section 11 in full, then section 08.
- C1: offer becomes a line `{offer, tier: out | front | core, colour}`; sources become outreach lines into one hub; steps become stations `att | time | cash` by action; plans become cash stations that point at an offer or bundle; edges become tracks `{by: system | person, owner?, promise?}`; loops become exits or grey lines back to the hub; groups `{id, name, line, stations[]}` (one level); a column per station (marketing, sales, delivery, money). Logic from section 09 as station and track kinds: condition, race, split and join (rule all, any, n of m), A/B with weights, approval, shared flow (link), interrupt frame, and the chips (retry cap, hold, version).
- C2: section 08 pricing model: offers carry packages, plans, add-ons, guarantee, terms; bundles, credits on transfers, purchases that write money events; delivery steps `once | loop`, the loop ring with its bill and decide steps, rewarm lines with a cap.
- Both: the export and import YAML format (`exportShape`, `shapes/*.yaml` in sops), `diff.ts` change keys, `historyOf` and undo move to station and track ids. Numbers per station and track replace per node and edge.
- Migration in two steps, as the business map did: first additive (old code runs on it, a CLI converts each live shape to a new version and maps journeys and deals by id, history keeps old ids). Then the guard and drops, in a later commit.

**D. Map page on the renderer.** Home `/` draws the live shape with B: zoom, folds, node panel and History as overlays, Today from person tracks (owner and promise, late first, hover lights the line). No GUI editor (William, 10-21): the old graph edit mode goes. A draft draws on the Map under a banner (name, base, author) with its diff marked (added, changed, removed), plus Apply and Drop. Numbers read per station and track by id; a converted station keeps its node id, so today's numbers carry over. The hub shows a lead count read from People. Needs B and C1 (both on main). Then the prod convert, then C1 Part 4 (held).

**E. Sidebar** and **F. Focus view**: proposals, below. Built last. William checks them in the artifact (section 13).

## Proposal E: sidebar (William, 2026-10-20; built last)

William: "our dashboard sidebar should be minimized a lot more, all those tools are conditional, and come attached to certain nodes / workflows. those systems are still first class, and within our admin system, i think all of them should be shown (but some of them will be for debugging, and some of them will actually exist as part of a real shape of our business, like platform outreach and youtube posting for example)."

- The sidebar holds five items: Map (home), Inbox, People, Money, Admin.
- Every other app opens from the station, track or line that uses it. Each station kind and channel maps to its app (YouTube outreach line opens Content on YouTube; a DM station opens Outreach). Until D lands, the Map's node panel "Open" link carries this.
- Admin → Systems lists every app in two groups. "On your shape": the app is attached to a live station; the row names the stations. "Not on the shape": debug and internal tools (handlers, loops, review, marketplace, and the like). A parked app shows in neither group.
- ⌘K finds any app, page or station.
- Pins: a person can pin an app to the sidebar under the five items. This keeps daily tools (Studio, Engage) one click away. Pins are per person, stored with the viewer prefs.
- Phone dock: Map, Inbox, People, plus the person's first pin.
- A client workspace gets the same five items. Clients see Admin → Systems only with the settings permission.

Open for William: pins vs recents for daily tools; whether a client sees Systems at all.

## Proposal F: focus view (William, 2026-10-20; built last)

William: "a system to isolate and open just a monthly retainer of the whole system, or even just a particular booking meeting, as it might have some data connected to it: links, funnels, sops, etc."

**F. Focus view.**
- Any line, group, station or shared flow opens on its own page at its own URL: `/map/<kind>/<id>`. The page draws only that part with B's subset mode. Stub tracks at its edges name where people come from and go to; click a stub to focus that part.
- A breadcrumb leads back: Map › Growth Partner › Monthly loop › Review call. Esc goes up one level.
- Beside the map, an attached panel lists what the part holds: SOPs, links, funnel pages, docs, templates, notes, and the apps it uses. The panel reads `attach[]` on the part and on every station inside it. Add and remove from the panel.
- Below, the people on it now and the numbers for that part only (the Map's window).
- A shared flow (the link mark) is a named sub-shape. Every link station that uses it opens the same focus page, which lists the offers that use it.
- Open in a new window: every focus page is a plain URL, so ⌘-click and the browser's own tabs and windows do the isolation. Wren builds no tab bar of its own.

Why no in-app tabs: the browser already has tabs, windows, history and restore. A URL per part gives all of them free, and links work in Slack, notes and SOPs. A custom tab bar duplicates that and breaks on a phone.

Open for William: should a focus page allow edits (a draft scoped to that part), or read and attach only at first.

## Proposal G: editing the shape (William, 2026-10-21)

William: "the metro map has no gui editor thing which is fine, but you are able to edit and we are able to iterate on it correct? Thinking of two editing modes: claude / llm conversation and you editing it with cli or skill or code edits (needs to support multi user in the future, extensible) and you making edits by looking at our draw.wrenautomation stuff as well."

Today: edits go through a file. `wren shape export`, edit the YAML, `wren shape draft new`, then `propose` and `apply`. Claude can edit and iterate this way now. The graph commands (`add-node`, `connect`, `remove`) refuse metro bodies once C1 Part 4 lands.

Target:
- One edit path: typed ops on a draft. Ops add, rename, move and remove lines, stations, tracks and groups, set a field, and attach or detach a ref. Each op names ids, so ops from many people merge.
- Every editor writes ops:
  1. CLI `wren shape edit <draft> <op>` and the agent skill: Claude in a session, any agent through `/api/agent`.
  2. Conversation: a chat beside the Map. The model calls the same ops as tools. The draft draws live beside the chat.
  3. Sketch: Claude reads a drawing on draw.wrenautomation.com (excalidraw skill), writes ops into a draft and shows the diff.
  4. Code: edit the YAML file, then `draft new`, as today.
  5. A GUI later, on the same ops.
- Nothing edits live. A draft becomes a new version only when a person applies it after they review its diff on the Map.
- Multi user: each person keeps their own drafts. Apply checks the base. If live moved since, the draft merges by id: changes to different stations and tracks merge; one field changed on both sides is a conflict that shows both values. The merge uses the change keys of `diff.ts`.
- No CRDT or live co-editing (Yjs, Automerge). Why: shape edits are rare and reviewed; drafts and an id merge give multi user without a sync server. Look again if two people must edit one draft at once.
- Extensible: a new mark is one new op kind and one schema case; every editor gets it.

Order: G1 (ops, CLI, skill, merge) builds with D. G2 (Map chat) builds after D. Sketch needs no code past G1, only the skill steps.

## UI soundness (William, 2026-10-20, green light on everything)

William: "make sure ui is principally sound (tanstack query, similarly sleek loading animations, popups close when they should on user clicks, state persists appropriately ex. one loading we click to another it isn't we click back if its still loading it shows, etc.)"

- Data through TanStack Query only. No fetch state in components. A query left while it loads still loads, then shows, when the person comes back; the cache holds it, never the page.
- Loading per artifact section 14: nothing under 150 ms; skeleton, or the ring beside what refreshes, up to 1 s; words past 1 s; steps and "you can leave" past 10 s. Old data stays on refresh. A button keeps its label and width while busy. Never a spinner in place of a label, never a layout shift.
- Popovers, menus and sheets close on outside click and Esc. One open at a time.
- Per-viewer state (open sheet, zoom, pins, filters) persists across navigation.
- Empty, error and offline each look different from a wait. Error: one sentence and Retry.
- Reduced motion: shimmer and draw-in go; the ring stops and shows its tail still.
- No loading bars or sweeps anywhere (William, 10-21). The ring is the one busy mark: beside the label in a button, beside the title on refresh, in the AI chip, inside the ⌘K input, in a modal.
- Steps (William, 10-21, "the path was not done correctly", redone as section 14 "Long job"): any wait with stages shows its steps. Each step names what it does and with what. The status line cross-fades on a timer, never on every frame (the old one flickered). Sources and targets fold in as small cards that carry the platform's real logo in its brand colour (Simple Icons, CC0: the `simple-icons` npm package; a plain site gets a globe), then stack into a deck with a count when the step is done. Past ten seconds: a clock and "you can leave". Done, the whole thing folds to one line that stays as the record and reopens on click. One component for research, send, import, video render, map open.
- Numbers never count up or jitter (William, 10-21). A changed number fades in once, on refresh and on first load.
- Busy state: one plain ring (William, 10-21: Flight and the bird variants dropped). A faint track and one accent arc that turns, 0.8 s a turn. 40 px in a modal, 18 px in a running step, 14 px elsewhere. It needs the `spin` keyframes. One component, no variant prop. Places: the running step, the optimistic chip ("Approved" + ring until the server answers), the pager count while a page loads, a tab whose query still loads, a button beside its label, a panel title on refresh, the AI chip, the ⌘K input, a modal.
- Pagination stays (William, 10-21: "everything should be paginated as well, it already is, just don't remove that"). The next page loads in place at the same height. No infinite scroll.
- Map first load: the line draws over ~2.4 s, stations land as the line passes, labels fade in with their station, numbers tick last.

Systems page (E): William calls the row list "a bit incoherent", fine for a first cut. Flesh out later, no input needed.

## Order and push policy

Tonight: A, B, then E (planner 1, at most 2 builders) and C1 with `attach` and `flows` last (planner 2, 1 builder at xhigh). At most 3 builders across both. Then D, C2, F.

Push: A, B and E push when the hand-off gate passes; they are UI and reversible. C1 pushes only its additive half (schema, types, renderer data shape, converter as a CLI that is not run on prod). The conversion run on prod and the guard and drop migration wait for William's yes.

## Decisions

- The artifact is the source of truth; the repo holds a v12 copy of its source for builders. Why: William iterates in the artifact; builders need a fixed input they can read offline.
- Metro replaces the banded funnel. Why: William picked the metro language through artifact v1 to v12; colour is the offer, weight is the job, the icon is what the person gives.
- One renderer for the artifact, the stories and the app. Why: the spec and the app draw from the same code (section 10, "Map marks").
- E and F go last and stay open to change. Why: William: "these should be tackled last regardless since they aren't set in stone."
- Sidebar has five fixed items, tools attach to the shape, Admin lists all. Why: William: tools are "conditional, and come attached to certain nodes / workflows" but "still first class".
- Pins over recents. Why: recents move under the hand; a pin stays where the person put it.

## Decisions (planner, 2026-10-20)

Calls the doc leaves open, for areas A, B and E.

- **Order.** A and B build first. E and B's subset mode build last, each in its own commit. Why: William checks E and subset in the artifact first; A and B can push while those wait.
- **Token names.** The repo prefix stays `--ui-`. Lines are `--ui-line-0` to `--ui-line-7`. The press edge is `--ui-press-edge` (`--ui-edge` already means the border of a field). The metro reads `--ui-line-N`, `--ui-ink`, `--ui-ink-3`, `--ui-paper`, `--ui-bad`, `--ui-warn` and `--ui-accent` by name. Why: one prefix for every token; the artifact's bare names map one to one.
- **Line colours.** `--ui-line-0` to `--ui-line-3` take the artifact values, day and night. `--ui-line-4` to `--ui-line-7` are new hues, each at least 3:1 on paper, with night variants. Why: section 10 allows up to 8; amber stays for late.
- **Leaf corners.** New tokens hold the corner pairs: `--ui-leaf-panel` (6 24), `--ui-leaf-button` (6 10), `--ui-leaf-chip` (3 10), `--ui-leaf-nav` (3 12). `--ui-radius` and its derived panel and sheet radii do not change. Window and sheet stay 14. Why: the rounded utilities take one value; a leaf needs two.
- **Quiet Client Rule.** Leaf corners, sentence case buttons and the sweep are the Wren look and its night. A look that sets its own radius keeps plain corners. A look that wanted uppercase sets it in its own preset. Soft and editorial do not change. Why: DESIGN.md, Quiet Client Rule.
- **Night.** Only the section 10 row changes: accent `#a596d6`, on-accent `#15121f`, press edge `#7a69ad`, line night variants. The other night values stay; the contrast tests own them.
- **Metro output.** The renderer is React SVG elements, not an SVG string. Glyphs come from `packages/ui/src/icons.tsx`; a missing Lucide glyph goes there, not into a metro table. Why: one icon set; React keys drive the fold glide.
- **Metro layers.** `MetroScene` is positioned, a faithful port of the artifact's scene. `MetroView` is the store's shape, with no positions. `layoutMetro(view)` returns a scene. Area D maps the store to `MetroView`. Why: the artifact maps are hand placed; the app needs a layout from plain data.
- **Subset.** A `focus` input `{kind: line | group | station | flow, id}` draws only that part. Stub tracks at its edges are short, faded, and named for where they come from and go to. A stub click calls back with the part it names. Routes and pages are area F.
- **Systems.** `map/routes.ts` `ROUTES` stays the one kind-to-app table. "On your shape" holds each app that a live node's row opens; the row names those nodes. Why: no second copy of the table.
- **Pins.** The existing rail pins (`RailPref`) are the pins. No second store.
- **Client Systems.** A client sees Admin → Systems only with the `manage` permission. Why: no `settings` permission exists; `manage` holds the look and people, the nearest scope.

## Decisions (planner C1, 2026-10-20)

Briefs: `designs/briefs/2026-10-20-design-language-c1.md`.

- Two models in one column. A body with `model: "metro"` is the new model; a body without it is the graph. Why: old code runs on the first step, and no migration is needed for it.
- The runtime keeps the graph. `runOf` lowers a metro body with `graphOf`, the exact inverse of the converter. Why: workflow, moves and deals stay the same after a convert, and Restate replays each `shape.v<n>` unchanged. Logic stations, exits, frames and links are types and checks only until the runtime runs them.
- Ids are identities. Station id = node id, track id = edge id, out line id = source id, offer line id = offer node id. Why: journeys, deals, research and the trail need no remap, and history keeps the old ids.
- Ids are unique within each kind (lines, stations, tracks, groups, frames, flows), not across kinds. Why: the artifact's own samples give a line and a group one id (`rd`); a focus URL names the kind. A station keeps its id across versions; versions only add and remove.
- Each source becomes an out line with one start station (its id) and a track to the hub. Each source edge becomes an entry on a hub track (`entries`). Why: outreach ends at the hub, and the runtime still knows which station each source lands on (DM source on `dm`, ads on `visit`).
- The hub holds no one in C1. It is the opening. Why: nobody sits on a source today.
- Each offer node becomes an offer line (tier core) and a station on it with `deal: true`. Steps go on the line of the nearest deal station downstream. Why: the artifact draws the sales steps after the hub on the offer's line.
- The deal still opens at the deal station (today's offer node). The artifact's rule ("a deal opens at the first station of an offer line") would open deals at the first step after the hub. `wren shape convert` reports how many open journeys that moves. Open for William.
- Plan nodes become cash stations with `terms` and `offer`. Price stays off the station (C2).
- Columns: comment, reply, dm, email, text, cta and visit are marketing; other steps and the deal station are sales; steps after a deal station are delivery; cash is money. A column never goes left along a track. Why: today has no column; this is the nearest rule the artifact shows.
- Kinds: proposal, signed and other are attention, as the artifact's Proposal station.
- `placesOf` replaces `depthOf` for the map: column first, then path. It is worked out on read, not stored. (Changed 10-21: `depths` stays graph depth, because the profile merge compares depths across versions and a place is a different scale.)
- A new column `shape_versions.run` holds `runOf(body)`, the graph the runtime runs. `saveShape` writes it. The SQL readers (`edge_flow`, `source_numbers`, `stage_flow`, `journeyShape`) read `run`, so they work on both models. Why: a metro body has no `nodes` or `edges`, and the lowering lives in TypeScript only.
- Loops become `back` tracks, not exits. Why: crossing one opens a new journey, as a loop does today.
- Display names are `label` and colours are a token index, as the renderer's view. Group membership lives on the group (`stations[]`), not on the station.
- Hold and version chips are numbers, not stored fields. The retry cap is `retries` on the station.
- Flows live in the body, not in a table of their own. Why: a journey pins one version; a separate versioned flow would need a second pin per journey, and diff, blame and the mirror already work on one body.
- `attach` holds refs only (an id or a URL), never content.
- The portal web keeps the graph (`runOf`) until area D. Why: the web Map reads nodes and edges.
- Push: parts 1 to 3 are additive. Part 4 (graph bodies refused) is HELD with the prod convert, for William's yes, and waits for area D.
- C2 items stay out: repeat, bundles, credits, packages, delivery loops, rewarm.

## Decisions (William, 2026-10-21)

- Deal rule. A deal opens when an offer is made and locked (a proposal sent with its terms fixed), or when the person takes a free or paid offer. Before that the person is a lead. Each offer line has one deal station at that point. The artifact rule (a deal opens at the first station of the line) is dropped. A converted shape keeps today's offer node as its deal station.
- Hub. The hub holds no one. People is the CRM: every lead and client, their record and timeline. The Map's hub draws the lead count, read from People. Why (William's lean, my call): a person record outlives any line; a place on the map is a view of it.
- Tiers. No upsells yet. Converted offer lines are core; a free offer line is front. Upsell transfers wait until an upsell exists.
- Loader. One plain ring (artifact v23). Flight and the bird variants are gone.
- Inbox Overview (artifact v27, section 15). The total that waits on you, a bar split by queue, then the queues ranked by oldest wait. Replies and Booked trend cards sit at the side. Amber marks only a late queue: text or a dot, never a fill. Mail rules leaves the overview. The square tiles with amber tops go.
- Queue tables. Each queue opens one table part, shared with People (TanStack Table). Views: Table (column lines, property icons, queue pill, Open on hover, count footer) and By queue (folds with count and oldest wait). No board. A row click opens a side peek with the person, the last message and a reply box; on the phone the peek is a sheet. A row shows one quiet icon action; more show on hover. The icon acts in place, with Undo.

## Decisions (planner D, 2026-10-21)

Briefs: `designs/briefs/2026-10-21-design-language-d.md`.

- The server answers every diff with the drawing. `shapeDiff`, `shapePreview` and `shapeUndoPreview` answer `views` (both sides as the map draws them), `marks` (the metro diff), `diff` (in the stored bodies' terms, for undo keys) and `changes` (key and line). The graph `bodies` go. Why: the web stops reading graph bodies, so C1 Part 4 needs no web change.
- Export and restore go by ref. `shapeExport` takes `ref`; `shapeVersion` takes `from: n`. Why: the web never sends a shape body.
- A draft's marks are against its base. The banner says when live moved; Apply shows base to live, as the business-map design says.
- Lead count: People profiles, not merged, with no deal row of any status. Why: "the hub draws the lead count, read from People" (William, 10-21). Open for William: only people with a journey, or a lost deal counted as a lead again.
- Diff marks: added in the good token, changed in warn, removed faded and dashed, each with a small tag and a legend. The artifact has no design for them. Open for William: the look.
- Late has one rule (`waitsOf`): a person waited longer than the track's promise. Today and the map's late mark both read it.
- Numbers on a graph live: node and edge rows stay, station, track and line rows are added beside them, so the CLI and the Map each read their own kinds.

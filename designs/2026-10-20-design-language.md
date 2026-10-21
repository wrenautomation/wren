# Design language and the metro map

2026-10-20. William, on artifact v12: "keep this artifact up we are using this as the source of truth for the full redesign, and well iterate through this artifact as well." Green light to build.

**Source of truth:** the private artifact "Wren design language" (claude.ai/artifact/SuhuZqr8NPMQMDdd5UKWuu, v12). The artifact wins over this doc when they differ. A copy of its source at v12 sits in `designs/2026-10-20-design-language/`: `design-language.src.html` (every section, sample data only), `metro-render.js` and `metro-render.css` (the renderer every map on the page uses). Builders port from those files. They never fetch the artifact.

This doc supersedes the "banded funnel" form decision in `2026-10-19-business-map.md`. The shape store, drafts, history, blame, undo, tags and the git mirror from that doc stay.

## Sections of the artifact, and who builds them

| Artifact section | Is | Area |
|---|---|---|
| 01 Tokens and type, 02 Leaf and sweep, 03 Parts, 10 What changes in DESIGN.md | tokens, radius, sweep, press, case | A |
| 04 Metro map, 05 Zoom levels, 06 Scenarios, 09 Logic | lines, stations, tracks, capsules, logic marks, zoom | B (draw), C (store) |
| 07 The map in the app | Map home, Today from person tracks, sidebar | D, E |
| 08 Offers, plans and bundles | pricing model, delivery loops, rewarm | C |
| 11 Target state | the shape model inversion | C |

## Areas

**A. Tokens and parts.** Every row of artifact section 10: sentence case everywhere (buttons 650, group labels 12.5/650 ink-3), leaf radius pairs (panel 6/24, button 6/10, chip and nav 3/10 to 12; window and sheet stay 14), the lavender sweep on panel and band tips, night accent `#a596d6`, the press edge (`--edge`, sinks 3 px), Figtree only, line tokens `--l0`..`--l7` with night variants. In `packages/ui/src/tailwind.css` and `DESIGN.md`. Client looks keep the Quiet Client Rule and their own presets.

**B. Metro renderer.** A typed port of `metro-render.js` and `.css` into `packages/ui/src/metro/`: pure layout and SVG output from a plain data shape (lines, stations, tracks, exits, transfers, capsules, logic marks, chips, pills, interrupt frames), plus a React wrapper with zoom (Parts, Groups, Stations), folds and fold tabs, keyboard focus and hover. Every mark in sections 04, 05, 08 and 09. Stories: each section's examples as stories (render, play, axe; no pixel compare). Custom code: no library draws metro maps with these marks. xyflow and elk stay for the workflow editor.

**C. Shape model.** Artifact section 11 in full, then section 08.
- C1: offer becomes a line `{offer, tier: out | front | core, colour}`; sources become outreach lines into one hub; steps become stations `att | time | cash` by action; plans become cash stations that point at an offer or bundle; edges become tracks `{by: system | person, owner?, promise?}`; loops become exits or grey lines back to the hub; groups `{id, name, line, stations[]}` (one level); a column per station (marketing, sales, delivery, money). Logic from section 09 as station and track kinds: condition, race, split and join (rule all, any, n of m), A/B with weights, approval, shared flow (link), interrupt frame, and the chips (retry cap, hold, version).
- C2: section 08 pricing model: offers carry packages, plans, add-ons, guarantee, terms; bundles, credits on transfers, purchases that write money events; delivery steps `once | loop`, the loop ring with its bill and decide steps, rewarm lines with a cap.
- Both: the export and import YAML format (`exportShape`, `shapes/*.yaml` in sops), `diff.ts` change keys, `historyOf` and undo move to station and track ids. Numbers per station and track replace per node and edge.
- Migration in two steps, as the business map did: first additive (old code runs on it, a CLI converts each live shape to a new version and maps journeys and deals by id, history keeps old ids). Then the guard and drops, in a later commit.

**D. Map page on the renderer.** Home `/` draws the live shape with B, zoom and folds, node panel and History as overlays, edit mode on the new marks, Today from person tracks (owner and promise, late first, hover lights the line). Needs B and C1. Next after tonight.

**E. Sidebar.** See below.

## Sidebar (William, 2026-10-20)

William: "our dashboard sidebar should be minimized a lot more, all those tools are conditional, and come attached to certain nodes / workflows. those systems are still first class, and within our admin system, i think all of them should be shown (but some of them will be for debugging, and some of them will actually exist as part of a real shape of our business, like platform outreach and youtube posting for example)."

- The sidebar holds five items: Map (home), Inbox, People, Money, Admin.
- Every other app opens from the station, track or line that uses it. Each station kind and channel maps to its app (YouTube outreach line opens Content on YouTube; a DM station opens Outreach). Until D lands, the Map's node panel "Open" link carries this.
- Admin → Systems lists every app in two groups. "On your shape": the app is attached to a live station; the row names the stations. "Not on the shape": debug and internal tools (handlers, loops, review, marketplace, and the like). A parked app shows in neither group.
- ⌘K finds any app, page or station.
- Pins: a person can pin an app to the sidebar under the five items. This keeps daily tools (Studio, Engage) one click away. Pins are per person, stored with the viewer prefs.
- Phone dock: Map, Inbox, People, plus the person's first pin.
- A client workspace gets the same five items. Clients see Admin → Systems only with the settings permission.

Open for William: pins vs recents for daily tools; whether a client sees Systems at all.

## Order and push policy

Tonight: A, B, E (planner 1, at most 2 builders) and C1 (planner 2, 1 builder at xhigh). At most 3 builders across both. D and C2 next.

Push: A, B and E push when the hand-off gate passes; they are UI and reversible. C1 pushes only its additive half (schema, types, renderer data shape, converter as a CLI that is not run on prod). The conversion run on prod and the guard and drop migration wait for William's yes.

## Decisions

- The artifact is the source of truth; the repo holds a v12 copy of its source for builders. Why: William iterates in the artifact; builders need a fixed input they can read offline.
- Metro replaces the banded funnel. Why: William picked the metro language through artifact v1 to v12; colour is the offer, weight is the job, the icon is what the person gives.
- One renderer for the artifact, the stories and the app. Why: the spec and the app draw from the same code (section 10, "Map marks").
- Sidebar has five fixed items, tools attach to the shape, Admin lists all. Why: William: tools are "conditional, and come attached to certain nodes / workflows" but "still first class".
- Pins over recents. Why: recents move under the hand; a pin stays where the person put it.

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
- `placesOf` replaces `depthOf`: column first, then path. It is stored in `depths` for metro bodies, so the SQL readers and the web read it unchanged. The column takes the name `places` in the HELD part.
- Loops become `back` tracks, not exits. Why: crossing one opens a new journey, as a loop does today.
- Display names are `label` and colours are a token index, as the renderer's view. Group membership lives on the group (`stations[]`), not on the station.
- Hold and version chips are numbers, not stored fields. The retry cap is `retries` on the station.
- Flows live in the body, not in a table of their own. Why: a journey pins one version; a separate versioned flow would need a second pin per journey, and diff, blame and the mirror already work on one body.
- `attach` holds refs only (an id or a URL), never content.
- The portal web keeps the graph (`runOf`) until area D. Why: the web Map reads nodes and edges.
- Push: parts 1 to 3 are additive. Part 4 (graph bodies refused, `depths` renamed) is HELD with the prod convert, for William's yes, and waits for area D.
- C2 items stay out: repeat, bundles, credits, packages, delivery loops, rewarm.

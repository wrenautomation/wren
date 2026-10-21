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

**E. Sidebar** and **F. Focus view**: proposals, below. They wait on William's yes in the artifact (section 13) and go last.

## Proposal E: sidebar (William, 2026-10-20; not set)

William: "our dashboard sidebar should be minimized a lot more, all those tools are conditional, and come attached to certain nodes / workflows. those systems are still first class, and within our admin system, i think all of them should be shown (but some of them will be for debugging, and some of them will actually exist as part of a real shape of our business, like platform outreach and youtube posting for example)."

- The sidebar holds five items: Map (home), Inbox, People, Money, Admin.
- Every other app opens from the station, track or line that uses it. Each station kind and channel maps to its app (YouTube outreach line opens Content on YouTube; a DM station opens Outreach). Until D lands, the Map's node panel "Open" link carries this.
- Admin → Systems lists every app in two groups. "On your shape": the app is attached to a live station; the row names the stations. "Not on the shape": debug and internal tools (handlers, loops, review, marketplace, and the like). A parked app shows in neither group.
- ⌘K finds any app, page or station.
- Pins: a person can pin an app to the sidebar under the five items. This keeps daily tools (Studio, Engage) one click away. Pins are per person, stored with the viewer prefs.
- Phone dock: Map, Inbox, People, plus the person's first pin.
- A client workspace gets the same five items. Clients see Admin → Systems only with the settings permission.

Open for William: pins vs recents for daily tools; whether a client sees Systems at all.

## Proposal F: focus view (William, 2026-10-20; not set)

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

## Order and push policy

Tonight: A and B (planner 1, at most 2 builders) and C1 (planner 2, 1 builder at xhigh). At most 3 builders across both. Then D and C2. E and F last, after William's yes.

Push: A and B push when the hand-off gate passes; they are UI and reversible. C1 pushes only its additive half (schema, types, renderer data shape, converter as a CLI that is not run on prod). The conversion run on prod and the guard and drop migration wait for William's yes.

## Decisions

- The artifact is the source of truth; the repo holds a v12 copy of its source for builders. Why: William iterates in the artifact; builders need a fixed input they can read offline.
- Metro replaces the banded funnel. Why: William picked the metro language through artifact v1 to v12; colour is the offer, weight is the job, the icon is what the person gives.
- One renderer for the artifact, the stories and the app. Why: the spec and the app draw from the same code (section 10, "Map marks").
- E and F are proposals and go last. Why: William: "these should be tackled last regardless since they aren't set in stone."

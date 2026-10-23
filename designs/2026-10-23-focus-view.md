# Focus view and saved views (2026-10-23)

Bead wa-7oo.10. Base: Proposal F in `2026-10-20-design-language.md`. Look: Design Language artifact, section 13 "F. Focus view" (`#focf`, CSS `.app.focus`, `.crumb`, `.att`, `.ai`, `.ai .k`, `.att .add`).

## What William asked

- "Our business is this giant map. Future teams (people or agents) get focused, first-class subworkflow views of the product they work on, or of one section (marketing, one part of delivery for a backend dev, IT)."
- "The shared flow and the saved view are the saved subworkflow. It's segregation of context."
- "Read and attach only for now." No shape edits from a focus page.
- "The whole portal should follow the focus. We iron that out later."
- "For our admin portal, make all the apps appear back in the sidebar again. Especially Marketing."

## Target state (cost zero)

1. Every part of the map has its own URL. A part is a line, a group, a station or a shared flow.
2. A focus page draws that part only. Stubs at its edges name where people come from and go to. A click on a stub focuses that part.
3. A breadcrumb leads back up: Map › line › group › station. Esc goes up one level.
4. Beside the map, the Attached panel lists the SOPs, links, pages, docs, templates and notes on the part and on each station inside it, then the apps the part uses. A person with edit access adds and removes attachments there.
5. Under the map: the people on the part now, and the numbers of the part for the Map's window.
6. A saved view is a named set of parts. It is personal, or shared with the workspace. Each person can set one view as their home: "/" then draws that view, not the whole map.
7. The whole portal follows the focus. Inbox, People, lists and ⌘K narrow to the people and apps of the view.
8. A team (people or agents) gets a view as its home with its access grant. An agent reads a view with `wren shape view show`.
9. "Save as shared flow" turns a part into a reusable sub-shape.
10. A focus page can hold a draft scoped to the part.

## What this build does

| Part | Build | Bead |
|---|---|---|
| 1-5 | Focus page, attach read and write | F1 |
| 6, 8 (CLI only) | Saved views on the map, home view, `wren shape view` | F2 |
| sidebar | All apps back in Wren's sidebar | F3 |
| 7 | The portal follows the focus | F4, deferred |
| 9, 10 | Shape edits from a focus page | not now: William said read and attach only |
| 8 (grants) | A view suggests a grant | not now: a view is never access; scoped grants stay the one access path |

## F1. Focus page

**URL.** `/map/<kind>/<id>`, kind `line`, `group`, `station` or `flow`. The id is the stable metro id, so a link lives across versions. `?window=` and `?client=` work as on the Map. The browser gives tabs, windows and history: Wren builds no tab bar. "map" is a reserved first segment for Wren's team; no app has the id `map` (Marketplace has a page `map`, at `/marketplace/map`, which stays).

A pin to a focus URL does not show in the sidebar (pins name app pages). Accepted for now; F2's home view covers the daily need.

**Draw.** `MetroMap` with `focus` (built: `packages/ui/src/metro/focus.ts`, commit 136a4789). `onStub` opens the far part's URL. The page passes no `level` or `open`: a focus draws every station of the part.

**Breadcrumb.** From the metro body: a station names its line and its group; a group names its line. A flow is Map › flow. Each crumb is a link. Esc on the page (not in a field or an open dialog) goes to the parent crumb. The map's own key handler takes Enter and Space only, so the two do not clash.

**Attached panel** (artifact `.att`, 250px column, left hair, `color-mix(canvas 40%, paper)`). Groups:

- On the part itself: its `attach[]`.
- On each station inside: the station's `attach[]`, under the station name.
- Apps: the apps the part's stations open (`opensOf` in `map/routes.ts`), one row each.

Each row: the kind chip (`.ai .k`), the label (or the ref), and the ref. A URL ref is a link. An id ref of kind `sop` opens the SOP. The other kinds show the id. `+ Attach` (artifact `.att .add`) opens a small form: kind, ref, label. A remove button sits on each row of the part's own list. A flow shows its stations' attachments only: attach on a flow is no part of the model.

**Write.** One new console action, `shapeAttach { on, id, add? | remove? }`. It runs one `attach` or `detach` op (`editMetro`, `metro-ops.ts`) on `metroView(newest)` and saves the next version with `saveShape`. The note is `Attach <kind> "<label or ref>" to <name>` or `Detach …`. Same guard as the other shape writes (`act` on the Journeys app), in `PIPELINE_CONSOLE_WRITES`, then the mirror (`saveThenMirror`). Cost: each attach is one version, one `carryJourneys` pass over open journeys and one mirror commit. Prod holds 3 versions and 2 open journeys today, so this is fine. If open journeys grow to thousands, carry for a version whose `run` equals its parent's becomes a version bump only (a later chore, noted in the shape card).

Why a version and not a side table: an attach is part of the business design. It merges, diffs, blames and undoes with the rest of the shape (all built). A side table would need all four again.

**People and numbers.** People: `data.people` on the part's stations, newest first (NodePanel's `PeopleHere`). Numbers: for a station, `stationSays`; for a line, `lineSays`; for a group or flow, the sum of its stations' `now` and arrivals. One `Numbers` list, the window said once.

**Look.** Header `.atop`: the crumb (`.crumb`, 13px ink-3, the last crumb bold ink), the part name (22px, -0.02em), one line of numbers (13.5px ink-2). Grid `minmax(0,1fr) 250px`. Under 760px the panel drops under the map. NodePanel's `Card`, `Numbers` and `PeopleHere` are reused, not copied.

**Open from the Map.** The Map's panel for a station or line gets "Focus" (a link to its URL). ⌘K station results open the focus URL. A group fold gets no Focus link yet: a fold toggles inside the map (`@wren/ui` metro), so a link there is a part change. A station's breadcrumb reaches its group.

**Story.** `pages-map` stories `FocusStation`, `FocusLine`, `FocusMissing`, `FocusFromPanel` on MSW: render, play (stub click, Esc, attach, remove), axe.

## F2. Saved views

**Store.** The existing `saved_views` table (`packages/core/src/saved-views.ts`), record `map`. `params` holds the parts: `parts=line:gp,group:loop`. Personal by default; shared needs `manage`, as for any list's views. No new table.

**URL.** `/map/view/<id>` draws the saved view. `/map/parts/<parts>` draws an unsaved set; `<parts>` is `partsParam` (`packages/pipeline/src/metro-parts.ts`), encoded once more as one path segment.

**Draw.** `focusScene` takes several parts: a station is inside when it is in any part. Stubs sit on the edge of the union.

**Make.** On a focus page: "Save view" (name, shared; the list bar's `SaveViewPop`). On a set or a view: a "Parts" row with a chip for each part, × to drop one, and "Add part" (lines and groups of the body). A changed view keeps `?sv=`, so Save view offers to update it.

**Home.** A viewer pref `map.home` holds a view id. When set, "/" draws that view above Today, with "Whole map" to leave it. A view whose parts are all gone falls back to the whole map with one line that says so.

**Agents.** `wren shape view list` and `wren shape view show <id>` (`apps/cli/src/shape.ts`): the parts on the newest version, each part's stations, and their attachments. Without `--viewer` they see the shared views; `--viewer <email>` adds that person's own. Config holds no operator email, so there is no default viewer.

## F3. Sidebar: all apps for Wren's team

Wren's team: the Map, Inbox, People, Money, Admin, then Primary, Marketing (open) and Tools (shut) from `AREAS_TEAM`, less the apps the fixed items show. Pins stay. A client's workspace keeps the five items (Proposal E). Phone dock unchanged. This reverses part of Proposal E for Wren's team.

## F4. The portal follows the focus (deferred)

The open questions: does Inbox narrow to the view's people, or to its apps? Does a view change ⌘K? Is the focus kept per tab (URL) or per person (pref)? Decide with William after F2 is in use.

## Not built, and why

- **Column focus.** `MetroPart` has no column kind. It waits for wa-7oo.18 (procedural layout).
- **Save as shared flow, scoped drafts.** Both edit the shape. William: read and attach only.
- **Grant from a view.** A view never gives access. A home view does not suggest a grant yet.

## Decision log

- 2026-10-23 William: read and attach only; the whole portal follows the focus later; all apps back in Wren's sidebar, Marketing first.
- 2026-10-23 F1 built: the attach panel is a `section` (an `aside` inside `main` fails axe); `PeopleHere` takes a heading level.
- 2026-10-23: attach writes a shape version (merge, diff, blame and undo come free). Saved views reuse `saved_views`.
- 2026-10-23 F2 built: path URLs (`/map/view/<id>`, `/map/parts/<…>`), not query params: the router keys pages on the path. A stub takes the grain of its near station's part. A view of one part draws as a "View", with no attach form (attach lives on the part's own page). The home view turns Esc off, and its Map crumb goes to `/?whole=1`. The CLI default viewer is none (shared only), as config holds no operator email.

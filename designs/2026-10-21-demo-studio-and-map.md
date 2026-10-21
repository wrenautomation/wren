# Studio and the Map for the offer builder demo (2026-10-21)

William wants a quick demo video of the offer builder system. Two surfaces must look good on camera: Studio and the Map. Beads wa-7oo.16 (Map), Studio has none (new). Pricing C2 (wa-7oo.7) stays last.

## Target state

- **Studio** looks like the canvas boards "Studio · this week", "Studio · new post" and "Studio on the phone" in artifact 5kYdr7PNRwCnba2jcv3LCf. Source: `wren_automation/.scratch/studio/project/{Main,Compose,Phone}.dc.html`. It is a feel reference. Keep every Studio feature that exists now.
- **The Map** draws any shape at a calm scale with no overlaps, even spacing, and no dead columns. It opens at once from the device cache on a second visit.

## Studio

Module: `apps/portal/web/src/modules/marketing/studio.tsx` and its parts.

1. Head: "Still due this week" as slot cards. Each card: line colour square + line name, kind, platform + day; amber when late. Data: what the plan asks this week (existing source).
2. "New" row: one card per kind (post, thread, carousel, story, blog, video). A card opens compose with that kind.
3. Waiting drafts: on the shared table part (`packages/ui/src/table.tsx`, `DataTable`), F1 look. Columns: kind mark, title, line square, platform pills, slot, age (amber past slot), approve icon with Undo. No hand-drawn rows.
4. Compose: line chips (offer lines from the shape), angle chips, body, platforms side by side with fit labels. Buttons: Approve and slot, Post now, Save draft.
5. Phone (390 wide): due cards scroll sideways, waiting list, new-post button bottom right.
6. Tokens and corners from the design language (`designs/2026-10-20-design-language.md`). No new colours.

Stories: update or add page stories for Studio desk and phone, light and dark. Fakes use sample data only.

## Map

Package: `packages/ui/src/metro/` (`layout.ts`, `marks.tsx`, `map.tsx`). Page: `apps/portal/web/src/map/`.

Defects seen on the Default page story at 1440 wide:

- The scene scales up to fill the page. Six stations fill the screen; labels are 26 px.
- Task chips on a track ("Ada North 4h", "Mor 3650d") overlap the hub and the station marks.
- Columns with no stations (Delivery, Money) take space but are empty and lopsided.
- The hub is a tall bar that hides the track that passes it.

Fix:

1. **Scale.** Draw at a fixed scale (1 scene px = 1 css px, cap the zoom at 1). Centre a small map. Pan and zoom for a big one.
2. **Layout.** Keep `layoutMetro` pure and sync. Use elkjs (already a dependency, used in `packages/ui/src/graph/layout.ts`) only if the hand rules cannot meet the checks below. Planner decides and says why. Rules either way: stations snap to the grid; equal gaps per column; a column with no stations gets a narrow fixed width with its name; lines ordered to cut crossings; labels never overlap a mark or another label.
3. **Chips.** A task chip sits in the middle of the free part of its track. When it does not fit, it folds to a count dot. Never on a station or the hub.
4. **Cache.** The page reads through `useCall`, which keeps answers on the device. Check the Map's reads all go through it with a stable key per shape version, so a revisit draws at once. If the layout is async anywhere, memo it per version hash.
5. **Checks.** A layout test: on every sample in `samples.ts` and the page fakes, no two label boxes overlap, no chip overlaps a mark, gaps per column are equal. Story `play` keeps the crossing count pin.

## Out of scope

G2 map chat (wa-7oo.12), F focus view (wa-7oo.10), pricing C2. The People/Inbox rows rollout runs in its own planner; Studio uses `table.tsx` as it is on main.

## Decisions (planner, 2026-10-21)

Briefs: `designs/briefs/2026-10-21-demo-studio-and-map.md`.

- Hand rules, no elkjs. Why: the metro layout is a fixed grid (columns are zones, lines are rows), and each defect is a local change in `layoutMetro`. elkjs runs async, which breaks "pure and sync" and adds a memo per version for no gain.
- Chips and labels are placed by `layoutMetro`, not at draw time. Why: the overlap test reads the scene, not the DOM.
- One text-width estimate in `geometry.ts` for layout, draw and tests.
- Offer-line stations in the hub's column sit right of the hub. Why: each offer line starts at the hub, so no track passes under it.
- Hand-off gate for these UI-only briefs: `./scripts/gates.sh ui`, then `./scripts/gates.sh lint`. No Docker gates: nothing here touches the database.

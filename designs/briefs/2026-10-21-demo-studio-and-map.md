# Briefs: Studio and the Map for the demo (2026-10-21)

Design: `designs/2026-10-21-demo-studio-and-map.md`. Two briefs, one builder each, each in its own worktree. Base commit 8baaf993.

## Brief M: the Map

Worktree `~/worktrees/wren-demo-map`, branch `demo-map`. Files: `packages/ui/src/metro/` and `apps/portal/web/src/map/`, plus their stories.

1. **Scale.** `.mm` in `metro.css` sets `width: 100%`, so the svg grows to the page. Draw at 1 scene px = 1 css px: the svg width is the scene width, never more. The host centres a map smaller than it. A map wider or taller than the host scrolls (pan) inside the host; the ctrl-wheel and pinch steps stay. A glyph table (`width` prop) keeps its own size.
2. **Columns.** Equal gaps between stations in a column (one step for the whole map). A column with no stations gets a narrow fixed width that still fits its name. No dead space at the right.
3. **Hub.** No track passes under the hub. In the hub's column, the stations that lead into the hub sit left of it; stations on offer lines sit right of it, so each offer line starts at the hub. The hub spans only the rows it joins.
4. **Lines.** Order rows to cut crossings (for example by the mean row of each line's neighbours, a few sweeps). The crossing count pin in the story `play` stays and holds or drops.
5. **Labels.** A station name and its sub never overlap another mark or another label. Use one pure text-width estimate (`marks.tsx` has `textWidth`; move it to `geometry.ts` and use it in both). When two collide, move one (above or below) in the layout, not at draw time.
6. **Chips.** `layoutMetro` places each task chip (`who`, `task`): in the middle of the free part of its track (the part not under a station, the hub or a label). It emits the place on the `MetroTrack`. When the chip does not fit, it folds to a count dot. `draw.tsx` and `marks.tsx` draw what the layout says.
7. **Tests.** In `packages/ui/src/metro/layout.test.ts`: for every sample in `samples.ts` that goes through `layoutMetro`, no two label boxes overlap, no chip box overlaps a station mark or the hub, the gaps in each column are equal, no track passes under the hub. In `apps/portal/web/src/map/view.test.ts` (or a new test beside it): the same checks on the page fakes' shapes (`viewOf` then `layoutMetro`). Export the box helpers from the metro package so both tests use one copy.
8. **Cache.** `useMap` keys `map:<client>:<window>` through `useCall` (kept on the device). Check that the scene memo holds (`viewOf` and `layoutMetro` run once per answer, not per render). A second visit with a kept answer draws at once: no draw-in when the answer came from the device. If no flag tells that today, add the smallest one in `load.ts` and say why.
9. **Stories.** Map page stories Default, Dark and Phone show a calm map: labels at their real size, centred, nothing on top of anything. Add a page story with a big shape (many lines and stations) that pans.

Keep `layoutMetro` pure and sync. No elkjs (see the design's decisions).

## Brief S: Studio

Worktree `~/worktrees/wren-demo-studio`, branch `demo-studio`. Files: `apps/portal/web/src/modules/marketing/` (Studio files), the Studio page stories and MSW fakes.

Do items 1 to 6 of the design's Studio section. The feel reference is the canvas: `wren_automation/.scratch/studio/project/{Main,Compose,Phone}.dc.html`. Map each canvas hex to a `--ui-*` token. Never copy a hex. Keep every Studio feature that exists now (list them before you change anything, and check each one at the end).

- The waiting table uses `DataTable` from `packages/ui/src/table.tsx` as it is. Do not change `table.tsx`. If a prop you need is missing, stop and report it.
- Approve in a row acts in place with Undo. Use a shared undo part if `packages/ui` has one. Do not write a second one.
- Compose reads the offer lines from the shape. If Studio has no shape read, add one through `useCall` (the reads guard fails otherwise), with an MSW fake.
- Stories: Studio desk (1440) and phone (390), light and dark, compose included. Sample data only: invented names, no client names, no amounts.

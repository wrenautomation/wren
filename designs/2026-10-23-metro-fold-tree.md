# Metro fold tree

2026-10-23. Bead wa-mt8j. William: ELK + BK "usually edges it out, lock that in". Fold "all the way" from one circle for content marketing down to each feature. The Parts, Groups, Stations levels go: "an arbitrary constraint".

## Decisions

1. **One layout.** `placeMetro` (`place.ts`) is the only placer; `layoutView(view)` lays out a view with nothing folded: ELK layered, Brandes-Köpf, columns as partitions, x on even steps. `layoutMetro`'s placer, the LP (`lab/lp.ts`, `highs`) and the lab's other engines are gone. `finishMetro` (layout.ts) still makes the scene: tracks, names, chips, rails.
2. **One fold tree, any depth.** A node holds stations and nodes. Nothing is guessed. The tree, outermost first:
   - **line · column**: the stations of one line in one column (today's Parts). Made only when it holds 2 or more stations and more than one child.
   - **groups**: the shape's groups. A group may name a `parent` group, to any depth. A group with stations sits on one line. A group that only holds groups lists no stations and may span lines (content marketing as one circle). The pipeline checks that a parent exists and no group sits inside itself.
   - **twins**: one template on one line in one column, a station per platform. A twin that departs from the rest (`TWIN_OUTLIER`) or carries a diff stays out.
   - **exits** fold with the node of their source. The hub folds like any station when a group holds it (2026-10-24); in no group, it stays on the map.
   Flows become nodes in a later commit (they are their own id scope today).
3. **Controls.** `MetroDepth` (map.tsx) draws − and + and the path. `MetroMap` draws it in its bar; the portal Map page draws it in its header.
4. **State.** A depth cut (node open when its depth is under the cut) and hand changes on top (`open: {id: bool}`). The wheel or a pinch steps the cut and clears the hand changes. A click on a circle opens it. The tab on its frame closes it. `reveal` (a station) opens its path and closes the rest. A breadcrumb shows the path of the last node opened; a crumb closes what is under it.
5. **Nested layout.** One ELK call per open set (`INCLUDE_CHILDREN`): an open node whose stations sit in one column is a compound node (`box:<id>`) and draws as a box with its fold tab on the top edge. Other open nodes draw as a pill under their first circle. A closed node is one circle. Columns stay ELK partitions. Exits and back tracks stay out of ELK's edges; the scene draws them after. The scene is cached by `openKey` (the sorted open ids).
6. **Numbers on a closed node.** People in and now, summed. A bad station inside (an exit) shows as a red count. Tracks between two closed nodes merge to one.
7. **Motion.** The glide (glide.ts): stations grow out of the circle they open from and shrink back into it; the rest slides.
8. **Async.** ELK runs async. `viewZoom` keeps each view's scenes in a WeakMap (`SCENES`), and `useScenes` (map.tsx) caches per zoom. The map keeps the last scene until the next one is ready; the first load shows the skeleton. Hand-composed scenes (`flagZoom`) stay sync.
9. **Misses.** When a name or a chip finds no room, the columns under it widen by half a step, up to 3 tries; then chips fold to dots. A name across only its own station's drop (straight up or down) is no miss: no width fixes it. A hub line bends to its row by the next column, as ELK drew the edge, so a row that starts late takes no line across the rows between.
10. **Laps** (2026-10-24). A group with `lap: "every 30 days"` is work that repeats. Its stations sit in one column. ELK places the lap as one leaf (`lap:<id>`), as wide as its top row. The placer puts the first half of its stations on the top row, left to right, and the rest on the bottom row, back right to left. Tracks inside follow the loop, and one more track (`lap:<id>`) carries the moving dots; the cycle shows as a chip in the middle. An open lap has no frame or pill: its tab sits in the loop. Closed, it is a ring (`RingStation`). An exit from a lap stays out of it, so it hangs under the ring. Put stations with exits on the bottom row. The hand-drawn `LOOP_SCENE` is gone: `loopZoom` is `viewZoom(GROWTH_RETAINER)`, and every continuity play in `money-models.ts` is the same lap (`retainer()`) with its own terms.

## Kept state

`kept.ts` keeps `depth` and `open` per workspace. An old `level` reads as the same depth.

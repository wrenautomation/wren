# Orrery business look, Layers, map speed (WA-1139)

2026-11-06. William: "the business look is a little bit better ... slightly bigger icons ... the rails and the lines look too thick ... remove the broad column categories ... the 2.5D exploding view as an experiment alternate view ... isolate [a part] and make that the bottom flat layer". Then: "be very cognisant of performance ... especially on zoom".

## Goal

The flat map reads as business software: thin rails, clear stops, no leftover columns. Layers shows one level of the map with each fold lifted over its own place, and any fold or line can become the floor. A zoom step or a fold draws at once.

## Target

| Part | Before | After |
|---|---|---|
| Rail weights `WEIGHT` | out 3, front 7, core 12 | 2, 3, 5 |
| Stop radii | per kind | +1 px each; glyph 18 (hub 24, exit 16) |
| Stop colour | ink | its line's colour (`--lc` on the mark) |
| Open-fold frame | dashed, 1.5 px | solid hairline, 1 px, .55 |
| Columns | Marketing / Sales / Delivery / Money bands | none: one band (`oneBand`) |
| Whole-line node | framed | no frame, name tab under its first stop |
| Looks | flat | Flat, Layers (experiment), `?look=layers&floor=node:<id>\|line:<id>` |

Override: the design-language artifact draws thicker rails and the column bands. William's direction wins for line weights and columns. Every other artifact value stays.

## Decisions

### 1. Columns: drop in the view, keep in the data (now)

`oneBand(view)` (WeakMap-memoized) sets one column and drops spans before tree, place and zoom. `column` stays in the schema, store and pipeline until a follow-up task removes it. Why: one seam changes the look today; the schema change touches convert.ts, metro.ts and the lab, and is its own step.

2026-11-07, WA-1143 (William: "Migration strips it"): `column` is gone from the schema, store, pipeline, lab and view. Options were (A) keep it as an ignored optional field, (B) strip it with a migration, (C) parse it and drop it on read. B won: one shape of data, no stale path, and a body with `column` now fails as a stray field. Migration 0376 strips it from every metro station (body and flows) in `shape_versions` and `shape_drafts`; `oneBand` is deleted. `placesOf` is now the longest plain path from a source. The "a track never goes left" rule went with the columns; the loop rule stays. Fold ids stay `<line>@`, so focus links and prefix lookups keep working; twin ids are `tpl:<template>@<line>`. The sops mirror files keep `column:` until each workspace's next save.

Widening: one band made the big map 5517 px wide, because the widen loop widened every slot. Now `evenX` widens only the gaps a bad span touches, and a widen that clears nothing is undone. Result 2277 px (3297 with the old columns).

### 2. Layers: how to draw 2.5D

| Option | For | Against |
|---|---|---|
| **CSS 3D over `MetroSvg`** (chosen) | No new dependency. Text stays vector and sharp. Same marks, same CSS, same theme. Hit testing is DOM. | Perspective is limited to planes; no real lighting; very large floors cost GPU memory. |
| three.js / react-three-fiber | Real camera, lighting, free orbit, instancing. | ~150 kB+; text as SDF or textures (blurry or heavy); a second renderer to keep in step with the SVG marks. |
| Canvas 2D with a fake projection | Small. | Redraws every frame on turn; text and hit testing by hand. |
| Isometric SVG (one transform) | One SVG, cheap. | No lift between levels without redrawing; no turn. |

Ranked by: same marks as the flat map (one renderer), cost per frame while turning, bundle size. CSS 3D wins all three for planes stacked in z.

### 3. Layers: what a level shows (exploded in place)

The floor is one level with its folds shut. `all` = that level with every fold open, laid out once. Each fold's stations are cut from `all` onto a plate, at the place they hold in `all`; the floor keeps the rest in the same frame. So a plate floats straight over its own place, its footprint shows dashed on the floor, and "Fold back" lands every plate in place: the flat map again.

First try floated each plate over its fold's capsule on a shut floor. Plates were wider than that floor and hung off it. Rejected.

A plate click makes that fold the floor; "Line" picks one line as the floor; crumbs walk back.

Plates lift by depth: the plate nearest the eye (largest y) is lowest, each one further back rises one step (`LIFT` base 90, step 45). Same lift for all made front plates cover back ones.

Pose: a wide floor turns 28°, a tall one (a line floor on a phone) 62°, so it fills the box. Fit projects every corner and solves the scale (0.25–1.4).

Plate surface is tokens only (`--ui-paper` mixed 5% toward `--ui-ink`, a top inset line, a black shadow). The theme sets tokens inline on `<html>`; there is no `.dark` class to hook. Black, not ink, for shadows: ink is light in dark and glowed.

"Fold back" greys out when the level has no plates, so the bar does not jump.

### 4. Speed

| Where | What | Why |
|---|---|---|
| Layers | One layout per level (all folds open at once), plates are crops | N plates cost 1 layout, not N |
| Layers | `Stage` memoized; the pose goes to `style.transform` once per rAF from a ref | A drag never renders React |
| Layers | No filters or shadows on marks inside 3D | Filters in a preserve-3d layer repaint every frame |
| Layers | Fit by projecting the floor and plate corners (math, not DOM) | No layout read while a transition runs |
| Zoom | Idle preload of depth −1 and +1 (`requestIdleCallback`, one at a time) | A zoom step finds its scene laid out |
| Zoom | A fold the pointer rests on (120 ms) lays out before the click | The click draws at once |
| Cache | Scenes cached by view content (JSON key, last 6 views), not object | Each refetch makes a new, equal view; it no longer lays out again |
| ELK | Runs in a web worker (`elk-worker.min.js` shipped as is via `?url`); in-page build as fallback when no Worker or the worker is silent for 4 s | Layout never blocks a frame |

Measured (Storybook, big map, 1280): zoom steps 85–139 ms to the new view, 0 long tasks after a step. Layers first draw ~1.5 s warm, as the flat map.

Considered for zoom: caching rendered sizes (bitmaps per zoom level). Rejected: the map is vector and zoom is a CSS scale of one SVG; the cost on a step is the layout, not the paint. Revisit if a paint profile shows the SVG paint over 16 ms.

## Layers, round 2 (WA-1145)

William: "a little bit underbaked ... open the stacked view and also click into it ... fit it into the sub workflow as the main view. Both of those options should exist ... polish the moving around ... snap to flatten or view everything ... too diagonal ... the fold lines [button] is not doing anything ... like the artifact, you could pull things out".

Why prod did nothing: plates came only from shut folds. A level with none had no plates; "Fold back" sat greyed. Nothing to pull.

| Part | Round 1 | Round 2 |
|---|---|---|
| Split | shut folds only | `split=folds\|lines`; falls back to the one that gives plates; Lines needs 2+ lines; the hub stays on the floor |
| Plate click | makes it the floor | **Open**: camera flies top-down onto it, the rest fade, then the flat map shows only that part (`focus=node:<id>\|line:<id>`), grown to fit (to 1.6× real size) |
| Floor | plate click | **Stack here** on the plate's tag, shown on hover, only when the part holds parts |
| Pull out | none | hover lifts the plate 40 px; dashed footprint and four posts from floor to plate (the artifact's `.drop`) |
| Views | Fold back, Reset view | View **Together \| Apart** (not "Flat": the Look switch says Flat), **Fit all** |
| Pose | 28° turn (62° tall) | 10° turn, tilt 54°; phones the same (a big turn put names on their side) |
| Moving | drag turns | drag turns, and tilt drives apart (`e` follows `rx`); release under 16° snaps flat, else apart and the turn snaps home within 12°; wheel/pinch zooms at the pointer; trackpad scroll and shift- or right-drag pan; springs (`motion`) |
| Line `<select>` | floor = one line | gone: Split Lines + Open covers it |

Camera: one ref `{rx, rz, e, k, x, y}` written to `style.transform` and `--e` once a frame; React never renders on a move. Plates use `translateZ((--zn × --e + --pull) px)`, so apart and landed are one variable.

`scale3d(k,k,k)`, not `scale(k)`: `scale` leaves z alone, so the lift did not shrink with the map and the fit overran the box.

Focused flat map: `focusScene` now drops other groups' open outlines and crops top and bottom to the part (it cropped only the sides).

Option weighed for Open: open the part as a new floor in 3D, top-down. Rejected: the flat map has the panels, picks and marks; Layers would copy them.

## Layers, round 3: match the artifact

William: "doesn't look clean on prod ... no double layered expandable icons ... really make sure it matches the artifacts". Judge: the Layers (3D) tab of the Variants Process Tree artifact (`A5xNkRRGMoMZuH8s7mvfRL`).

| Part | Round 2 | Round 3 (artifact) |
|---|---|---|
| Floor | the level with plates cut out; dashed footprints | the open layout with each fold shut to one stacked stop (two circles, last glyph, "N steps · M now") at its group's middle (`shutFloor`) |
| Plate | crop with stubs ("from First touch") | that fold's stations only, ± 64 px, no stubs; an exit goes with its source |
| Link | footprint + four posts | one dashed line (1 px, accent 70%) from the stop up to the plate |
| Lift | 90 + 45 per depth | 120; a plate rises 60 over the highest plate in front that shares its x range (a stair, so no plate hides another) |
| Look | paper 5% ink, inset line, black shadow | artifact values: paper, ring accent 45%, `0 24px 40px -18px rgb(30 20 60/.45)`; hover ring 1.5 px + pull 40; floor radius 16, hair ring |
| Name | tag on the plate | pill under the plate; "Stack here" inside it on hover |
| Pose | turn 10°, tilt 54° | turn −32°, tilt 56°, perspective 2200 at 30% height |
| Together | plates land on their place | plates land as cards over their stops (the artifact does the same) |

Floor marks are a picture: a scene with `click: false` draws capsules, rings, badges and fold leaves without button roles, so the floor SVG holds no focusable parts under the plates (axe `nested-interactive`).

Not built yet (William, 11-06: "close and open everything and zoom into subviews ... default views"): saved default views in Layers, and open or shut one fold on a plate. Today: Together/Apart closes or opens all, Open zooms to one part with the rest gone, Stack here makes a part the floor.

## Tests changed

- Column tests (order, append, empty-column step, "To map", column drop in a fold): deleted with the columns.
- Even gaps in a column: no longer a clash in `sceneClashes`. Per-gap widen is the rule now. The lab keeps it as a soft score (`unevenOf`).
- Fold ids hold the column: `web@1` is `web@0`, `tpl:post@so@Marketing` is `tpl:post@so@`. They lose the suffix when `column` goes.
- Found by the portal's calm test: a diamond's name sat from `r`, but its tips reach `r × 1.4`. `labelOf` now clears the tips.

## Open

- Phone: Layers at whole-map level is small; a line or fold floor is the way in. A phone-first Layers waits on use.
- Out of scope, from the fresh-eye review: phone header height, flat map framing on a phone, a 24 px inset round the big map, the chat button over the phone nav and dim in dark.
- Done 2026-11-07 (WA-1143): `column` removed everywhere, migration 0376.

Behaviour spec and checks for the Layers look: `designs/2026-11-07-layers-spec.md`.

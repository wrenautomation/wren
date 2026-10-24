# Metro layout lab

2026-10-23. William: big maps look bad; positions are wrong. Build a playground with demo data, so he can pick the best algorithm or mix. The target is the hand-placed maps in the design language artifact. Marketplace workflows come later as sub-maps, so everything takes a `MetroView`.

## Goal

A map from data looks like the hand-placed one. Nothing overlaps at any size. One layout path, picked by score and by eye.

## Cases

One list, `lab/cases.ts`. Each case is a view, with a hand scene when one exists.

- Seven scenarios: `SAMPLE_VIEWS` paired with `SCENARIOS` (data.ts).
- Six industries, the offers map, the zoom map: the scene only. `sceneToView` makes the view. Station ids stay, so the score can pair stations.
- Generated: seeded random funnels, 10 to 80 stations, with logic marks. No reference; they test big maps.

## Engines

Two stages, so any placer mixes with any finisher option.

1. `place(view) → Placement`: an x and a y for each station, and the zones.
2. `finish(view, placement, opts) → MetroScene`: tracks from the view, exits under their source, names and chips (`dress`), rails, size. Taken out of `layout.ts`, not written new.

Placers:

| Id | What |
|---|---|
| `current` | today's `layoutMetro`, whole |
| `elk-bk` | ELK layered, Brandes-Köpf placement (straight lines), zones as partitions |
| `elk-ns` | ELK layered, network simplex placement |
| `elk-lp` | ELK's order, then an LP for y (HiGHS, `lab/lp.ts`) |
| `dagre` | `@dagrejs/dagre` |
| `dot` | Graphviz dot through `@hpcc-js/wasm-graphviz` |

The x of the ELK engines: ELK's layers, one even step apart (`evenX`), so the step sets the width.

The renderer already draws a track between two points at 45 degrees (`octPts`), so a placer gives points only. No engine routes at 45 degrees; that is the one part of our own code, and it exists.

ELK, dagre and dot are vetted and free. Only custom code: the scene→view converter, the generator, the adapters (a view to each engine's graph and back), the scorer and the lab story.

## Score

Per case and engine, from `geometry.ts` (`sceneClashes`, `crossingsOf`, `sceneBoxes`):

- clashes (must be 0), crossings, bends, area.
- likeness to the hand scene: for each pair of stations, do left/right and up/down agree (8 px is level). A share from 0 to 1. This is the main score; the others break ties.

`lab/score.test.ts` prints the board for all cases.

## Lab

Storybook story `Metro/Lab` (:61000): pick a case; the hand scene first, then one card per engine with its score. Later, publish it as an artifact for the iPad.

## Later

- The pick replaces `layoutMetro`. ELK is async: `MetroMap` then lays out in a worker and caches per view shape.
- If no engine comes close: an octilinear solve (Nöllenburg-Wolff on HiGHS), cached per shape.
- Prod path (approved 10-23): ELK for the order, the LP for the geometry, the result cached per shape hash and made in a Restate handler, so no page solves an LP.

## The LP placer (built 10-23)

A placer is `Placer = (view) => Promise<Map<id, Point>>` (`engines.ts`); any one gives x and any other y.

`elk-lp`: ELK BK gives the order. `evenX` gives each station an even x slot. In each slot, stations keep ELK's top-to-bottom order with a hard gap: half of each height plus 24 px. The objective is the sum of |Δy| along the tracks (L1, two rows per track), plus 0.001·y to keep the map tight. A track over more than one slot gets a point of no height in each slot it passes, on the straight line between its ends, so it keeps a place between the stations.

HiGHS (`highs` 1.15.3, Wasm, a dev dependency of `@wren/ui`) solves it. In Node it finds its Wasm itself; in the browser the loader takes the URL from Vite (`highs/runtime?url`). The `Metro/Lab` Industry story waits for every engine, so a load failure fails the story test.

Board, 10-23, all cases (likeness, clashes, crossings):

| Mix | Like | Clash | Cross |
|---|---|---|---|
| x ELK · y today | 0.867 | 20 | 32 |
| x ELK · y ELK + LP | 0.837 | 10 | 7 |
| x ELK · y ELK NS | 0.795 | 12 | 1 |
| x ELK · y ELK BK | 0.783 | 9 | 0 |

The LP is the best ELK y by likeness, at near the clashes of BK. Its last crossings come from the pass-through points: they sit on a straight line, not on ELK's bend. Next: read ELK's bend points for them. William picks by eye in the lab.

## Cut to three, width as a setting (10-23)

William: too many options; the narrow maps look best, width can be a setting. The lab keeps three engines: `current` (Today), `elk-bk`, `elk-lp`. The step between x slots is a setting (`STEPS` 90, 105, 120, 150; default 120). The board shows each engine's mean width at that step.

## Loops, retainers, side by side (10-23)

- A **back track** (a loop, body `kind: "back"`) is `ViewTrack.back`. ELK gets it turned round, and `layoutMetro` orders the stations without it, so a loop never pulls its start to the right. The LP keeps it as a track: it pulls the loop's ends level, which the rail wants.
- A **retainer** is a closed lap in Money ("every 30 days"), a group, so the Groups level folds it.
- NFA choice stays with the trail chain's chances. A token that splits to all branches comes later.
- The generator (`funnel(n, seed, shape)`) makes these: `loops`, `retainer`, `platforms`. The cases `generated-{24,40,64}-shaped` use all three.

## Side-by-side fold (10-23)

One job done on several platforms (one post on LinkedIn, X, YouTube) is several stations. The data stays one per platform; the map folds them.

- A station names its job with `template` and its platform with `platform` (slugs; the metro body has both, and they lower to nothing). No guess from names.
- `twinRuns(view)`: the stations of one template on one line in one column. Two or more fold into one stacked capsule (`each: "platforms"`) with the people added up, the platforms named under it and a chip "4 platforms" (pointer: "146 in · 10 now").
- A twin stays out when it or a track to it has a diff mark, or when its stuck share (now over arrived) departs from the others' by more than 0.25, with 5 people or more (`TWIN_OUTLIER`). So a platform that does badly shows on its own.
- The fold runs first at every level, Stations too, so Groups and Parts fold the folded view. It is closed by default; a click opens it, its tab folds it back. A wheel step clears hand changes, so it folds again. A focus opens every fold (`ALL_OPEN`).
- Stories: `Metro/Side By Side` (the click path), `Metro/Lab/Shaped` (the lab with the toggle on), `Metro/Lab/Shaped Map` (the live map on the generated funnel).

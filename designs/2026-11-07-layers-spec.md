# Layers: behaviour spec and checks (WA-1145 round 4)

2026-11-07. William: "hover is still fucked up. needs to be cleaner (when hovering the whole space should count as a hover, not constantly shifting the hitbox because that just causes jitter, and also make sure there's a closing animation when u click the x)". "now there seems to be overlap issues too ... take way more time crafting test cases / definitions / planning for the UI and how it should behave in different cases". "i don't like this stacked super big purple text button, it takes up too much space, the double layer icon is implicitly just what we need to expand". Earlier: "clicking on the layered icon should just lift it", "lift buttons outside and not based on the position in the map will not scale", "hard to click the shut button".

Judge: the Layers (3D) tab of the Variants Process Tree artifact (`A5xNkRRGMoMZuH8s7mvfRL`, local copy `artifacts/variants-chat/`). Its rules: plates at Z 120, hover +40, Fold back drops every plate to Z 0 in .9 s, one dashed drop per plate, plate ring accent 45 %.

Code: `packages/ui/src/metro/layers.tsx`, `metro.css` (`.mlay-*`). Stories: `Wren/Map/Offer shapes` (6), `Wren/Map/Page` Layers stories. Harness: `scripts/layers-check.mjs` (GPU Chrome, headed off screen; headless draws 3D text jagged).

## Words

| Word | Means |
|---|---|
| Floor | The level with each fold shut as a stacked stop (two circles). Flat, at Z 0 |
| Plate | One fold's stations, lifted over its stacked stop |
| Knob | The stacked stop on the floor. It is the one control that lifts or shuts its plate |
| In hand | The plate under the pointer (or with focus). It rises 40 and shows its acts |
| Acts | Icon buttons at the plate's top-right corner: Stack here (when it holds parts), Shut |
| Tag | The plate's name, a pill under it |
| Footprint | The screen area a plate holds: its face at rest plus its face in hand |

## States and rules

### S1 Hover (in hand)

1. A plate goes in hand when the pointer enters its face at rest. It leaves hand only when the pointer is outside its footprint and its acts for 100 ms.
2. Hover is camera math, not DOM hit tests. Chrome's 3D hit test flips under a still pointer as the face lifts (seen within 4 ms). So `toView()` projects each plate's corners and `inQuad` tests the pointer. In hand holds while the pointer is on the rest quad, the half-lift quad or the full-lift quad. Plates and faces take no pointer events.
3. Only one plate is in hand. Entering another plate takes hand at once, with no wait.
4. In hand: face +40 Z, ring 1.5 px accent, tag accent, acts show, other plates go to 60 % opacity.
5. No hand while the camera moves (drag, fly, open) or when landed (Together).
6. Moving from the face to an act keeps hand. Acts sit astride the plate's top-right corner (-10 px). They show only in hand (visibility, so they take no clicks when hidden).

### S2 Shut (the x)

1. Shut is the `close` (x) act. Click: the plate falls onto its knob (Z to 0, scale to the knob, fade) in 280 ms, and its drop line shrinks with it. Then it is shut.
2. Shut state: no plate, no drop. The knob is named "Lift <name>" and shows a pointer cursor. No ring (William 11-07); hover gives a faint ink 6 % fill.
3. Reduced motion: no fall; it goes at once.

### S3 Lift

1. A click on a shut plate's knob (the floor's stacked stop) lifts it. The plate rises from the knob, the reverse of S2.
2. A click on a lifted plate's knob shuts it (same as S2). The knob is a toggle with `aria-expanded`.
3. No other Lift control. No text pin. The knob is in the floor's plane, so it moves, turns and zooms with the map at any size.
4. Split Lines: the floor has no stop for a line, so its knob draws the stacked glyph itself.

### S4 Open and Stack here

1. A click on a plate (not on an act) opens its part as the main flat view: the camera flies top-down onto it, the rest fade, then the flat map shows it.
2. A drag that started on a plate never opens it.
3. Stack here (layers icon act) makes the part the floor. Shown only when the part holds parts.
4. Touch (no hover): acts always show; a tap on a plate opens it.

### S4b Settle (WA-1198, replaces S4.1)

1. A click on a plate (not on an act or a knob) settles the camera on it, in Layers: it turns top-down and fits that plate and the plates lifted above it. The rest fade to 15 %. The look never changes and nothing is laid out again.
2. Out: Esc, a click on empty space, Fit all, or Together/Apart. The camera goes back to the last pose, fitted to all.
4. Settled, the view has no perspective (camera `o` 1). Chrome draws a layer under any perspective at scale 1, so text past zoom 1 blurs (seen in GPU Chrome, 11-08). The fly eases perspective out; a turn drag eases it back in as the tilt grows.
3. The flat focus view (`focus=` from Layers, its "Layers › part" bar) is gone.

### S8 Nest (WA-1198)

1. One layout per floor opens every fold under it, at every depth. Each plate is a cut of it, so a lift or a shut never moves another plate.
2. A plate's own folds show on it as stacked stops, with the rail through them. Each is a knob: a click lifts that fold's plate over its parent plate, one step (120) higher. A click on a lifted plate's knob, or its x, shuts it. A shut plate takes every plate above it down too.
3. Top-level plates start lifted (`shut=` lists the shut ones). Nested plates start shut (`lift=` lists the lifted ones).
4. The bar's − and + work in Layers: + lifts every plate one level deeper; − shuts the deepest lifted level, then the top level.
5. Hover: the highest plate under the pointer is in hand. A nested knob takes clicks while its parent is in hand.

### S5 Camera

Phone (view under 640 px wide): the fit stops at zoom 0.75 so names read, as the flat map shows labels at real size. A map wider than the view shows its left side and pans; Fit all still shows all. The view clips with `overflow: clip`: focus on an off-screen plate must not scroll it. Drag turns, tilt drives apart; release under 16° snaps flat. Wheel or pinch zooms at the pointer. Trackpad scroll, shift-drag or right-drag pans. Together lands plates on their place; Apart lifts them. Fit all frames the floor and every plate. Pointer down on a knob, an act or the bar never starts a drag.

### S6 Overlap rules (at rest, Apart, Fit all, 1280 × 860 and 390 × 844)

1. A tag never overlaps another plate's face or tag.
2. A tag never overlaps its own plate's face (it hangs 6 px under it).
3. A plate's own stop names sit inside its face (label-aware box, `band()`).
4. Acts sit in the plate's head room. Fit keeps 44 px (HEAD) over every plate for the lift and the acts, so no act sits under the bar.
5. Plates: no plate hides more than 25 % of another plate's face (the stair rule). As built: a back plate rises in half steps while a front plate covers over 8 % of its footprint, or any of its tag strip (rule 1).
6. Knobs: a shut knob is never under a lifted plate's face in screen space at the fit pose, or it is still hit first (the knob takes clicks only where nothing is above it).

### S7 Look

Resolution judged only in GPU Chrome (new headless Chrome, `channel: "chromium"`, runs on the Mac's GPU with no window): 12 px tag text and stop names sharp at k ≥ 0.6. Dark: plate paper, accent ring and drop follow tokens. Phone 390: acts always show, bar wraps, no page scroll.

## Checks (harness `layers-check.mjs`)

| Id | Check | Pass |
|---|---|---|
| H1 | Pointer parked on a 7 × 7 grid on each plate's bbox; in-hand key sampled 8 × 50 ms | 0 spots with two values |
| H2 | Pointer moves in 2 px steps across each plate edge, both ways | in-hand state changes once per crossing |
| H3 | Pointer moves from the face centre to each act | in hand on every step; the act gets the click |
| H4 | Pointer A → B (two plates) | one plate in hand at every sample |
| C1 | Click Shut | plate scale < 0.3 and opacity < 0.2 at 260 ms; slot `.shut` after; knob `aria-expanded=false` |
| C2 | Click knob of a shut plate | plate visible, rises over ≥ 3 frames; `aria-expanded=true` |
| C3 | Click knob of a lifted plate | shuts, as C1 |
| C4 | No `.mlay-lift` text pins exist | 0 |
| O1–O5 | S6 rules 1–5 on projected quads (corner markers in each box), separating-axis test; O5 by sampling | 0 hits |
| E1 | Page and console errors over the run | 0 |

Stories run: all 6 `wren-map-offer-shapes--*` (every play in each select), and Map Layers. Widths 1280 and 390.

## Decision: nesting and open (WA-1198, 11-08)

William: opening a plate "does a animation into a weird quick switch into the flat view"; the subview's expand and collapse "are all glitchy and not functional"; Delivery inside Core offer should expand "into a second layer on top of the first ... (nested)". Cause, seen in recorded frames: the camera fills the screen with the plate, the whole flat map shows for ~200 ms, then the flat map fades to the part at a smaller size. The subview forced every fold open, so its fold buttons redrew nothing.

| Option | For | Against |
|---|---|---|
| **A. Nest in Layers; open settles the camera, stays in Layers** | One renderer, one camera, no handoff; nesting as he drew it | Larger rework of `plates.ts` and `layers.tsx` |
| B. Keep the flat subview; morph the plate into it; fix its folds; one extra lift level | Smaller | Two renderers still meet; nesting one level only |
| C. Drop the fly; Layers opens flat with a fade | Smallest | Layers stays a one-level overview |

Chosen: A (William, 11-08).

## Decision: where Lift lives

| Option | For | Against |
|---|---|---|
| A. Text pin (icon + name) in a flat overlay, placed each frame | Always upright and readable | William: too big, purple, covers the map; one more control |
| B. Icon-only pin in the flat overlay | Small | Still a second thing on top of the stacked stop; screen-size, not map-size |
| **C. The stacked stop itself is the button (knob in the floor's plane)** | The icon he named; scales and turns with the map; no overlay, no per-frame placing | Small at far zoom; on Lines the knob draws its own glyph |

Chosen: C. It is the artifact's own reading of a fold (the stacked stop is the fold), and William named it.

## Decision: hover hit area

| Option | For | Against |
|---|---|---|
| A. CSS `:hover` on the lifting plate (old) | No JS | The hit box moves with the lift: jitter at the edges |
| B. Still pad only; face never hit | Never moves | The lifted band at the face's top is dead: a pointer on the face it sees is not on it |
| C. Pad always; face joins while in hand; leave after 100 ms | Never moves under a still pointer (hysteresis); the whole footprint counts | Built first: Chrome's 3D hit test still flipped pad → page within 4 ms |
| **D. Camera math: project plate quads, test the pointer in JS** | No browser hit test at all; same hysteresis as C | Must track the camera (it is ours: `toView`) |

Chosen: D (C failed H1 in GPU Chrome).

## Decision: loading skeleton (11-07)

William: the skeleton "doesn't fit the actual layout that gets loaded in".

| Option | For | Against |
|---|---|---|
| A. Better fixed sketch | No state | Never matches a real map |
| B. Server sends a layout outline first | Exact on first visit | A second read path; the layout runs in the browser (ELK), so the server has none |
| **C. Ghost: keep the last drawn layout per page in this browser, draw it muted** | Exact on every visit after the first; a few KB | First visit and a new browser get the sketch |

Chosen: C. `metro/ghost.ts`: `metro.ghost.v1.<page key>` in localStorage, last 16. It keeps stops, rails, name bars and the map's window top (chrome over the map loads with the data). The skeleton draws it in the map's own frame classes. Checked: Map page at 1280 and 390, skeleton svg rect within 0.1 px of the drawn map.

# Brief B: metro renderer (wa-7oo.5)

Design: `designs/2026-10-20-design-language.md`, and its section "Decisions (planner, 2026-10-20)". Source of truth: `designs/2026-10-20-design-language/{design-language.src.html, metro-render.js, metro-render.css}`, sections 04, 05, 06, 08 (marks) and 09. The artifact wins over the doc. Port it; do not redesign it.

Two stages, two commits. Stage 1 first. Stage 2 (subset) is last and must not share a commit with stage 1.

## Stage 1: the renderer

Put it all in `packages/ui/src/metro/`. Add one export, `"./metro"`, to `packages/ui/package.json`. Do not touch `index.ts`, `shell.tsx` or `tailwind.css`.

1. **Scene type and draw.** `MetroScene`: the positioned scene, typed, ported from the artifact's `draw(sc)` input (stations `st[]`, tracks `tr[]`, zones, lines, groups, size). `MetroSvg` (or `drawMetro`) draws it as React SVG elements, not a string. Port every helper once: octilinear paths with rounded corners (`octPts`, `rnd`), marker, chip, rule tag, person pill, transfer, capsule, ring (folded loop), badge (folded offer), leaf, fold tab.
2. **Every mark.**
   - Stations: att, time, cash, exit, hub, plus.
   - Capsules, transfers, person pills ("WJ · 4h", amber when late).
   - Chips: retry, hold, version.
   - Logic: condition diamond, race, split and join gate with rule tag ALL / ANY / N OF M, A/B ring with % arms, approval, shared flow link, interrupt frame.
   - Weight is the job: out 3, front 7, core 12.
3. **Glyphs.** Use `packages/ui/src/icons.tsx`. Add any missing Lucide glyph there (Lucide is ISC). No metro-local icon table.
4. **Tokens.** Read `var(--ui-line-0)` to `var(--ui-line-7)`, `--ui-ink`, `--ui-ink-3`, `--ui-paper`, `--ui-bad`, `--ui-warn`, `--ui-accent`. Builder A adds the line tokens in parallel. Do not define them. Before A lands, the lines draw with no colour; that is fine.
5. **View and layout.** `MetroView`: the store's shape, no positions.
   - `lines: {id, offer, tier: "out" | "front" | "core", colour}` (colour = line token index)
   - `stations: {id, kind, line, column, group?, label, ...}`; kinds: att, time, cash, exit, hub, plus the logic kinds
   - `tracks: {from, to, by: "system" | "person", owner?, promise?, late?}`
   - `groups: {id, label}`
   - `columns`: Marketing, Sales, Delivery, Money by default.
   `layoutMetro(view): MetroScene` places columns as zones, a row per line, the hub across the rows, exits under their source, transfers at 45 degrees. It must draw any list of stations and tracks it gets. Pure; unit tests in `metro/layout.test.ts`.
6. **Zoom and folds.** `MetroMap` React component. Levels: Parts, Groups, Stations, and Offer for the section 08 map. Config-driven, like `mountZoom`: presets of fold flags plus `compose`. Folded groups become capsules; the hub and exits never fold; tracks reattach to the capsule edge; a late track inside makes the capsule amber. Fold tabs open one group. Glide between levels (keyed elements, FLIP or CSS transforms). Wheel and pinch zoom. Honour reduced motion.
7. **Focus and hover.** Hover or focus a line lights it (the `focusable` rule). Stations take keyboard focus; Enter or Space opens a fold or calls `onPick(station)`. Each station has an accessible name.
8. **Dark mode.** Night line variants come from the tokens; the drawing uses no fixed colour.
9. **CSS.** Port `metro-render.css` to `metro/metro.css` (or Tailwind classes), scoped to the map.

## Stories (`packages/ui/src/metro/metro.stories.tsx`)

- The section 04 and 09 glyph tables (every station, track and logic mark).
- The section 05 zoom scenario, each level.
- The seven section 06 scenarios.
- The section 08 offers map and loop ring, each level.
- The section 09 hero (sales protocol: Folded, Groups, All).
- The six industry examples (`LX`).
- At least the section 06 scenarios again, drawn from a `MetroView` through `layoutMetro`.
- Night versions.

Render, play, axe only. No pixel baselines. Play tests: hover lights a line, Enter opens a fold, a level switch changes what shows.

Sample data is public: keep it synthetic. No real offer prices, no client names. Initials "WJ" are fine (they are in the artifact).

## Stage 2: subset (last)

A `focus` input on `MetroMap` and the draw: `{kind: "line" | "group" | "station" | "flow", id}`. It draws only that part, plus stub ends: a short faded track in and out, labelled with where it comes from and goes to. `onStub(part)` fires on a stub click. One story per kind from the source scenes (for example the section 08 delivery loop ring alone, the section 09 Sort group alone). Unit tests for the filter. No routes and no pages (area F).

## Checks

- While you build: `./scripts/gates.sh changed`, or `vitest run <file>`. Never `tsc`, `turbo` or `vitest` for the whole repo.
- Stop every server and watcher before you report.

## Commit

`git commit -- <paths>`. Message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Do not push. Do not run the full gate; the planner runs it. Report each stage's sha.

## UI rules for the React wrapper (William, 2026-10-20)

- No data fetching in `metro/`. Data comes in as props; the portal reads it through TanStack Query (area D).
- Zoom level and open folds are controlled props with change callbacks (`level`, `onLevel`, `open`, `onOpen`), uncontrolled by default. The portal stores them per viewer. The map keeps no state that a remount loses when the parent passes it.
- Any popover or sheet the map opens closes on outside click and on Esc.

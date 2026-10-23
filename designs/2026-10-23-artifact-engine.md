# Artifact engine: design artifacts draw with the app's code

Date: 2026-10-23. Status: built for one artifact (Offer Video). The others move after William sees it.

## Problem

Each design artifact carried its own copy of the metro renderer (`metro-render.js`, about 15 KB, hand ported). The app's
engine in `@wren/ui/metro` moved on: views, `layoutMetro`, zoom and folds, focus. The copies drifted. Offer Shape lost the
zoom switch because its copy could not fold. Section 10 of the Design Language promises "the spec and the app draw from
the same code". The copies broke that promise.

## Target

One script, built from `packages/ui`, attached to every artifact that draws a map or a kit part. The artifact page sends
data (a `MetroView`, a scene) and mounts parts. It holds no drawing code.

## Build

- `pnpm --filter @wren/ui engine <out dir>` runs Vite in library mode (`.engine/vite.config.ts`): IIFE, global
  `window.Wren`, React inside, Tailwind CSS and the Figtree font inlined in `wren-engine.css`.
- `.engine/entry.ts` picks what ships: the metro engine and its samples, the theme (`applyTheme`, `PRESETS`), and a pick
  of the kit (layout, controls, marks, fold, steps, timeline and others). The whole kit is 3.5 MB (charts, graph, ELK); the
  pick is 0.9 MB (0.3 MB gzip). Add a part to the pick when an artifact needs it.
- The artifact publishes `engine/wren-engine.js` and `engine/wren-engine.css` as files beside its page. The artifacts
  repo records the wren commit each build came from.

## Trade-offs

- Size: 0.9 MB per artifact against 15 KB. Under the 16 MB cap. The price of one source.
- An artifact sketch that needs a mark the engine lacks is now a wren change first. That is the point: the mark then
  exists in the app too.

## Decision log

- 2026-10-23: Vite library mode, not a custom bundler: Vite and its React and Tailwind plugins already build the portal
  and Storybook.
- 2026-10-23: files beside the page, not inlined: one file per build, easy to diff and to swap.

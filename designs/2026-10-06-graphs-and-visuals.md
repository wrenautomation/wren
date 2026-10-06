# Graphs and visuals: rich, live, everywhere they explain something

2026-10-06. William: "i also don't see rich graph functionality and visual diagrams / visual based
stuff, which we agreed upon and even used reactflow." Building on his "go on everything".

## What's there

React Flow (`@xyflow/react` 12) draws four graphs: the Shop's Map (`flow-map-graph.tsx`), the
Workflows canvas, a run's steps (`run-graph.tsx`) and a lineage (`lineage-graph.tsx`). All four
turn pan and zoom off, with no minimap, no controls, no hover, no side panel and hand-placed
layout. They are pictures. There is no chart library: Overview tiles are numbers. Play
(workflows build order step 7) isn't built.

## 1. One graph kit

`packages/ui/src/graph/` on React Flow. Every graph uses it, and the four above move onto it.

- Pan, zoom, fit, minimap and controls. Keyboard: arrows, +/-, F to fit.
- Auto layout with elkjs, left to right, stable between loads.
- Node kinds: part, workflow, account, step, record, host. Each shows its name, state and its
  number.
- Wires carry their count and rate ("412 → 31, 7.5%").
- Hover shows a card. Click opens the record in the same side panel lists use, with its actions,
  Ask Claude and History.
- Search lights up matches. Filters (state, channel, kind) fade the rest.
- Export to PNG and SVG.
- Phone: one-finger pan, pinch zoom, the side panel as a sheet.

## 2. Live

- Every wire shows the last 30 days and today, from the ports' counts (already built).
- A real event, read from `spine_events`, sends one dot along its wire. Failed shows red, and
  held or waiting shows amber.
- Motion only for real events, never decoration.

## 3. Diagrams where they explain something

| Where | Shows |
|---|---|
| Workflows canvas | The workflows, with live numbers, nested opening in place, Edit wiring kept |
| Shop Map and each part's page | What a part builds on, and its inside as a small graph |
| A lead's page | Their journey: every touch across channels, replies, the booking, in time order |
| A sequence (Library) | Steps, waits and each step's template, variant and reply rate |
| A workflow's funnel | Stage-to-stage conversion as a funnel |
| A run (agent, explore, render) | Its steps, durations and the failing step |
| Infra (team only) | Box, Lambda, desk, Restate, workers and probers, each with health |

## 4. Charts

shadcn's chart components (Recharts), on the existing tokens:

- Overview tiles get a sparkline.
- Each app's overview gets time series: sends, replies, bookings, spend.
- Funnels and per-variant bars sit beside A/B results.

## 5. Play

Play walks a synthetic lead through a workflow on the canvas, step by step, with each step's
real copy and wait compressed. It's for demos and VSL recordings, and it never touches real
records.

## Build order

1. The graph kit, and the four graphs moved onto it.
2. Live numbers and real-event dots.
3. Charts on Overview and app overviews.
4. Lead journey, sequence diagram, funnel and infra map.
5. Play.

## Decision log

- 2026-10-06: written from his note and the live portal: four React Flow graphs with pan and zoom
  off, no charts. Building.

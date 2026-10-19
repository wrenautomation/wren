# Brief M2: the Map page, read

Design: `designs/2026-10-19-business-map.md` ("Map page", and "Decisions (planner)"). Bead `wa-mnu.2`. Worktree `~/worktrees/wren-map`, branch `map`, from `main` (M1 is in). Read `DESIGN.md` (Colors, Charts, Motion, Navigation and shell), `.claude/skills/wren-ui/SKILL.md`, `map/objects/ui/CONTEXT.md`, card `platform/shape`.

## Goal

Home `/` for the team is the Map of the workspace's shape. Today docks on the right. Nothing on the Map writes (editing is M3).

## Do

1. **Ribbon edges in the graph kit** (`packages/ui/src/graph/`): `GraphEdge` gains `weight?: number` (people crossed) and `loop?: true`. `GraphProps` gains `ribbons?: true`. With `ribbons`, a flow edge draws as a ribbon: stroke width maps linearly from the drawing's largest weight, min 2px, max 48px (pure helper `ribbonWidth(weight, max)` in `model.ts`, unit tested). Loop edges are left out of the elk input (`layout.ts`) so they do not change layering, then drawn as thin dashed curves between the laid nodes. Ribbons grow in once on load and widths ease on change (`DESIGN.md` Motion; `prefers-reduced-motion` turns both off). The SVG/PNG export draws ribbons and loops too. Existing graphs look as today (no `ribbons`, no change).
2. **Map read** (`apps/portal/web/src/map/`, new folder; one module-free page drawn at `/`):
   - Reads console record `pipeline.shape` (row `shape`: `body`, `depths`, `versions[]`) and `pipeline.number` rows (kinds `node`, `edge`, `offer`) for the window; ghosts from `pipeline.journey` view `ghost` (fields `version`, `node`, `node_name`, `ghost`). Records live in `apps/worker/src/console-records.ts`. One read hook; TanStack Query, as the other pages.
   - Layered, direction down, ribbons on. Node per shape node: name, kind glyph, one number (people now; plan: collected money in the window). Kind colors from tokens, plan and offer nodes carry the accent. Dark canvas, no grid, no chrome. A ghost (a removed node that still holds people, from the journeys' versions) draws dashed and faded with its count.
   - Hover: the four numbers (now, arrived, left, median days; plan: scheduled and collected). Click: a details panel on the right (people on it, newest first, with link to each journey; recent crossings in and out; "Open"). Double click or Open: the managing app filtered to the node: source → Marketing for its channel, Engage for an outbound DM source, Ads for ads; step and offer → Pipelines journeys `?node=<id>`; offer → also Offers; plan → Payments and deals. Put the routes in one table with a unit test that each is a real page.
   - Top bar: window picker (7, 30, 90 days, all; default 30, in the address `?window=`) and the client picker (the existing tenancy switch; no new switch).
   - History panel (read only): versions newest first (number, note, author, date); pick two to see the diff drawn with the kit's `mark` (added, removed, changed) and the list from `diffShapes`.
   - Empty database (no shape): one plain line and the starter's palette shown inert, with "Start from Wren's shape" disabled and a note that M3 turns it on. Keep it to a line; M3 wires it.
3. **Home**: for team viewers (`props.team`), `/` renders the Map with Today docked on the right (`WrenToday` and its Write and Move lists in the dock; the PageHeader goes). The dock collapses; its open state is remembered per viewer in `localStorage` through the `recall`/`keep` helpers in `App.tsx` (move them to a shared file if two files need them). On a phone the dock is a tab under the Map, not a side panel. Client logins keep `ClientToday` unchanged.
4. **Pipelines journeys** take `?node=` as a filter (the drill-down target). The board already reads nodes (M1).
5. **Stories**: kit parts (`packages/ui/src/graph/*.stories.tsx`): ribbons Default, Empty, WorstCase (huge counts, long names, 40 nodes), loops. Pages (`pages-wren.stories.tsx` and a new `pages-map.stories.tsx`): Map default, empty DB, a ghost, node panel open (in `play`), history diff open (in `play`), dock collapsed, phone width. Fake data in `mocks/data/` on a synthetic shape (no real names, no amounts that look real). `./scripts/gates.sh ui` passes.
6. **Map cards**: `map/objects/ui/CONTEXT.md` (Map page, ribbons), `platform/portal-shell.md` (home is the Map for the team), `platform/shape.md` (who reads it). `map/_meta/build.sh` then `map/_meta/build.sh --check` passes.

## Not

- No edits, palette, save, import or restore (M3). No new server routes unless a read is missing; if one is, add it to the console records in `apps/worker/src/console-records.ts` (reads in `packages/pipeline`) with an integration test.
- No change to a client's Today or sidebar.
- No new libraries: `@xyflow/react`, `elkjs`, TanStack, the kit.

## Checks and commits

While building `./scripts/gates.sh changed` and `./scripts/gates.sh ui` (never wrap `pnpm test:stories` in lockf). Full `./scripts/gates.sh` once at the end. Stop Storybook when done (`lsof -i :61000 -i :61001` shows nothing). Biome format each changed file. Commit only your paths with `git commit -q -F <msgfile> -- <paths>`, ending:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Report: sha, checks and results, what you left out and why.

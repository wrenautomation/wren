# Brief M1: shape model and store

Design: `designs/2026-10-19-business-map.md` (read it whole, then its "Decisions (planner)" list at the bottom). Bead `wa-mnu.1`. Worktree `~/worktrees/wren-shape`, branch `shape`, from `main`. Read `CLAUDE.md`, `map/CLAUDE.md`, `map/routing.md` (Pipeline hub), cards `platform/funnel`, `platform/journey`.

## Goal

One shape per database replaces the ordered funnels. People move along edges. Depth replaces stage order. Every edit is a version. Numbers are per node, edge and plan. The portal keeps working on the new model (the Map page itself is brief M2).

The work runs in three phases, one builder each, in this one worktree. Each phase ends in a commit. Phase A must pass the `@wren/pipeline` checks on its own; the whole-repo gate runs at the end of phase C.

## Model (`packages/pipeline/src/model.ts`)

`ShapeBody { name: string; nodes: Node[]; edges: Edge[] }`. `FunnelBody`, `Stage`, `Entry`, `checkFunnel` go (keep a private copy of the old types in `migrate.ts`, which alone reads old funnel bodies).

Every node: `id` (rule `STAGE_KEY`, at most 40, never `dropped`), `kind`, `name`.

| kind | more fields |
|---|---|
| `source` | `via`: `organic`, `outbound`, `ads`, `referral`, `sourced`, `group`, `manual` (today's entry kinds; `funnel` is gone, edges do it). `channel?`, `campaign?`, `source?` (sourced: `import:<id>`), `group?` (segment id), `parked?: true` (opens nothing). |
| `step` | `action`: one of `ACTIONS` = comment, reply, dm, email, text, call, cta, visit, form, book, held, proposal, signed, other. `advance: Advance[]`, `research?`, `idleDays?`. |
| `offer` | `offer` (registry offer id). `advance`, `research?`, `idleDays?`. |
| `plan` | `terms` (a terms plan slug of the offer above it). `advance`, `idleDays?`. |

`Edge { id; from; to; kind: "flow" | "loop"; label? }`. Edge id rule `^[a-z][a-z0-9_]*$`, at most 81. Default id `<from>_to_<to>`.

`checkShape(next, ctx)` gives plain sentences, empty = ok. `ctx` = triggers, group(id), source(id) as `FunnelContext` has today. Rules: at least one source; ids valid and unique (nodes, and edges); edges name existing nodes; no self edge; no two edges with the same from, to and kind; flow edges acyclic (name one cycle in the sentence); a source has no incoming edge of either kind; every other node has at least one incoming flow edge; a plan's incoming flow edges all come from one offer node; a loop edge never ends at a source; every `advance` trigger is known; research and idleDays as today; source fields as today's entry rules (sourced needs a valid existing source, group a valid active group).

`depthOf(body): Record<nodeId, number>`: longest flow path from any source; sources are 0. Pure. Unit tests: diamond, two sources, a loop edge ignored, upsell below a plan.

`pathOf(body, from, to)`: the shortest flow path (fewest edges, ties by edge order in the body) as edge ids, or null. A single loop edge from `from` to `to` counts as a path of one.

## Store (`packages/pipeline/src/schema.ts`, `store.ts`)

Migration `packages/db/drizzle/0304_*` via `pnpm db:generate`, hand edits after. Additive only: old code must keep running on it during the deploy.

- `pipeline.shape_versions`: `number` int pk, `body` jsonb, `depths` jsonb (from `depthOf`, written by the store), `note` text not null, `parent` int null references number, `created_by`, `created_at`. `never_edited` trigger like `funnel_versions`. Add it to the audit install's money list (`packages/db/src/audit/install.ts`) and wherever audited tables are listed.
- `pipeline.journeys`: add `node varchar(40)`, `shape_version int` references `shape_versions(number)`, `trail jsonb not null default '[]'`. Make `funnel`, `stage`, `version` nullable. In the TS schema: `version: integer("shape_version")`, and the old ones as `funnel`, `stage`, `funnelVersion: integer("version")`, all commented "legacy, read only by migrate.ts". A later migration (M3) drops them and renames `shape_version` to `version`; only the column strings change then.
- `pipeline.deals`: add `node varchar(40)` (the offer node the deal was made at). Add unique `(journey, node)`. Keep `uq_deals_journey` for now (M3 drops it).
- Views (`views.ts`): `node_counts` (version, node, day, arrived, skipped, left), `edge_flow` (version, edge, from, to, day, crossings), `source_numbers` (per source node, the columns `entry_numbers` has). Over events of `shape.v%` only, skipping cause kind `version`. The old `stage_counts`, `stage_flow`, `entry_numbers` become views over the new ones with their old columns (`funnel` = `'shape'`), for one release. Nothing new reads them.
- `pipeline.spine_executions` (`packages/core/src/schema.ts:393`): title from `coalesce(j.node, j.stage)`.
- One open journey per person: enforce in code (advisory lock on the profile in every open path). The unique index comes in M3, after prod is migrated.

`saveShape(db, { body, note, by, triggers, moves? })`: check, refuse "Nothing changed." when the canonical hash equals the newest, lock, insert number + 1 with parent = newest, then carry. `moves` is `{ oldNode: newNode }` (each new node must exist in the body). Carry (rewrite `carry.ts`): each open journey whose node is in the new body, or is a key of `moves`, gets a version-cause arrival at `s_<node>` of `shape.v<new>` and `version` = new. A journey on a node the new body lacks and `moves` does not name stays on its version: a ghost. Its moves follow its own version's edges. `diffShapes(a, b)`: nodes added, removed, renamed (same id, new name), changed (other fields); edges added, removed, changed. `shapeVersionsOf`, `newestShape`. Remove `addFunnel`, `appendFunnel`, `setFunnelStatus`, `funnelContext`, `funnelVersionsOf` (keep `funnels`/`funnel_versions` tables as read-only history).

## Workflow and moves

- `workflow.ts`: `shapeWorkflow(version, body, scope)` with id `shape.v<n>` (`shapeFlowId`, `parseShapeFlow`). Same node pattern as today per non-source node: `t_<node>_<i>`, `m_<node>`, `s_<node>`, input `in.<node>`, the `dropped` node. Group and sourced sources: `e_<source>` trigger nodes wired to `m_<to>` of each of their flow edges. A parked source builds nothing. No `trigger.journey` entries (composition is now edges in one shape).
- Arrival data at `s_<node>`: `from` (node or null), `edges` (edge ids crossed, in order), `skipped` (nodes passed through), `forced?` ({ reason }), plus today's `journey`, `profile`, `cause`. An opening lists the source's edge.
- `steps.ts`: an advance trigger on node X moves the person's open journey along `pathOf(current, X)`; no path, no move (as today a backward move is a no op). No open journey: open at X when a non-parked source has a flow edge to X and matches (`opensAt`/`entryOf` rewritten on source nodes; `journeys.entry` = source node id). Arrival at an offer node makes the deal (today's sale-stage insert, with `node`). Arrival at a plan node signs that deal (`signDeal` with the plan slug) when it has no terms and live terms exist; else it logs and moves on. A journey at a node with no outgoing flow edge is `done`.
- `moves.ts`: `moveEmit(db, { journey, to, by, reason? })`. Edge path from its version's body. No path: refused, unless `reason` is set (then `forced`, `edges: []`). Always refused: a node already in the journey's trail (an arrival in the same workflow is unique per subject in `events`); the sentence says to drop and reopen. Crossing a loop edge (from an open or dropped journey at its `from`) closes the old one (dropped, reason `loop <edge>`) and opens a new journey at `to`, entry = the old entry, `entry_ref.loop` = old journey id. `rebuildJourney` reads `shape.%` events: node, version, status, trail (`{ edge, from, to, at }` per crossing; a version-cause arrival that holds `trail` seeds it).
- `journeys.ts`: `shapeWorkflowsOf` (newest version plus every older version that holds open journeys), `soundShapes`, open and drop paths on node ids.
- `research.ts`, `sourced.ts`, `collect.ts`, `restate.ts` (requests take `to` node, `reason?`), `records.ts`, `console.ts`/`console-routes.ts` follow. Records: `pipeline.funnel` goes; `pipeline.shape` (one record: newest body, depths, version list; actions `version` { body, note, moves? }, `diff` { a, b }, `import` { text }); `pipeline.journey` shows node, node name, trail, ghost flag; `pipeline.entry` rows are source nodes; `pipeline.number` kinds `node | edge | offer`.
- `numbers.ts`: per node now, arrived, left, median days there; per edge crossings; per plan node scheduled and collected cents (deals made at its offer node with its plan's terms, `schedule.ts`); window 7, 30, 90 days or all. `NumberRow.kind` = `node | edge | offer`.
- `shape-file.ts`: YAML in and out with the `yaml` package (add it to `@wren/pipeline`). Export writes the body. Import reads `{ name, nodes, edges, note?, moves?, terms? }`; `terms` is a list of `NewTerms` minus `by`, each added through `addTerms` unless the plan's newest version has the same body.
- Delete `fold.ts`, `seed.ts` and their tests and CLI (`pipeline-fold.ts`, `pipeline-seed.ts`): both ran on prod (wa-8pi.3, wa-8pi.11) and the old deals tables are gone. Keep `fold-guard.test.ts` working (it tests migration 0303).

## Migrate (`migrate.ts`, `wren shape migrate [--dry] [--all | --client <id>]`)

Pure `shapeFromFunnels(newest funnel bodies, statuses)` then a writer. Rules: one node per stage key (same key in two funnels: one node if label and kind agree, else `<key>_<funnel>`); the sale stage becomes an `offer` node with the funnel's offer; other stages `step` (action `other`, or the key when it is in `ACTIONS`); consecutive stages give flow edges; each entry becomes a source (identical entries merge, else `<entry>_<funnel>`) with a flow edge to its `to`; a `funnel`-kind entry becomes a flow edge from that funnel's sale node to its `to`; an `off` funnel's sources are `parked`. Writes v1 through `saveShape` (note "From funnels: <ids>") only when no shape exists. Then, every run, each journey with `node` null: node = its stage's node, `version` = 1, entry = its source node, trail from its old `s_` arrivals in order (edge = the matching flow edge or null), one version-cause arrival in `shape.v1` holding that trail (open journeys only), deals `node` = the offer node. A person with two open journeys keeps the deepest (then newest); the other drops with reason "one journey per person". Safe to repeat. `--dry` prints the shape and the counts and writes nothing, and works on a database without 0304. `--all` = main and every client database, as `wren templates sync` does.

Add it to `.github/workflows/deploy.yml` after `migrate` (not continue-on-error): `pnpm -s wren shape migrate --all`. A no op once done.

## Phases

**A. `packages/pipeline`** (everything above except the CLI). Unit tests for model, depth, path, diff, workflow, steps, entry, shape-file, shapeFromFunnels. Integration (`test/integration`): store (save, refuse cycle, carry, ghost, moves map), moves (path, forced, refused revisit, loop reopens), migrate (two funnels into one shape, journeys keep position, repeat adds nothing, two open journeys), numbers (node, edge, plan), schema/views (compat views answer). Checks: `lockf -s /tmp/wren_automation-checks.lock pnpm --filter @wren/pipeline typecheck`, then one file at a time `lockf -s /tmp/wren_automation-checks.lock pnpm -s vitest run <file>` from `packages/pipeline`; integration files the same way with the package's integration config. Commit "pipeline: shape model, store, moves on edges, migrate".

**B. Core, worker, CLI, map, skill.**
- `packages/core`: `spine.ts` (`SpineDeps.funnels` → `shapes`), `logic.ts` `trigger.journey` (settings `node`, `on`; read the old `stage` setting as `node`, ignore `funnel`; facts `{ trigger, node, change, sale? }`), `webhook-events.ts` (`journey.moved` gives `node`, keeps `stage` = node id for one release; `deal.won` from offer arrival), `profile-pipeline.ts` (merge: deeper node by version `depths` wins, the other drops "merged"), `segments.ts` (journey condition `node`, old `stage` read as `node`, `funnel` ignored; `reached` = node in trail or current; describe prompt), `people-console.ts`.
- `apps/worker`: `services.ts`, `components.ts`, `console-records.ts`, `journey-research.ts`, `sourced-feed.ts`.
- `apps/cli`: `wren shape show|versions|diff <a> <b>|export [--version n] [--out file]|import <file>|add-node|connect|remove|move|migrate`. `add-node`, `connect`, `remove` each save a version and need `--note`. `remove` refuses while open journeys sit on the node, unless `--move-to <node>` (a `moves` entry) or `--ghost`. `move <journey> <node> [--reason]` goes through the `Journeys` service. `wren funnels` goes. `wren journeys move` stays as the same handler as `shape move`. README CLI section.
- Map: new card `platform/shape` (from `platform/funnel`, which goes); update `platform/journey`, `platform/deal`, `platform/spine`, `leads/segment`, `map/routing.md` Pipeline hub. Regenerate twins (`map/_meta/build.sh`); `pnpm map --check` passes.
- Agent: `apps/portal/web/public/agent/SKILL.md` gains a "Shape" section (records, actions, CLI); `.claude/skills/wren/SKILL.md` if it names funnels.
- Checks: `./scripts/gates.sh changed`. Commit "core, worker, cli: journeys on the shape; wren shape".

**C. Portal** (`apps/portal/web/src`): board columns = non-source nodes by depth then name, from `pipeline.shape` (`modules/deals/board.tsx`); the funnels page goes (route, module entry, stories, `moved.test.ts`); journeys page shows node, trail, ghost; Today's moves (`moves.ts`, `today.tsx`) show node names; segment editor's journey condition picks a node (`modules/people/segments.tsx`); `/numbers/funnels` reads node and edge rows (rename the tab "Shape" only if a route test needs no change, else keep the path); mocks (`mocks/data/journeys.ts`, `mocks/data/offers.ts`) on a synthetic shape. Stories pass: `./scripts/gates.sh ui`. Then the full gate once: `./scripts/gates.sh`. Commit "portal: board and journeys on the shape".

## Not

- No Map page, no Sankey, no editing UI (M2, M3). No seeds of real shapes (M3).
- No unique index on open journeys, no column drops (M3, after prod runs migrate).
- Never touch `apps/cli/src/learn.ts`, `packages/learn/src/score.ts`, `packages/learn/test/integration/*`.
- Public repo: synthetic names only; no client names, amounts, lead data.
- Nothing against prod. No push.

## Checks and commits

While building `./scripts/gates.sh changed`; never bare `tsc`/`turbo`/`vitest` on the repo; never wrap `pnpm test:stories` in lockf. One full gate at a time on this Mac; nothing left running. Biome: strings with inner double quotes use single quotes; `pnpm -s biome format --write <file>` before commit. Commit only your paths: `git commit -q -F <msgfile> -- <paths>`, message ending:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PpzL4T1jZXndKhYDqy2SGC
```

Report: commit sha, what each check ran and its result, anything left out and why.

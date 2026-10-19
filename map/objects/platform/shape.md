---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 54faff9d
entity: packages/pipeline/src/model.ts:123
---

# shape

The map of one business: a directed graph of sources, steps, offers and plans that people walk down to money (Business Map; replaces the ordered funnel). One shape per database. A version is a row of `shape_versions`, append only.

## Why this shape

An upsell or a second route into one offer is a node and an edge, not a second list. Nothing above it changes. Depth (the longest flow path from a source) gives code the order it used to read from stage position.

A node id is the spine node id, so it never goes, moves or gets renamed: versions only add and remove. A journey never arrives twice at one node in one version (`events` is unique per workflow, node and subject), so a way back is a `loop` edge: it closes the journey and opens a new one at the loop's end. Nobody sits on a source: an opening crosses the source's edge and lands on its target.

The file form (YAML) is the way to read, diff in git and write a whole version at once. The database stays the source of truth.

## Shape

- `ShapeBody` (`model.ts:123`): `name`, `nodes`, `edges`. Node kinds: `source` (`via` organic, outbound, ads, referral, sourced, group, manual; `channel`, `campaign`, `source`, `group`, `parked`), `step` (`action`, `advance` list of `Advance`, `idleDays`, `research`), `offer` (`offer`: the registry offer id; reaching it makes the deal), `plan` (`terms`: the plan slug of the offer above it; reaching it signs the deal under live terms). Edge kinds: `flow` (down, toward money; the flow graph is acyclic) and `loop` (back up; left out of layers). The id `dropped` is reserved (`DROPPED`). An edge id defaults to `<from>_to_<to>` (`edgeIdOf`, `model.ts:164`).
- `checkShape(next, ctx)` (`model.ts:184`): pure; returns plain-English errors. Ids valid and unique; at least one source; known triggers; no cycle in flow edges; a `group` source names an active segment (`ctx.group`); a `sourced` source names an `import:<id>` that exists (`ctx.source`). The caller passes the trigger set (`TRIGGER_IDS` in core `logic.ts`), so the file imports no spine.
- `depthOf(body)` (`model.ts:373`): longest flow path from any source; loops ignored; safe on an unchecked body. `pathOf(body, from, to, { loops? })` (`model.ts:404`): the shortest flow path as edge ids. An automatic move takes it; every edge is a crossing and the nodes between are skipped. A `Crossing` (`model.ts:130`) is `{ edge, from, to, at }`.
- Store (`store.ts`): `saveShape` (`:307`; checks the body, refuses with every reason, refuses a body equal to the newest, writes the next number with `parent`, `depths` and `note`, then carries open journeys, all under one advisory lock), `newestShape` (`:282`), `shapeVersionsOf` (`:288`), `shapeContext(db, triggers)` (`:259`; builds the check context from `segments` and `imports`), `diffShapes` (`:354`; nodes and edges added, removed, changed). `Refused` carries the reasons.
- `shape_versions` (`schema.ts:128`): `number` PK, `body`, `depths` (`depthOf`, stored so SQL readers read a column), `note`, `parent`, `created_by`. The `never_edited` trigger holds it (migration `0306_shape`), as `offer_versions` and `terms_versions`.
- `shapeWorkflow(version, body, scope)` (`workflow.ts:51`): pure; one version becomes the workflow `shape.v<n>` (`shapeFlowId`, `parseShapeFlow`, `workflow.ts:34`). Per node `k` that holds journeys: `t_<k>_<i>` (an Advance trigger as written), `m_<k>` (`journey.move`, `with.to`), `s_<k>` (`journey.stage`). A `group` source is `e_<source>` (`trigger.segment`, `entered`, kind `lead`) and a `sourced` source `e_<source>` (`trigger.source`), each wired to the move node of every flow edge it has. A parked source builds nothing. Inputs `in.<k>` and `in.dropped` take manual moves and drops ([[platform/journey]]).
- `shapeWorkflowsOf` (`journeys.ts:98`): the newest version plus any older one that holds open journeys. `soundShapes` (`journeys.ts:129`) drops one that fails `checkWorkflows`, with a log line. The worker passes both as `SpineDeps.shapes` (`apps/worker/src/services.ts:2065`), per workspace DB ([[platform/spine]]).
- `carryJourneys(db, toVersion, moves)` (`carry.ts:29`): an open journey on an older version moves to the new one when its node is in the new body, or is a key of `moves` (old node to new node). Else it stays on its old version: the ghost. The Map draws a removed node that still holds people as a ghost; the journey moves by its old version's edges.
- `editShape` (`edit.ts:77`) with the pure `withNode`, `withEdge`, `withoutNode`, `withoutEdge`, `openOn` (`@wren/pipeline/edit`): the CLI and the console edit through these, one write path.
- File (`shape-file.ts`): `exportShape` (`:52`) writes name, nodes, edges as YAML. `parseShape` (`:61`) reads `{ name, nodes, edges, note?, moves?, terms? }` (an edge needs no `id` or `kind`). `importShape(db, text, { by, triggers, note? })` (`:135`) saves the next version and adds each `terms` entry to its plan unless the plan's newest version has that body; it returns `shape: null` when nothing changed, so a repeat is safe.
- Migration (`migrate.ts`): `shapeFromFunnels` (`:121`) builds v1 from the old funnels (a stage key becomes a node id). `migrateShape(db, { triggers, dry? })` (`:359`) saves v1 when no shape exists and puts every journey and deal with no node on a node; the deepest of two open journeys of one person survives, the other is dropped with reason `one journey per person`. `dry` reads only and is safe before migration 0306. Run it as `wren shape migrate [--dry] [--all]` after `migrate` in the deploy; a repeat is a no-op.
- Numbers (`views.ts`, migration `0306_shape`): views `node_counts` (`:22`), `edge_flow` (`:63`), `source_numbers` (`:93`) over `events` with workflow `shape.v%`. The old `stage_counts`, `stage_flow`, `entry_numbers` stay for one release as views over them. A version carry (cause `version`) is no arrival. `numberRows` (`numbers.ts:320`) builds `pipeline.number` rows of kind `node | edge | offer`.
- Records (`records.ts`): `pipeline.shape` (`:296`; one row `shape`: name, version, nodes, edges, open journeys, why, changed at and by; actions `version` `{ body, note, moves? }`, `diff` `{ a, b }`, `import` `{ text }`).

Citations: `packages/pipeline/src/model.ts:123`, `packages/pipeline/src/model.ts:184`, `packages/pipeline/src/model.ts:373`, `packages/pipeline/src/model.ts:404`, `packages/pipeline/src/store.ts:259`, `packages/pipeline/src/store.ts:307`, `packages/pipeline/src/store.ts:354`, `packages/pipeline/src/schema.ts:128`, `packages/pipeline/src/workflow.ts:51`, `packages/pipeline/src/journeys.ts:98`, `packages/pipeline/src/carry.ts:29`, `packages/pipeline/src/edit.ts:77`, `packages/pipeline/src/shape-file.ts:135`, `packages/pipeline/src/migrate.ts:359`, `packages/pipeline/src/views.ts:22`, `packages/pipeline/src/numbers.ts:320`, `packages/pipeline/src/records.ts:296`, `apps/worker/src/services.ts:2065`, `apps/cli/src/shape.ts:213`

## Connected to

- **owns:** `pipeline.shape_versions`
- **owned-by:** `@wren/pipeline`
- **joins:** [[platform/journey]] (`journeys.shape_version, node`), [[platform/offer]] (`offer` nodes), [[platform/terms]] (`plan` nodes), [[leads/segment]] (`group` sources; a `journey` rule reads node and trail), [[platform/spine]] (one generated workflow per version)
- **looks-like-but-is-not:** the retired ordered funnel (`funnels`, `funnel_versions`; kept only for `migrate.ts` until M3 drops them), the Workflows app (a shape version shows there as `shape.v<n>`, read only), the Pipeline app (Wren's research funnel)

## If you change this

- **Hits:** every open journey (carry or ghost); `checkShape` tests; `shapeWorkflow` and its node ids (a node id is a spine node id, so an arrival keeps its place); the editor's trigger notes for `trigger.journey`; the numbers views and `pipeline.number`; the board and the segment context (`shape`: nodes with depth, sources); the shape file format
- **Does not hit:** sends; the offer and terms rows themselves

## Surfaces

| Surface | Role |
|---|---|
| `wren shape show|versions|diff|export|import|add-node|connect|remove|move|migrate` (`apps/cli/src/shape.ts`), honours `--client` | writes, reads |
| console `PipelineConsole` `shapeVersion|shapeDiff|shapeImport` (`packages/pipeline/src/console.ts`); portal actions `pipeline.shapeVersion|shapeDiff|shapeImport` | writes |
| record `pipeline.shape`, with the agent CLI and portal records | reads |
| Workflows app | a version shows as the workflow `shape.v<n>` (read only) |

## See

- Design: `designs/2026-10-19-business-map.md`; brief `designs/briefs/2026-10-19-business-map-1-model.md`
- Tests: `packages/pipeline/src/model.test.ts`, `packages/pipeline/src/workflow.test.ts`, `packages/pipeline/src/shape-file.test.ts`, `packages/pipeline/src/diff.test.ts`, `packages/pipeline/src/edit.test.ts`, `packages/pipeline/src/migrate.test.ts`, `packages/pipeline/test/integration/edit.test.ts`, `packages/pipeline/test/integration/migrate.test.ts`, `apps/cli/src/shape.test.ts`

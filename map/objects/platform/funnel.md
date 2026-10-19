---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 781f02d7
entity: packages/pipeline/src/model.ts:41
---

# funnel

An ordered list of stages one kind of person walks to a sale. A funnel is a head row (`funnels`) and versions of its body (`funnel_versions`, append only). Built: types, schema, `checkFunnel`, the store, `wren funnels` and the generated spine workflow.

## Why this shape

A stage key is the spine node id, so it never goes, moves or gets renamed: versions only append. The offer never changes across versions; a new offer is a new funnel. Entries say how a journey opens, in priority order. A `funnel` entry makes one funnel feed another by a wire in the later funnel's body.

## Shape

- `FunnelBody` (`model.ts:41`): `name`, `offer`, `stages`, `entries`. `Stage` has `key`, `label`, optional `sale`, `research` (none|light|full), `on` (a list of `Advance`: a trigger id and its `with`). `Entry` has `id`, `kind` (including `sourced` with `source` and `group` with `group`), optional `channel`, `campaign`, `funnel { id, at? }`, `to`. The key `dropped` is reserved (`DROPPED`).
- `checkFunnel(prev, next, ctx)` (`model.ts:89`): pure; returns plain-English errors. Keys valid and unique; one sale stage; known triggers; prefix rule vs `prev`; same offer; entries name real stages and funnels; no feed loop. The caller passes the trigger set, the funnel lookup and the feed graph, so the file imports no spine.
- `funnelWorkflow` (`workflow.ts:48`): pure; one funnel version becomes the workflow `funnel.<id>.v<n>`. Nodes: `t_<stage>_<i>` (an Advance trigger as written), `e_<i>` (a `funnel` entry as `trigger.journey`), `m_<stage>` (`journey.move`, `with.to`), `s_<stage>` (`journey.stage`) and `dropped`. A cause wires to its stage's `m_` node on a port named for its event kind; `m_` feeds `s_` with `moved` (kind `journey`). Inputs `in.<stage>` and `in.dropped`. Both steps are code steps registered by name (`journeySteps`); only `trigger.journey` is a core component (`logic.ts`).
- `funnelWorkflowsOf` (`journeys.ts:100`): the newest version of each funnel plus any older one that holds open journeys. `soundFunnels` (`journeys.ts:139`) drops one that fails `checkWorkflows`, with a log line. The worker passes both as `SpineDeps.funnels`, per workspace DB.
- Store (`packages/pipeline/src/store.ts`): `addFunnel` (head plus version 1), `appendFunnel` (checks the body against the newest version, refuses with every reason, refuses a body equal to the newest), `setFunnelStatus`, `funnelVersionsOf({ funnel?, live?, newest? })`, `funnelContext(db, id, triggers)` (builds `checkFunnel`'s ctx from the newest stored version of each funnel). Each write holds an advisory lock on `funnel:<id>`, so two appends take numbers 2 and 3. The caller passes the trigger ids; the CLI takes the `trigger` group of `LOGIC`. `appendFunnel` only writes the version; `carryJourneys` (`carry.ts`) moves open journeys.
- `funnels` (`schema.ts:86`): `id` slug, `status` live|off (off stops new journeys; open ones still move). `funnel_versions` (`schema.ts:102`): unique `(funnel, number)`, `body` jsonb.
- `never_edited` trigger on `funnel_versions`, `offer_versions`, `terms_versions` (migration `0295_pipeline`), as `books`.

Citations: `packages/pipeline/src/store.ts:331`, `packages/pipeline/src/model.ts:41`, `packages/pipeline/src/model.ts:89`, `packages/pipeline/src/schema.ts:102`, `packages/pipeline/src/workflow.ts:48`, `packages/pipeline/src/journeys.ts:100`, `apps/worker/src/services.ts:2058`

## Connected to

- **owns:** `pipeline.funnels`, `pipeline.funnel_versions`
- **owned-by:** `@wren/pipeline`
- **joins:** [[platform/journey]] (`journeys.funnel, version`), [[platform/offer]] (`FunnelBody.offer`), [[platform/spine]] (one generated workflow per version)
- **looks-like-but-is-not:** `deal_pipelines` in [[platform/deal]], the Pipeline app (Wren's research funnel)

## If you change this

- **Hits:** every open journey on the funnel; `checkFunnel` tests; `funnelWorkflow` and its node ids (a stage key is a node id, so a spine arrival keeps its place); the editor's trigger notes for `trigger.journey`
- **Does not hit:** sends

## Surfaces

| Surface | Role |
|---|---|
| `wren funnels list|add|append|show|off|on` (`apps/cli/src/pipeline.ts`), honours `--client` | writes, reads |
| Workflows app | a funnel version shows as the workflow `funnel.<id>.v<n>` (read only; ids start `funnel.`) |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/model.test.ts`, `packages/pipeline/src/workflow.test.ts`, `packages/pipeline/test/integration/store.test.ts`

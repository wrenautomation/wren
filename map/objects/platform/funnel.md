---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-18 @ 0f4d371b
entity: packages/pipeline/src/model.ts:41
---

# funnel

An ordered list of stages one kind of person walks to a sale. A funnel is a head row (`funnels`) and versions of its body (`funnel_versions`, append only). Built in part: types, schema and `checkFunnel`. The store and the generated spine workflow come in J2 and J3.

## Why this shape

A stage key is the spine node id, so it never goes, moves or gets renamed: versions only append. The offer never changes across versions; a new offer is a new funnel. Entries say how a journey opens, in priority order. A `funnel` entry makes one funnel feed another by a wire in the later funnel's body.

## Shape

- `FunnelBody` (`model.ts:41`): `name`, `offer`, `stages`, `entries`. `Stage` has `key`, `label`, optional `sale`, `on` (a list of `Advance`: a trigger id and its `with`). `Entry` has `id`, `kind`, optional `channel`, `campaign`, `funnel { id, at? }`, `to`.
- `checkFunnel(prev, next, ctx)` (`model.ts:69`): pure; returns plain-English errors. Keys valid and unique; one sale stage; known triggers; prefix rule vs `prev`; same offer; entries name real stages and funnels; no feed loop. The caller passes the trigger set, the funnel lookup and the feed graph, so the file imports no spine.
- `funnels` (`schema.ts:86`): `id` slug, `status` live|off (off stops new journeys). `funnel_versions` (`schema.ts:102`): unique `(funnel, number)`, `body` jsonb.
- `never_edited` trigger on `funnel_versions`, `offer_versions`, `terms_versions` (migration `0294_pipeline`), as `books`.

Citations: `packages/pipeline/src/model.ts:41`, `packages/pipeline/src/model.ts:69`, `packages/pipeline/src/schema.ts:102`

## Connected to

- **owns:** `pipeline.funnels`, `pipeline.funnel_versions`
- **owned-by:** `@wren/pipeline`
- **joins:** [[platform/journey]] (`journeys.funnel, version`), [[platform/offer]] (`FunnelBody.offer`), [[platform/spine]] (J3: one generated workflow per version)
- **looks-like-but-is-not:** `deal_pipelines` in [[platform/deal]], the Pipeline app (Wren's research funnel)

## If you change this

- **Hits:** every open journey on the funnel; `checkFunnel` tests; J3's `funnelWorkflow`
- **Does not hit:** sends

## Surfaces

| Surface | Role |
|---|---|
| none yet | J2 adds `wren funnels` |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/model.test.ts`

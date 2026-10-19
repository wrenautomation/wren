---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-18 @ 0f4d371b
entity: packages/pipeline/src/schema.ts:125
---

# journey

One person in one funnel, at one stage (schema `pipeline`, table `journeys`), with a `deals` row once it reaches the sale stage. Built in part: schema, `nextStage` and `scheduleOf` exist. The store, spine steps and CLI come in J2 to J5.

## Why this shape

The row is a cache. The truth will be spine events with subject `journey:<id>`, so a transition, its event and its person share one workspace DB and one transaction. A funnel version carries open journeys forward with the same stage.

## Shape

- `journeys` (`schema.ts:125`): `profile_id` FK `profiles.id`, `(funnel, version)` FK `funnel_versions`, `stage` (a key), `status` open|done|dropped, `entry` + `entry_ref` (the cause that opened it), `legacy_deal` (fold only).
- Partial unique `uq_journeys_open`: one open journey per `(profile_id, funnel)`. A person holds many funnels at once.
- `deals` (`schema.ts:167`, TS export `pipelineDeals`; `@wren/deals` keeps `deals`): one per journey (`uq_deals_journey`), `terms_version` null until signed terms are known, `collected_cents` a fold of payment events.
- `nextStage(stages, from, to, status)` (`stages.ts:17`): forward only. Returns `{ to, skipped }` or null for same, earlier, unknown stage or a closed journey.
- `scheduleOf(terms, signedAt, until?)` (`schedule.ts:47`): the dated lines a deal implies. No row stores it. See [[platform/terms]].
- Migration `0295_pipeline`. All six `pipeline` tables are audited, area `money` (`packages/db/src/audit/install.ts`).

Citations: `packages/pipeline/src/schema.ts:125`, `packages/pipeline/src/stages.ts:17`, `packages/pipeline/src/schedule.ts:47`

## Connected to

- **owns:** `pipeline.journeys`, `pipeline.deals`
- **owned-by:** `@wren/pipeline`
- **joins:** [[platform/funnel]] (version), `profiles` (FK), [[platform/offer]] and [[platform/terms]] (the deal)
- **looks-like-but-is-not:** [[platform/deal]] (the older board; folds into journeys), [[clients/engagement]] (the delivery of a won deal)

## If you change this

- **Hits:** the partial unique and the FK to `profiles`; `mergeProfiles` will move journeys (J4); the audit area list
- **Does not hit:** the spine yet (J3 adds the workflows)

## Surfaces

| Surface | Role |
|---|---|
| none yet | J5 adds records and CLI |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/stages.test.ts`, `packages/pipeline/test/integration/schema.test.ts`

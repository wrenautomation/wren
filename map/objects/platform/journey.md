---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 781f02d7
entity: packages/pipeline/src/schema.ts:125
---

# journey

One person in one funnel, at one stage (schema `pipeline`, table `journeys`), with a `deals` row once it reaches the sale stage. Built in part: schema, `nextStage`, `scheduleOf`, the spine steps and the version carry. The store and CLI come in J2, the Journeys service in J5.

## Why this shape

The row is a cache. The truth is spine events with subject `journey:<id>`, so a transition, its event and its person share one workspace DB and one transaction. A funnel version carries open journeys forward with the same stage.

## Shape

- `journeys` (`schema.ts:125`): `profile_id` FK `profiles.id`, `(funnel, version)` FK `funnel_versions`, `stage` (a key), `status` open|done|dropped, `entry` + `entry_ref` (the cause that opened it), `legacy_deal` (fold only).
- Partial unique `uq_journeys_open`: one open journey per `(profile_id, funnel)`. A person holds many funnels at once.
- `deals` (`schema.ts:167`, TS export `pipelineDeals`; `@wren/deals` keeps `deals`): one per journey (`uq_deals_journey`), `terms_version` null until signed terms are known, `collected_cents` a fold of payment events.
- `nextStage(stages, from, to, status)` (`stages.ts:17`): forward only. Returns `{ to, skipped }` or null for same, earlier, unknown stage or a closed journey.
- `scheduleOf(terms, signedAt, until?)` (`schedule.ts:47`): the dated lines a deal implies. No row stores it. See [[platform/terms]].
- `journey.move` (`steps.ts:98`, `journeySteps`): a cause event reaches `m_<stage>`. It finds the person (`personOf`, `journeys.ts:45`), opens a journey only at an entry stage (`entryOf`, `entry.ts:60`) on the newest live version, then `nextStage` guards. One `atomic` transaction with `FOR UPDATE` on the row. Emits `moved` with subject `journey:<id>` and `{journey, profile, funnel, version, from, to, skipped, cause}`.
- `journey.stage` (`steps.ts:186`): the arrival at `s_<stage>`. Writes a `profile_events` row (kind `journey`), makes the `deals` row at the sale stage (newest `offer_versions` number; none, no deal and a warning), sets `done` at the last stage, and fires `trigger.journey` (`entered`, one `skipped` per skipped stage). At `dropped` it writes the drop line and fires `dropped`. The fires go through `StepAt.fire`, sent after the step result is kept ([[platform/spine]]).
- `dropJourney` (`journeys.ts:165`): set `dropped`, return the event for `in.dropped` of the newest version. J5's service calls it and emits.
- `carryJourneys` (`carry.ts:21`): open journeys of an older version move to the new one at the same stage, with an arrival at `funnel.<id>.v<to>` node `s_<stage>` and cause `{kind: "version", ref: <old>}`. J2's `appendFunnel` will call it.
- `spine_executions` titles a `journey:<uuid>` subject "Name: funnel, stage" (migration `0297_journey_event_kind`, with `ck_events_kind`).
- Migration `0295_pipeline`. All six `pipeline` tables are audited, area `money` (`packages/db/src/audit/install.ts`).

Citations: `packages/pipeline/src/schema.ts:125`, `packages/pipeline/src/stages.ts:17`, `packages/pipeline/src/schedule.ts:47`, `packages/pipeline/src/steps.ts:98`, `packages/pipeline/src/steps.ts:186`, `packages/pipeline/src/journeys.ts:165`, `packages/pipeline/src/carry.ts:21`

## Connected to

- **owns:** `pipeline.journeys`, `pipeline.deals`
- **owned-by:** `@wren/pipeline`
- **joins:** [[platform/funnel]] (version), [[platform/spine]] (steps, subject `journey:<id>`), `profiles` (FK), [[platform/offer]] and [[platform/terms]] (the deal)
- **looks-like-but-is-not:** [[platform/deal]] (the older board; folds into journeys), [[clients/engagement]] (the delivery of a won deal)

## If you change this

- **Hits:** the partial unique and the FK to `profiles`; the two steps and `carryJourneys` lock the row `FOR UPDATE`; `mergeProfiles` will move journeys (J4); the audit area list; the `journey:` branch of `spine_executions`
- **Does not hit:** sends

## Surfaces

| Surface | Role |
|---|---|
| none yet | J5 adds records and CLI |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/stages.test.ts`, `packages/pipeline/src/entry.test.ts`, `packages/pipeline/test/integration/schema.test.ts`, `packages/pipeline/test/integration/journeys.test.ts`

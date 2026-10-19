---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ a6004537
entity: packages/pipeline/src/schema.ts:125
---

# journey

One person in one funnel, at one stage (schema `pipeline`, table `journeys`), with a `deals` row once it reaches the sale stage. Built in part: schema, `nextStage`, `scheduleOf`, the spine steps and the version carry. The store and CLI are J2. J5 adds the Journeys service, the records, the console and the numbers.

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
- `dropJourney` (`journeys.ts:165`): set `dropped`, return the event for `in.dropped` of the newest version. The `Journeys` service calls it and emits.
- `Journeys` service (`restate.ts`, bound in `apps/worker/src/services.ts`): `open`, `move`, `drop`, `rebuild`; `client` null is Wren's workspace. `openEmit` and `moveEmit` (`moves.ts`) build a spine event with cause `manual` (operator in `cause.ref`) for `in.<stage>` of the funnel workflow; the funnel's own `journey.move` step writes the row, so there is no second write path. A manual open uses subject `manual:<uuid>`, so a repeat after a drop is a new arrival. `rebuildJourney` recomputes version, stage and status from the `journey:<id>` arrivals. `idOf` refuses a bad id before the database does.
- Records (`records.ts`): `pipeline.journey` (open, mine, stale, done, dropped, all), `pipeline.deal` (open, won, lost, all; schedule from `scheduleOf`). `mine` is the operator of the newest manual-cause arrival: journeys hold no owner column. Stale is 14 days in a stage.
- Numbers (`views.ts`, migration `0300_pipeline_numbers`): views `stage_counts`, `stage_flow`, `entry_numbers` over `events` with workflow `funnel.%`; `numbers.ts` reads them and builds the `pipeline.number` rows. A version carry (cause `version`) is no entry.
- Stage research (`research.ts`, `requestResearch`): `journey.stage` on a non-dropped arrival at a stage whose `with.research` is `light` or `full` claims one `journey_research` row per `(journey, stage)` (`schema.ts:220`) and asks once, against the newest `offer_versions.body.icp` of `FunnelBody.offer` (`icpOf`; context only, nothing scores fit). `light`: the injected `Researcher.light` reads the workspace's own rows in the claim's transaction (role, firm, address verdicts) into `result`; state `read`. `full`: state `queued`, then `Researcher.full` queues and sends the person-research run without waiting; state `started` with `lookup_id`, or `skipped` with a note. A start that fails leaves `queued`, and the next repeat of the step starts it. A repeat that finds the row asks nothing. The ask never stops the arrival: a throw is logged. The worker's `journeyResearcher` (`apps/worker/src/journey-research.ts`) wires `readProfileFacts` + `latest_verifications` for `light` and `queueProfileResearch` + `ProfileResearch/<profile>/run` for `full`; a client workspace's `full` is skipped (person research is Wren's own People only). One `profile_events` line (kind `journey`) per ask.
- `sourced` cause: kind `sourced`, ref the list id, `entry_ref` carries `source` and `row` (the `people.id`). `sourcedPass` (`sourced.ts`) is the tail: for each list a live funnel's newest version names, it reads the `people` rows of that import batch past a cursor, maps each to its profile by the `person` key, and returns `trigger.source` fires. The worker's `SourcedFeed/all` loop (`apps/worker/src/sourced-feed.ts`) keeps the cursors per workspace and list and sends the fires with `spineFire`. Members without a profile are skipped and counted.
- `carryJourneys` (`carry.ts:21`): open journeys of an older version move to the new one at the same stage, with an arrival at `funnel.<id>.v<to>` node `s_<stage>` and cause `{kind: "version", ref: <old>}`. J2's `appendFunnel` will call it.
- `spine_executions` titles a `journey:<uuid>` subject "Name: funnel, stage" (migration `0297_journey_event_kind`, with `ck_events_kind`).
- `journey_research` (migration `0299_journey_research`): not audited; a cache of what was asked.
- Migration `0295_pipeline`. The six first `pipeline` tables are audited, area `money` (`packages/db/src/audit/install.ts`).

- Causes (J4). A touch moves a journey through `trigger.touch` (the `TouchFeed` loop). Payments reach `pipeline.collect` (`packages/pipeline/src/collect.ts`, in workflow `pipeline.money`, heard in every workspace): paid adds, refunded subtracts `deals.collected_cents` (floor 0) for the deal named in `data.deal`, else the person's newest open deal (for `data.offer` when given). Once per payment change: a `profile_events` line (source `collected`, id the subject's hash) is the claim, in the same transaction.
- Merge (`mergeProfiles`, `packages/core/src/profile-pipeline.ts`): `journeys.profile_id` and `deals.profile_id` move to the kept profile. Two open journeys in one funnel: the later stage stays open, the other is `dropped` with reason `merged`. No `journey` event is sent for that drop.

Citations: `packages/pipeline/src/restate.ts:81`, `packages/pipeline/src/moves.ts:64`, `packages/pipeline/src/views.ts:16`, `packages/pipeline/src/schema.ts:125`, `packages/pipeline/src/stages.ts:17`, `packages/pipeline/src/schedule.ts:47`, `packages/pipeline/src/steps.ts:98`, `packages/pipeline/src/steps.ts:186`, `packages/pipeline/src/journeys.ts:165`, `packages/pipeline/src/carry.ts:21`, `packages/pipeline/src/schema.ts:220`, `packages/pipeline/src/research.ts:74`, `packages/pipeline/src/sourced.ts:46`, `apps/worker/src/sourced-feed.ts:38`, `apps/worker/src/journey-research.ts:21`

## Connected to

- **owns:** `pipeline.journeys`, `pipeline.deals`, `pipeline.journey_research`
- **owned-by:** `@wren/pipeline`
- **joins:** [[leads/segment]] (a `journey` rule reads this table; a stage or status change wakes the segments pass, migration 0298), [[platform/funnel]] (version), [[platform/spine]] (steps, subject `journey:<id>`), [[leads/profile]] (research findings, the `full` run), [[leads/person]] (a sourced list is an import batch of people), `profiles` (FK), [[platform/offer]] and [[platform/terms]] (the deal)
- **looks-like-but-is-not:** [[platform/deal]] (the older board; folds into journeys), [[clients/engagement]] (the delivery of a won deal)

## If you change this

- **Hits:** the partial unique and the FK to `profiles`; the two steps and `carryJourneys` lock the row `FOR UPDATE`; `mergeProfiles` will move journeys (J4); the audit area list; the `journey:` branch of `spine_executions`
- **Does not hit:** sends

## Surfaces

| Surface | Role |
|---|---|
| `wren journeys open|move|drop|show|list|rebuild`, `wren deals list|sign|schedule` (`apps/cli/src/pipeline.ts`); writes go to `Journeys` over ingress | writes, reads |
| console `PipelineConsole` (`packages/pipeline/src/console.ts`): `journeysOpen`, `journeysMove`, `journeysDrop`, `dealsSign` | writes |
| records `pipeline.journey`, `pipeline.deal`, `pipeline.number` (agent CLI and portal records) | reads |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/stages.test.ts`, `packages/pipeline/src/entry.test.ts`, `packages/pipeline/test/integration/schema.test.ts`, `packages/pipeline/test/integration/journeys.test.ts`, `packages/pipeline/test/integration/moves.test.ts`, `packages/pipeline/test/integration/console.test.ts`, `packages/pipeline/test/integration/sourced-research.test.ts`, `packages/pipeline/src/sourced.test.ts`

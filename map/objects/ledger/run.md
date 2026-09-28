---
type: object
cluster: ledger
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/runs.ts:21
---

# run

One recorded execution of a stage: a CLI command or one pass of a loop object. Table `runs`; opened by `openRun`, closed by `finishRun`, wrapped by `recordedRun`.

## Why this shape

Every paid or long step leaves a row before it starts and its stats when it ends, so "what ran, when, on what niche, at what cost" is a query. Rows in other tables carry `run_id` back to it (enrollments, messages, thread_events, enrichments, reports, postmaster_days, open_events, sms_messages).

## Shape

- `id` (uuid), `command`, `argv`, `niche`, `model`, `started_at`, `finished_at`, `stats` (`packages/core/src/schema.ts:37`–`44`)

Citations: `packages/core/src/runs.ts:21`, `:36`, `:49`

## Connected to

- **owns:** the `run_id` on [[email/enrollment]], [[email/message]], [[email/thread-event]], [[research/enrichment]], [[email/report]], [[sms/sms-message]]
- **joins:** [[platform/loop-object]] (each pass opens one)
- **looks-like-but-is-not:** a Restate invocation id; an `llm` JSON column on a stage row

## If you change this

- **Hits:** `packages/core/src/runs.ts`; the loop primitive that opens a run per pass (`packages/core/src/restate/loop.ts:150`); the cost views `email_llm_calls` and `email_stage_costs` (`packages/channel-email/src/views.ts:15`, `:40`)

## Surfaces

| Surface | Role |
|---|---|
| every loop object, every CLI stage | writes |
| `walkthrough/demos/01-loops.sh`, cost views | read |

## See

- Source: `packages/core/src/runs.ts`

---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:476
---

# report

The Friday report: the week's numbers as a stored row, then mailed. Table `reports`.

## Why this shape

No LLM: every line is a query the operator can re-run, so a report is never wrong in a way the rows are not (`report/weekly.ts:1`). Stored before mailed, so a lost mail is a re-send, not a re-compute.

## Shape

- `kind` (weekly), `period_start`, `period_end`, `stats`, `body`, `sent_to`, `run_id` (`schema.ts:478`–`486`)
- `runWeeklyReport`, `previousWeekly` (`report/send.ts:47`, `:35`)

Citations: `packages/channel-email/src/schema.ts:476`

## Connected to

- **reads:** [[email/message]], [[email/thread-event]], [[email/postmaster-day]] through the views
- **joins:** [[email/transport]] (mails it)

## If you change this

- **Hits:** `report/weekly.ts`, `report/send.ts:52`, `ReportScheduler`, `wren report weekly`
- **Does not hit:** the digest (a different, daily surface: `restate/digest-scheduler.ts`)

## Surfaces

| Surface | Role |
|---|---|
| `ReportScheduler/fleet` (when `WREN_REPORT_TO` set) | writes |
| `wren report weekly` | writes |

## See

- Source: `packages/channel-email/src/report/weekly.ts`

---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/starling/channels/email/src/schema.ts:476
---

# report

The Friday report's rows: table `reports`. The writer (`wren report weekly`, ReportScheduler) was
cut 11-04 (WA-1067); the 14 rows stay until the lake. Tag `pre-cut-2026-11-04` holds the code.

## Shape

- `kind` (weekly), `period_start`, `period_end`, `stats`, `body`, `sent_to`, `run_id` (`schema.ts:478`–`486`)

Citations: `packages/starling/channels/email/src/schema.ts:476`

## Connected to

- **reads:** nothing now
- **joins:** [[ledger/run]] (`run_id`)

## If you change this

- **Hits:** the table only
- **Does not hit:** the digest (a different, daily surface: `restate/digest-scheduler.ts`)

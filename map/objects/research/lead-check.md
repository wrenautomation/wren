---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-03 @ 32ccf4b
entity: packages/channel-email/src/schema.ts:664
---

# lead check

Is this the right person at the right address: one result per lead and check. Table `lead_checks`; the checks are pure functions in `packages/channel-email/src/verification/checks.ts`.

## Why this shape

A verdict (see [[research/verification]]) says the mailbox exists, not that it is the person we think. Six checks read only rows we already hold, so they are free: `recheckLeads` recomputes a firm's leads whole and a rerun replaces them (`packages/channel-email/src/verification/lead-checks.ts:58`). A role mailbox has no `mailbox_fits_name` row; that is the skip. `title_agrees` and `phone_agrees` are info only. The column is `kind`, not `check`: CHECK is reserved in SQL.

## Shape

- `lead_id`, `kind` (`LEAD_CHECK_KINDS`, `packages/channel-email/src/schema.ts:647`), `result` (pass | fail | unknown), `evidence`, `checked_at`; primary key (lead_id, kind); cascades with the lead
- `mailbox_fits_name` fail names the colleague it fits (`evidence.fits_person_id`); `works_there` fails on `job_change` or `left` at 0.8 or more, the same rule compose uses (`checks.ts:229`)

Citations: `packages/channel-email/src/schema.ts:664`, `packages/channel-email/src/verification/checks.ts:229`

## Connected to

- **owned-by:** [[leads/lead]]
- **joins:** `lead_sheet` columns `checks` and `verified` (`packages/channel-email/src/views.ts:357`); [[leads/person]] through the lead's newest candidate; the newest lookup finding and the firm's page finding
- **looks-like-but-is-not:** [[research/verification]] (does the mailbox exist)

## If you change this

- **Hits:** compose's `sendable` skips a lead whose `mailbox_fits_name` or `works_there` fails (`packages/channel-email/src/outreach/provenance.ts:217`); the profiles stage's recheck ([[processes/pool-feed]]); `lead_sheet`
- **Does not hit:** `leads.status`; verification

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.profiles`, `wren enrich profiles` | write, per firm after each person |
| `wren enrich checks --niche <n>` | writes, backfill (`apps/cli/src/enrich.ts:207`) |
| `wren email sheet` | reads through `lead_sheet` |
| compose | reads (skips the wrong person) |

## See

- Source: `packages/channel-email/src/verification/lead-checks.ts`

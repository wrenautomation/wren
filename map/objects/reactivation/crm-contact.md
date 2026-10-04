---
type: object
cluster: reactivation
universe: live
status: verified
verified: 2026-10-03 @ fc9fe66
entity: packages/reactivation/src/schema.ts:29
---

# crm-contact

One contact from a client's ATS export, in the client's database: `crm_contacts`, linked to a [[leads/person]] and [[leads/company]].

## Why this shape

The export is the client's truth; people and companies are ours. Keeping the CRM row apart means a re-import updates what the ATS says without losing what research found, and every source row is kept, parseable or not (`import_errors`).

## Shape

- `crm_contacts` (`schema.ts:29`), `contact_scores` (`:94`), `mover_addresses` (`:130`), `briefs` (`:184`)
- `contact_scores.next_step` (`:86`): `reach_out` (a signal: a move with a firm, or open roles), `keep_warm` (no signal: the portal's Keep warm), `none` (left). Compose writes only to `reach_out`. Reasons are recruiter words ("Moved to Beta Labs 4 months ago"), signal first (`score.ts:113`).
- `mover_addresses`: one row per move tried, `found|no_domain|catch_all|not_found`; `found` links the verified `contact_candidates` row at the new firm, the only address compose uses for a mover (`movers.ts:88`). A found address adds the new firm to `companies` by domain; the mover's enrollment is filed under it.
- Formats: `packages/reactivation/src/crm/formats.ts`; import `crm/import.ts:23`; health gate `crm/health.ts`

Citations: `packages/reactivation/src/schema.ts:29`, `packages/reactivation/src/movers.ts:88`, `packages/reactivation/src/crm/import.ts:23`

## Connected to

- **owned-by:** [[clients/client]] (its database)
- **joins:** [[leads/person]], [[leads/company]], [[email/enrollment]] (compose)

## If you change this

- **Hits:** `crm import|verify|health|run`, movers, scoring, briefs, compose, the portal's ranked list and Keep warm, the `reactivation_people` record view ([[platform/records]]; a column change needs a migration)
- **Does not hit:** Wren's own leads (main database)

## Surfaces

| Surface | Role |
|---|---|
| `wren --client <id> crm import` | writes |
| `Reactivation/{client}`, portal | reads |

## See

- Source: `packages/reactivation/src/crm/`

---
type: object
cluster: reactivation
universe: live
status: verified
verified: 2026-09-29 @ 23a6170
entity: packages/reactivation/src/schema.ts:28
---

# crm-contact

One contact from a client's ATS export, in the client's database: `crm_contacts`, linked to a [[leads/person]] and [[leads/company]].

## Why this shape

The export is the client's truth; people and companies are ours. Keeping the CRM row apart means a re-import updates what the ATS says without losing what research found, and every source row is kept, parseable or not (`import_errors`).

## Shape

- `crm_contacts` (`schema.ts:28`), `contact_scores` (`:82`), `briefs` (`:117`)
- Formats: `packages/reactivation/src/crm/formats.ts`; import `crm/import.ts:23`; health gate `crm/health.ts`

Citations: `packages/reactivation/src/schema.ts:28`, `packages/reactivation/src/crm/import.ts:23`

## Connected to

- **owned-by:** [[clients/client]] (its database)
- **joins:** [[leads/person]], [[leads/company]], [[email/enrollment]] (compose)

## If you change this

- **Hits:** `crm import|verify|health|run`, scoring, briefs, the portal's ranked list
- **Does not hit:** Wren's own leads (main database)

## Surfaces

| Surface | Role |
|---|---|
| `wren --client <id> crm import` | writes |
| `Reactivation/{client}`, portal | reads |

## See

- Source: `packages/reactivation/src/crm/`

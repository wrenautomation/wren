---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/schema.ts:175
---

# sighting

One source row seen once: where a company, lead or person appeared in an import. Table `sightings`.

## Why this shape

Re-importing a file must not rewrite facts, but it must still be visible that the row was seen again. A sighting is the append-only trace; `companies.raw` and `leads.raw` hold the latest shape.

## Shape

- `company_id`, `lead_id`, `person_id` (any may be null), `import_id`, `row_number`, `raw`, `seen_at` (`packages/core/src/schema.ts:178`–`185`)

Citations: `packages/core/src/schema.ts:175`

## Connected to

- **owned-by:** [[ledger/import]]
- **joins:** [[leads/company]], [[leads/lead]], [[leads/person]]

## If you change this

- **Hits:** both importers (`packages/core/src/ingest/importer.ts:262`, `:333`; `packages/core/src/people/importer.ts:234`); discovery, which records its own sightings (`packages/research/src/discovery/service.ts:251`, `:392`)
- **Does not hit:** any channel; nothing sends from a sighting

## Surfaces

| Surface | Role |
|---|---|
| importers, `Discovery`, the `adLibrary` pool stage (one sighting per ad after a firm's first) | write |
| nobody in prod | reads (audit only) |

## See

- Source: `packages/core/src/schema.ts`

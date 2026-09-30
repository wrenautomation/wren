---
type: object
cluster: ledger
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/schema.ts:49
---

# import

One source file (or discovery batch) taken into the database, with its per-row rejections. Tables `imports` and `import_errors`.

## Why this shape

`content_hash` makes a re-import of the same file a no-op, `as_of` dates the source, and `superseded_by` chains a newer file over an older one. Rejections are rows, not logs, because a domain conflict is a fact about the data (`IMPORT_ERROR_KINDS`, `packages/core/src/schema.ts:23`).

## Shape

- `imports`: `source_type`, `source_ref`, `stats`, `content_hash`, `as_of`, `superseded_by`, `defaults` (`:85`–`93`)
- `import_errors`: `import_id`, `row_number`, `kind`, `reason`, `raw`, `company_id`, `claimant_company_id` (`:108`–`115`)

Citations: `packages/core/src/schema.ts:49`, `:72`

## Connected to

- **owns:** [[leads/company]], [[leads/lead]], [[leads/person]], [[leads/sighting]] (all carry `import_id`)
- **joins:** [[platform/niche]] source formats (`LEAD_SOURCE_FORMATS`, `PERSON_SOURCE_FORMATS`, `packages/niches/src/index.ts:100`, `:104`)

## If you change this

- **Hits:** `packages/core/src/ingest/importer.ts:146`, `packages/core/src/people/importer.ts:67`; discovery, which opens an import per batch (`packages/research/src/discovery/service.ts:106`)
- **Does not hit:** `runs` (a CLI import is also a run, but the two rows are independent)

## Surfaces

| Surface | Role |
|---|---|
| `wren email import`, `import-people`, `wren fetch` then import | write |
| `Discovery.discover` | writes |

## See

- Source: `packages/core/src/ingest/importer.ts`

---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[platform/niche]]"]
produces: ["[[ledger/import]]", "[[leads/company]]", "[[leads/person]]", "[[leads/lead]]", "[[leads/sighting]]"]
---

# import

A source file becomes rows, and every row it could not take becomes a row too.

## Input → Movement → Output

A file under `<data>/<niche>/` (fetched by `wren fetch` or saved by hand) and a niche source format. The importer hashes the file, opens an `imports` row, walks rows through the format's `build`, upserts companies by domain, inserts leads or people, and records a sighting per row. Rejections and domain conflicts land in `import_errors`.

## Why this shape

Identity constraints must never decide what gets stored: a clash is recorded as a conflict, never resolved by dropping a row. A re-import of the same bytes is a no-op by `content_hash`.

## Steps

1. Pick the format: `LEAD_SOURCE_FORMATS` / `PERSON_SOURCE_FORMATS` (`packages/niches/src/index.ts:100`, `:104`).
2. Open the import (`packages/core/src/ingest/importer.ts:144`; people: `packages/core/src/people/importer.ts:67`).
3. Upsert the company (`ingest/importer.ts:233`, `:254`; domain conflict → `:267`, `:270`).
4. Insert the lead (`ingest/importer.ts:378`) or person (`people/importer.ts:195`); sighting (`:260`, `:333`; `people/importer.ts:234`).
5. Discovery batches open their own import (`packages/research/src/discovery/service.ts:106`).

## If you change this

- **Hits:** [[ledger/import]], [[leads/company]], [[leads/lead]], [[leads/person]]; the niche's format files
- **Does not hit:** verification, compose (they select by status later)

## Surfaces

| Surface | Role |
|---|---|
| `wren email import` / `import-people` / `wren fetch` | runs |
| `Discovery.discover` | runs the batch form |

## See

- Objects: [[ledger/import]], [[leads/company]]
- Source: `packages/core/src/ingest/importer.ts`

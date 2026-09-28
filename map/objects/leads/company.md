---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/schema.ts:106
---

# company

A business we might reach. Table `companies`, one row per business; in prose a "lead" usually means one of these, while the `leads` table is an address.

## Why this shape

The company is the unit of outreach: one active email enrollment per company (`packages/channel-email/src/schema.ts:199`), one SMS thread per company (`packages/channel-sms/src/enroll.ts:1`). Identity is the domain, but a row is never dropped to keep a key clean: `raw` keeps the source row, and a domain clash lands in `import_errors` instead of overwriting (`packages/core/src/ingest/importer.ts:267`).

## Shape

- `id`, `domain`, `name`, `import_id`, `raw`, `source_key`, `social_url`, `country`, `domain_verified_at`, `niche`, `timezone` (`packages/core/src/schema.ts:109`–`120`)
- `timezone` is filled per niche from location text, never guessed (`packages/channel-email/src/send/lead-timezone.ts:110`)
- `domain` and `domain_verified_at` are set by discovery when a guessed host proves out (`packages/research/src/discovery/service.ts:247`)

Citations: `packages/core/src/schema.ts:106`

## Connected to

- **owns:** [[leads/person]], [[leads/lead]], [[leads/sighting]], [[research/document]], [[research/enrichment]], [[research/discovery-attempt]], [[email/enrollment]], [[sms/sms-contact]]
- **owned-by:** [[ledger/import]] (`import_id`)
- **joins:** the facts views `person_facts`, `agency_facts`, `firm_facts` (`packages/core/src/views.ts:14`, `:38`, `:57`); [[platform/niche]] via `niche`
- **looks-like-but-is-not:** [[leads/lead]] (an address), a Meta ad account

## If you change this

- **Hits:** `packages/core/src/views.ts` and every niche facts view; both importers (`packages/core/src/ingest/importer.ts:233`, `packages/core/src/people/importer.ts:136`); discovery (`packages/research/src/discovery/service.ts:247`, `:388`); the send walk's per-company clock (`packages/channel-email/src/send/deliver.ts:377`); `Niche.companyLocation` (`packages/niches/src/niche.ts:23`)
- **Does not hit:** stored `messages` (facts are pinned at compose, never re-read); `.email` templates

## Surfaces

| Surface | Role |
|---|---|
| `wren email import` / `import-people` (CLI) | writes |
| `Discovery` service | writes domain fields |
| `ComposeScheduler`, `SendScheduler` | read |
| facts views | read |

## See

- Source: `packages/core/src/schema.ts`

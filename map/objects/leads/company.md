---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-03 @ 9e6430a
entity: packages/core/src/schema.ts:157
---

# company

A business we might reach. Table `companies`, one row per business; in prose a "lead" usually means one of these, while the `leads` table is an address.

## Why this shape

The company is the unit of outreach: one active email enrollment per company (`packages/channel-email/src/schema.ts:201`), one SMS thread per company (`packages/channel-sms/src/enroll.ts:1`). Identity is the domain, but a row is never dropped to keep a key clean: `raw` keeps the source row, and a domain clash lands in `import_errors` instead of overwriting (`packages/core/src/ingest/importer.ts:269`).

## Shape

- `id`, `domain`, `name`, `import_id`, `raw`, `source_key`, `social_url`, `linkedin_url`, `country`, `domain_verified_at`, `niche`, `timezone` (`packages/core/src/schema.ts:160`–`173`)
- `decline_reason`: why the firm is no buyer (platform_site, chain, public_body, foreign, or the niche's rule); NULL = in play. Set by `runScreen` (`packages/core/src/ingest/screen.ts`); every stage filters with `inPlay`
- `timezone` is filled per niche from location text, never guessed (`packages/channel-email/src/send/lead-timezone.ts:110`)
- `linkedin_url`: the firm's LinkedIn page, canonical, written only by a company lookup whose cached page names a website on the firm's registrable domain (`packages/research/src/companies/profile.ts:307`, `:118`)
- `domain` and `domain_verified_at` are set by discovery when a guessed host proves out (`packages/research/src/discovery/service.ts:247`)
- `ix_companies_unassigned` (partial, `niche IS NULL`) serves the enrich selectors, which anti-join with `NOT EXISTS`

Citations: `packages/core/src/schema.ts:157`

## Connected to

- **owns:** [[leads/person]], [[leads/lead]], [[leads/sighting]], [[research/document]], [[research/enrichment]], [[research/discovery-attempt]], [[email/enrollment]], [[sms/sms-contact]]
- **owned-by:** [[ledger/import]] (`import_id`)
- **joins:** the facts views `person_facts`, `agency_facts`, `firm_facts` (`packages/core/src/views.ts:14`, `:38`, `:57`); [[platform/niche]] via `niche`
- **looks-like-but-is-not:** [[leads/lead]] (an address), a Meta ad account

## If you change this

- **Hits:** `packages/core/src/views.ts` and every niche facts view; both importers (`packages/core/src/ingest/importer.ts:235`, `packages/core/src/people/importer.ts:136`); discovery (`packages/research/src/discovery/service.ts:247`, `:388`); the send walk's per-company clock (`packages/channel-email/src/send/deliver.ts:377`); `Niche.companyLocation` (`packages/niches/src/niche.ts:26`)
- **Does not hit:** stored `messages` (facts are pinned at compose, never re-read); `.email` templates

## Surfaces

| Surface | Role |
|---|---|
| `wren email import` / `import-people` (CLI) | writes |
| `wren email screen` | writes `decline_reason`, `country` |
| `Discovery` service | writes domain fields |
| `wren enrich profiles`, the `profiles` pool stage | writes `linkedin_url` |
| `ComposeScheduler`, `SendScheduler` | read |
| facts views | read |

## See

- Source: `packages/core/src/schema.ts`

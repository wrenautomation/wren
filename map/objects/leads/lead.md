---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/schema.ts:219
---

# lead

One email address we might send to, with a status. Table `leads`. Not a company: in prose "lead" means the company, in code it is this row.

## Why this shape

Status is the funnel: `imported → verified | undeliverable`, and `suppressed` (`LEAD_STATUSES`, `packages/core/src/schema.ts:27`; transitions `packages/core/src/state.ts:43`). Only an authoritative verdict moves it (`packages/channel-email/src/verification/service.ts:65`), so compose can trust `verified` without re-checking.

## Shape

- `email`, names, `title`, `persona`, `source`, `geo`, `status`, `raw`, `company_id`, `import_id`, `country`, `suppression_id`, `social_url` (`packages/core/src/schema.ts:222`–`237`)
- check on status (`:290`)

Citations: `packages/core/src/schema.ts:219`

## Connected to

- **owned-by:** [[leads/company]], [[ledger/import]]
- **owns:** [[research/verification]] (`lead_id`)
- **joins:** [[research/contact-candidate]] (`lead_id` once promoted), [[leads/suppression]] (`suppression_id`)
- **looks-like-but-is-not:** [[research/contact-candidate]] (a guess, not yet a lead); `Ads.leads` (Meta form fills)

## If you change this

- **Hits:** the lead importer (`packages/core/src/ingest/importer.ts:378`); verification (`packages/channel-email/src/verification/service.ts:124`); resolution's promotion (`packages/channel-email/src/resolution/service.ts:739`); `LEAD_TRANSITIONS` (`packages/core/src/state.ts:43`); `verification_yield` view (`packages/channel-email/src/views.ts:102`)
- **Does not hit:** `enrollments` (they carry their own `to_email`); SMS

## Surfaces

| Surface | Role |
|---|---|
| `wren email import` | writes |
| `Discovery.verify`, `Resolution.verifyLeads` | move status |
| `PoolScheduler` | drives the above |
| compose | reads `verified` |

## See

- Source: `packages/core/src/schema.ts`

---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/core/src/schema.ts:135
---

# person

A named human at a company. Table `people`; the facts row an email is written to (`person_facts`).

## Why this shape

People come from five origins (`PERSON_ORIGINS`, `packages/core/src/schema.ts:25`) and the origin is kept with its reference, so a title read off a website is never confused with one from a registry. `is_testimonial` marks people who are quoted, not reached (`packages/research/src/enrichment/testimonials.ts`).

## Shape

- `company_id` (not null), `full_name`, `first_name`, `last_name`, `title`, `is_compliance`, `origin`, `origin_ref`, `as_of`, `linkedin_url`, `import_id`, `raw`, `is_testimonial`, `testimonial_org` (`packages/core/src/schema.ts:138`–`155`)
- one index on `company_id` (`:192`)

Citations: `packages/core/src/schema.ts:135`

## Connected to

- **owned-by:** [[leads/company]]
- **owns:** [[research/contact-candidate]] (`person_id`), [[email/enrollment]] when `kind = person`
- **joins:** `person_facts` (`packages/core/src/views.ts:14`), [[leads/sighting]]
- **looks-like-but-is-not:** [[leads/lead]] (an address may have no person)

## If you change this

- **Hits:** `packages/core/src/views.ts:14`; the people importer (`packages/core/src/people/importer.ts:195`); extraction apply (`packages/research/src/enrichment/store.ts`); fact assembly (`packages/channel-email/src/outreach/facts.ts`); candidate minting (`packages/channel-email/src/resolution/service.ts:155`)
- **Does not hit:** `leads` columns; SMS contacts (they key on the phone, `person_id` is optional)

## Surfaces

| Surface | Role |
|---|---|
| `wren email import-people` | writes |
| `Enrichment.applyExtractions` | writes |
| `Resolution.build` | reads |
| compose (via `person_facts`) | reads |

## See

- Source: `packages/core/src/schema.ts`

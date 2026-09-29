---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/niches/src/niche.ts:23
---

# niche

One market with its own facts view, templates, sequences, plan, offers, SMS copy and source formats: `Niche`, built by `defineNiche`. Three registered: `sec_ria`, `agencies`, `recruiting`.

## Why this shape

Core is niche-agnostic; everything market-specific is data behind one contract, and `NICHES` plus the derived registries are the only place a niche name meets code (`index.ts:24`, `:63`–`:104`). Compose, the queue-keeper and the pool feeder take a `Campaign` built from a niche; they never import the registry. A held niche (`sec_ria`: verify only, never compose or send) is a rule on the person, not in the code.

## Shape

- `Niche` (`niche.ts:23`): `name`, `factsView`, `lander`, `crawlHints`, `discoveryGenericWords`, `templates`, `sequences`, `smsSequences`, `offers`, `offerFacts`, `plan`, `companyLocation`, `leadSourceFormats`, `personSourceFormats`, `platformDomains`, `datasets`
- `NicheSpec` (`:62`), `defineNiche` (`:104`); definitions `sec-ria.ts`, `agencies.ts`, `recruiting.ts`; templates `packages/niches/templates/<niche>/`
- registries: `NICHES`, `FACTS_VIEWS`, `LANDERS_BY_NICHE`, `SMS_SEQUENCES`, `LEAD_SOURCE_FORMATS`, `PERSON_SOURCE_FORMATS` (`index.ts:24`–`104`)

Citations: `packages/niches/src/niche.ts:23`, `packages/niches/src/index.ts:24`

## Connected to

- **owns:** [[email/template]], [[email/sequence]], SMS steps, source formats for [[ledger/import]]
- **joins:** [[platform/offer]] (by name), the facts views in `packages/core/src/views.ts`, [[leads/company]] (`niche` column)

## If you change this

- **Hits:** adding a niche: a facts view (migration), a templates dir, a definition file, `NICHES`, the roster's niche list, `LANDERS_BY_NICHE` and the lander repo; the `Campaign` map in `apps/worker/src/services.ts:151`
- **Does not hit:** running enrollments (snapshotted); the content loop (niche-free)

## Surfaces

| Surface | Role |
|---|---|
| William, in `packages/niches/` | writes |
| worker, CLI | read at start |

## See

- Source: `packages/niches/src/index.ts`

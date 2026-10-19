---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-18 @ 0f4d371b
entity: packages/offers/src/terms.ts:6
---

# terms

What a client pays for an offer: one plan, in cents. `Terms` lives in `@wren/offers` (a leaf). Versions of it sit in `pipeline.terms_versions`, one plan from one date.

## Why this shape

Payment is part of the offer. A change is a new row with a later `effective_from`; a row never changes. The live version of a plan on a date is the highest `number` with `effective_from <= date`. `delivery.agreements` keeps its frozen copy. Old rows lack the new fields, so every new field is optional.

## Shape

- `Terms` (`terms.ts:6`): setup, monthly, per-unit with cap, `days`, `payDays`, plus `shareBps`, `floorCents`, `installments { count, everyDays }`, `trialDays`. `@wren/delivery` re-exports it (`packages/delivery/src/schema.ts`).
- `terms_versions` (`schema.ts:65`): `offer`, `plan` (`standard`, `flat`, `partner-<n>`), `number`, `effective_from`, `body`. Unique `(offer, plan, number)`. Append only.
- `scheduleOf(terms, signedAt, until?)` (`schedule.ts:47`): setup or its parts, monthly lines, a per-unit line with its cap, a share line (no amount, "on reported revenue", floor shown). `trialDays` moves the first bill. With no `days` and no `until`, monthly lines run 12 months.

Citations: `packages/offers/src/terms.ts:6`, `packages/pipeline/src/schema.ts:65`, `packages/pipeline/src/schedule.ts:47`

## Connected to

- **owns:** `pipeline.terms_versions`
- **owned-by:** `@wren/offers` (the type), `@wren/pipeline` (the rows)
- **joins:** [[platform/offer]], [[platform/journey]] (`deals.terms_version`), [[clients/engagement]] (`agreements.terms`)
- **looks-like-but-is-not:** the offer's `Price` (the catalog price terms start from)

## If you change this

- **Hits:** `termsFor` and the contract text in `@wren/delivery`; old `agreements.terms` rows must still parse
- **Does not hit:** invoices already issued

## Surfaces

| Surface | Role |
|---|---|
| none yet | J2 adds `wren terms` |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/schedule.test.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 781f02d7
entity: packages/offers/src/terms.ts:6
---

# terms

What a client pays for an offer: one plan, in cents. `Terms` lives in `@wren/offers` (a leaf). Versions of it sit in `pipeline.terms_versions`, one plan from one date.

## Why this shape

Payment is part of the offer. A change is a new row with a later `effective_from`; a row never changes. The live version of a plan on a date is the highest `number` with `effective_from <= date`. `delivery.agreements` keeps its frozen copy. Old rows lack the new fields, so every new field is optional.

## Shape

- `Terms` (`terms.ts:6`): setup, monthly, per-unit with cap, `days`, `payDays`, plus `shareBps`, `floorCents`, `installments { count, everyDays }`, `trialDays`. `@wren/delivery` re-exports it (`packages/delivery/src/schema.ts`).
- `terms_versions` (`schema.ts:65`): `offer`, `plan` (`standard`, `flat`, `partner-<n>`), `number`, `effective_from`, `body`. Unique `(offer, plan, number)`. Append only.
- Store (`packages/pipeline/src/store.ts`): `addTerms` (next `number` per offer and plan under a lock; a date earlier than the plan's last version is refused), `liveTerms(db, offer, plan, at)` (highest `number` with `effective_from <= at`, or null), `termsHistory`.
- `termsFor(offer, over, flat, live?)` (`packages/delivery/src/index.ts:1195`) stays pure; `onboard` reads `liveTerms` for plan `flat` or `standard` (`planOf`) and passes the body as `live`. No stored version: terms come from the offer's price as before. `agreements.terms_version` names the version only when the operator changed nothing.
- `scheduleOf(terms, signedAt, until?)` (`schedule.ts:47`): setup or its parts, monthly lines, a per-unit line with its cap, a share line (no amount, "on reported revenue", floor shown). `trialDays` moves the first bill. With no `days` and no `until`, monthly lines run 12 months.

Citations: `packages/offers/src/terms.ts:6`, `packages/pipeline/src/store.ts:216`, `packages/delivery/src/index.ts:1195`, `packages/pipeline/src/schema.ts:65`, `packages/pipeline/src/schedule.ts:47`

## Connected to

- **owns:** `pipeline.terms_versions`
- **owned-by:** `@wren/offers` (the type), `@wren/pipeline` (the rows)
- **joins:** [[platform/offer]], [[platform/journey]] (`deals.terms_version`), [[clients/engagement]] (`agreements.terms`)
- **looks-like-but-is-not:** the offer's `Price` (the catalog price terms start from)

## If you change this

- **Hits:** `termsFor`, `onboard` and the contract text in `@wren/delivery`; old `agreements.terms` rows must still parse
- **Does not hit:** invoices already issued

## Surfaces

| Surface | Role |
|---|---|
| `wren terms add|show` (`apps/cli/src/pipeline.ts`), honours `--client` | writes, reads |
| console `termsAdd`, Offers > Terms > Propose version (`apps/portal/web/src/modules/offers`) | writes (same checks as the CLI, caller as `created_by`) |
| `onboard` (`packages/delivery/src/index.ts:1255`) | reads the live version |
| `wren deals sign|schedule`, console `dealsSign` (`signDeal`, `packages/pipeline/src/moves.ts`) | sets `deals.terms_version` once from the plan's live terms; a change needs force and is audited |

## See

- Design: `designs/2026-10-18-journeys.md`
- Tests: `packages/pipeline/src/schedule.test.ts`, `packages/pipeline/test/integration/store.test.ts`, `packages/delivery/test/integration/terms-version.test.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-05 @ 65b4693
entity: packages/offers/src/offer.ts:129
---

# offer

What we sell, as a registry: `Offer` built by `defineOffer`, listed in `OFFERS`. A leaf package; the lander repo reads a snapshot of it.

## Why this shape

One home for the pitch: email enrollments name the offer (`enrollments.offer`), niches map to offers by name, and the lander's pitch pages render the same registry from an exported JSON, never hand-edited (`../lander/README.md:11`). `scripts/gates.sh:13` fails when the snapshot drifts.

## Shape

- `Offer` (`offer.ts:129`), `defineOffer` (`:272`), `OFFERS` (`index.ts:78`), `snapshot.ts` (export)
- Price kinds: free, quoted, fixed, performance (setup + per unit, capped). Ids never change: retire and add.
- `plan` (`Phase`, `offer.ts:94`): the weeks a bought offer runs, each with what we hand over and what we need. [[clients/engagement]] dates it on start. Never on the lander snapshot.
- `addOn` (`offer.ts:191`): one component id the portal's Apps page offers once, checked, with Install and Skip (`apps/portal/web/src/modules/marketplace/AddOn.tsx`). A client's Install is an ask; the team installs. Never on the snapshot.
- `pnpm offers:export ../lander/src/data/offers.json` (`package.json:23`)

Citations: `packages/offers/src/offer.ts:129`, `packages/offers/src/index.ts:78`

## Connected to

- **owned-by:** nothing (leaf)
- **joins:** [[platform/niche]] (`offers`, `offerFacts`), [[email/enrollment]] (`offer`), `enrollment_outcomes` view

## If you change this

- **Hits:** the lander snapshot (re-export, commit in `../lander`, CI deploys it); `designs/2026-09-25-offers.md`; niches that name the offer; the `offers` gate
- **Does not hit:** stored messages; the content loop

## Surfaces

| Surface | Role |
|---|---|
| William, in `packages/offers/src/index.ts` | writes |
| `../lander` (outside this repo) | reads the export |
| compose | reads by name |

## See

- Source: `packages/offers/src/index.ts`

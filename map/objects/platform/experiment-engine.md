---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-29 @ ef481a93
entity: packages/experiments/src/engine.ts:228
covers: ["@wren/experiments"]
stamp: 531f32eb
---

# experiment-engine

The bandit over one test point: counts in, shares and decisions out. Package `@wren/experiments`. Pure functions over `{exposures, replies, interested, booked, opens, negatives}` per option; it knows no email, page or database. The words in code are genetic: a test point is a locus, an option an allele.

## Why this shape

Every test (a site experiment, a page split) needs the same math, so it lives once and stays pure, and a simulator can compare strategies on synthetic truth with no database or model (`simulate.ts`). Fitness turns counts into trials, a pooled Beta prior turns trials into posteriors, P(best) comes from those, and a selection strategy turns them into shares above a floor (`evaluateLocus`). Guards retire an option whose negative rate is too high; convergence settles a point. The unit is the recipient or visitor, never a message.

## Shape

- `evaluateLocus(input, settings)` (`engine.ts:228`), `stopReason` (settled, budget) (`:290`)
- `posteriors`, `pBest` (`:67`, `:84`), `withFloor`; strategies `even`, `thompson`, `epsilon`, `ucb1`; fitness `replies`, `interested`, `booked`, `opens`, `weighted`, `lexicographic` (`names.ts`)
- `settingsSchema`: every field defaulted, so `{}` is valid (`settings.ts:10`). `mutation`, `seeding`, `models`, `strategistEvery`, `queueSize`, `autoApprove` are left from the email copy evolve, retired in d530bb9b: no caller reads them today
- `seeded`, `betaDraw` (`rng.ts`); `simulate` (`simulate.ts:87`)
- callers: site experiments (`packages/channel-search/src/experiments.ts`: Thompson on `booked`, 200 visitors before a variant drops or settles, P(best) 0.95 holds the shares at 90/10 until William ships or stops); [[platform/page-split]] (`packages/sites/src/split-call.ts`: `pBest` only)

Citations: `packages/experiments/src/engine.ts:1`, `packages/channel-search/src/experiments.ts:1`

## Connected to

- **owns:** none (no tables)
- **joins:** `flags`, `flag_experiments`, `flag_days` (`packages/core/src/schema.ts:931`, store `packages/core/src/experiment-store.ts`), [[platform/page-split]]
- **looks-like-but-is-not:** Sites variants (copies with no traffic split)

## If you change this

- **Hits:** `packages/channel-search/src/experiments.ts`, `packages/sites/src/split-call.ts`, `packages/core/test/integration/experiments.test.ts`
- **Does not hit:** the flag tables' shape

## Surfaces

| Surface | Role |
|---|---|
| none | pure code |

## See

- Source: `packages/experiments/src/`
- Design: `designs/2026-10-06-flags-experiments-surveys-heatmaps.md`

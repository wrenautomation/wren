---
type: object
cluster: ads
universe: live
status: verified
verified: 2026-10-06 @ 9d6af2d
entity: packages/channel-meta/src/audit.ts:551
---

# ad-audit

A read-only audit of Wren's Meta ad account: cold start per dimension, scored controls, draft fixes. Not stored; `Ads.audit` returns it and `wren ads audit` prints it.

## Why this shape

Rules that need history (consolidation, objective alignment) mislead on a new account. So cold start is judged per dimension (account, pixel, conversions) from that dimension's own evidence, and missing or contradictory evidence stays `unknown` (`packages/channel-meta/src/audit.ts:191`). Scoring separates health from coverage, so thin evidence reads as thin, not as healthy (`packages/channel-meta/src/audit.ts:471`). Contract from claude-ads (MIT). Fixes are drafts: nothing writes to Meta.

## Shape

- evidence: account, campaigns, ad sets, ads, pixels, last 7 days, and a lag-mature conversion window; each read alone, a failed part is null (`packages/channel-meta/src/audit.ts:139`)
- knobs: `ads.meta` settings (`packages/channel-meta/src/audit.ts:23`)
- controls: policy, measurement, creative, structure, delivery; no audiences yet (renormalized away)

Citations: `packages/channel-meta/src/restate.ts:207`, `apps/cli/src/ads.ts:163`

## Connected to

- **reads:** autobrowse `meta` site, GET `/act_{id}`, `/adsets`, `/ads`, `/adspixels`, `/insights` with `time_range`
- **sibling:** [[ads/ad-launch]] (what it audits once launched)

## If you change this

- **Hits:** `audit.test.ts`, the CLI print, the `ads.meta` settings form in the console
- **Does not hit:** `AdsWatch`, `ad_launches`, any spend gate (no writes)

## Surfaces

| Surface | Role |
|---|---|
| `Ads/audit` | runs |
| `wren ads audit [--json]` | prints |

---
type: object
cluster: ads
universe: live
status: verified
verified: 2026-10-11 @ 4f706c12
entity: packages/content/src/schema.ts:993
---

# ad-format

A creative shape we make ads in (testimonial, us vs them, Reddit post), with what it looks like, when it fits, its state and what we learned. Table `ad_formats`, page Ads → Formats.

## Why this shape

A format is ours to grow, so it's a table, not code: the 42 from a reel are only the seed (`AD_FORMAT_SEED`, written once by migration 0229). Its numbers aren't stored: a launch names its format in `spec.format`, and the view `ad_format_records` (`packages/content/src/schema.ts:1023`) sums that launch's [[ads/ad-day]] rows. State moves by hand: idea, testing, proven, retired.

## Shape

- `slug` (key), `name`, `family` (offer, proof, contrast, story, native, alarm, lesson, humor), `what`, `use`, `state`, `notes`, `source`, `updated_at`, `updated_by`
- view adds `launches`, `spend`, `currency`, `impressions`, `clicks`, `leads`, `ctr`, `cost_per_lead`

Citations: `packages/content/src/social/ad-formats.ts`, `apps/cli/src/ads.ts` (`launch` refuses an unknown format)

## Connected to

- **joins:** [[ads/ad-launch]] (`spec->>'format'`), [[ads/ad-day]] (`adset_id`)

## If you change this

- **Hits:** record `ads.format` (edits: name, family, state, what, use, notes; each save a `changes` row), the Ads app's Formats page, `records.test.ts` (`ads.format`)
- **Does not hit:** Meta: nothing about a format is sent

## Surfaces

| Surface | Role |
|---|---|
| Ads → Formats (`ads.format`) | read, edit in place, Ask Claude |
| `wren ads launch` with `"format"` in the spec | names it; unknown slug refused |

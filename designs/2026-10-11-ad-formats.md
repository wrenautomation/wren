# Ad formats

2026-10-11. temp_notes: the "42 ad formats" reel, "add to marketing system".

## Decision

- Ads → Formats: a list of the shapes we make ads in. Seeded with the reel's 42, each said for a service sold to businesses. Ours to edit after.
- Table `ad_formats`, record `ads.format`. Edits through the records layer: History, Undo, Ask Claude.
- A launch names its format (`spec.format`). The view sums that launch's ad days per format: spend, CTR, leads, cost per lead. `wren ads launch` refuses an unknown slug.
- State by hand: idea → testing → proven, or retired. Numbers inform it; they don't move it.
- Each format carries a family (offer, proof, contrast, story, native, alarm, lesson, humor) to filter by what it leans on.

## Not now

- Generating creatives from a format. Ads launch from a JSON spec today; a generator comes with the ad-copy work.
- Example images per format. The reel's examples are other brands' ads.

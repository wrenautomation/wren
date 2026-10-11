# Split Marketing

2026-10-11. temp_notes: "marketing as an app is really big with a lot of sidebar options, maybe split it up into the content / platform based and the ads, since ads are a little bit different inherently."

## Decision

Wren's Marketing had four groups: Content, Reach, Ads & Site (12 tabs), Numbers. Ads & Site leaves.

- **Ads**, its own app (`ads`, area Marketing). Ads carry spend, variants and their own numbers. One tab today (Ad sets); ad formats (temp_notes, ad formats line) land here next.
- **The site's visitors and search** go to Sites, which already holds every page, its funnel and links: Visitors (Visits, Sessions, Heatmaps, Experiments, Surveys, Survey answers) and Search (Search, Keywords, AI answers).
- Marketing keeps Content, Reach, Numbers.

## Kept

- Old links land: Marketing keeps each moved page as a hidden page at its old id.
- Record `app` ids stay `marketing`, so access grants and a client's Marketing are unchanged. A client's Marketing still shows Ads, Search and Keywords.
- The Ads app belongs to component `marketing.stats` (it provides both apps).

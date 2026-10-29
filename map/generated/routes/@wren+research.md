# @wren/research: routes

Services: 3.

## Discovery (object)

File: packages/research/src/restate/discovery.ts

- **discover** `DiscoveryInput` → `DiscoveryStats` (exclusiveHandler)
- **verify** `DiscoveryInput` → `DomainVerificationStats` (exclusiveHandler)

## Enrichment (object)

File: packages/research/src/restate/enrichment.ts

- **adLibrary** `LimitInput` → `AdLibraryStats` (exclusiveHandler)
- **applyExtractions** `LimitInput` → `import("../enrichment/extraction.js").ApplyExtractionsStats` (exclusiveHandler)
- **applyPicks** `LimitInput` → `import("../enrichment/email-pick/run.js").ApplyPicksStats` (exclusiveHandler)
- **backfillCallRecords** `LimitInput` → `import("../enrichment/audit-backfill.js").BackfillStats` (exclusiveHandler)
- **contacts** `ScanInput` → `ContactsStats` (exclusiveHandler)
- **crawl** `CrawlInput` → `CrawlStats` (exclusiveHandler)
- **exaSearch** `LimitInput` → `ExaSearchStats` (exclusiveHandler)
- **extract** `ExtractInput` → `ExtractionStats` (exclusiveHandler)
- **fbGroups** `LimitInput` → `FbGroupsStats` (exclusiveHandler)
- **instagram** `LimitInput` → `InstagramStats` (exclusiveHandler)
- **opener** `PickInput` → `OpenerStats` (exclusiveHandler)
- **pick** `EmailPickInput` → `EmailPickStats` (exclusiveHandler)
- **profiles** `ProfilesInput` → `ProfileStats` (exclusiveHandler)
- **render** `RenderInput` → `RenderStats` (exclusiveHandler)
- **scan** `ScanInput` → `ScanStats` (exclusiveHandler)
- **signals** `SignalsInput` → `SignalsStats` (exclusiveHandler)
- **tagTestimonials** `TagInput` → `import("../enrichment/testimonials.js").TagTestimonialsStats` (exclusiveHandler)
- **team** `TeamInput` → `TeamStats` (exclusiveHandler)
- **triggers** `LimitInput` → `TriggersStats` (exclusiveHandler)
- **youtube** `LimitInput` → `YouTubeStats` (exclusiveHandler)
- **youtubeSearch** `LimitInput` → `YouTubeSearchStats` (exclusiveHandler)

## ProfileResearch (object)

File: packages/research/src/restate/profile-research.ts

- **run** `ProfileResearchInput` → `ProfileResearchStats` (exclusiveHandler)

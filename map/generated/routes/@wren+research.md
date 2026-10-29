# @wren/research: routes

Services: 3.

## Discovery (object)

File: packages/research/src/restate/discovery.ts

- **discover** `DiscoveryInput` → `DiscoveryStats` (exclusiveHandler): writes public.companies, public.discovery_attempts, public.imports, public.runs, public.sightings, public.unit_holds; reads public.leads, public.people
  - outside: npm @wrenautomation/read
- **verify** `DiscoveryInput` → `DomainVerificationStats` (exclusiveHandler): writes public.companies, public.discovery_attempts, public.imports, public.runs, public.sightings, public.unit_holds; reads public.leads, public.people
  - outside: npm @wrenautomation/read

## Enrichment (object)

File: packages/research/src/restate/enrichment.ts

- **adLibrary** `LimitInput` → `AdLibraryStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.clients, public.limits, public.people, public.suppressions, public.unit_holds
  - outside: npm tldts
- **applyExtractions** `LimitInput` → `import("../enrichment/extraction.js").ApplyExtractionsStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.enrichments, public.import_errors, public.imports, public.people, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.documents, public.leads, public.runs
- **applyPicks** `LimitInput` → `import("../enrichment/email-pick/run.js").ApplyPicksStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.enrichments, public.import_errors, public.imports, public.leads, public.people, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.documents, public.runs, public.suppressions
- **backfillCallRecords** `LimitInput` → `import("../enrichment/audit-backfill.js").BackfillStats` (exclusiveHandler): writes public.enrichments; reads public.companies, public.documents, public.runs
- **contacts** `ScanInput` → `ContactsStats` (exclusiveHandler): writes public.contact_points, public.enrichments, public.unit_holds; reads public.companies, public.documents, public.imports, public.people, public.runs
  - outside: npm libphonenumber-js
- **crawl** `CrawlInput` → `CrawlStats` (exclusiveHandler): writes public.documents, public.unit_holds; reads public.companies, public.imports
  - outside: npm @wrenautomation/read
- **exaSearch** `LimitInput` → `ExaSearchStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings, public.vendor_usage; reads pipeline.shape_versions, public.clients, public.limits, public.people, public.suppressions, public.unit_holds, public.vendor_modes
  - outside: npm tldts
- **extract** `ExtractInput` → `ExtractionStats` (exclusiveHandler): writes public.enrichments; reads public.companies, public.documents, public.imports, public.runs, public.unit_holds
- **fbGroups** `LimitInput` → `FbGroupsStats` (exclusiveHandler): writes public.documents, public.findings, public.platform_object_refs, public.platform_objects, public.social_groups, public.social_posts, public.social_searches; reads public.clients, public.companies, public.limits, public.people, public.unit_holds
  - outside: npm tldts
- **instagram** `LimitInput` → `InstagramStats` (exclusiveHandler): writes public.documents, public.findings, public.unit_holds; reads public.clients, public.companies, public.leads, public.limits, public.own_contact_points, public.people
- **opener** `PickInput` → `OpenerStats` (exclusiveHandler): writes public.enrichments; reads public.companies, public.documents, public.imports, public.leads, public.people, public.runs, public.suppressions, public.unit_holds
  - outside: npm @wrenautomation/read
- **pick** `EmailPickInput` → `EmailPickStats` (exclusiveHandler): writes public.enrichments, public.unit_holds; reads public.companies, public.documents, public.imports, public.people, public.runs
- **profiles** `ProfilesInput` → `ProfileStats` (exclusiveHandler): writes public.check_outcomes, public.companies, public.company_lookups, public.documents, public.findings, public.people, public.person_lookups, public.unit_holds, public.vendor_usage; reads public.clients, public.company_event_checks, public.imports, public.limits, public.profile_lookups, public.runs, public.signal_checks, public.vendor_modes, public.wren_settings
  - outside: npm tldts
- **render** `RenderInput` → `RenderStats` (exclusiveHandler): writes public.documents, public.unit_holds; reads public.companies, public.imports
  - outside: npm @wrenautomation/read
- **scan** `ScanInput` → `ScanStats` (exclusiveHandler): writes public.enrichments, public.unit_holds; reads public.companies, public.documents, public.imports, public.runs
  - outside: npm @wrenautomation/read
- **signals** `SignalsInput` → `SignalsStats` (exclusiveHandler): writes public.documents, public.findings, public.signal_checks, public.unit_holds, public.vendor_usage; reads public.clients, public.companies, public.company_event_checks, public.company_lookups, public.limits, public.people, public.person_lookups, public.profile_lookups, public.runs, public.vendor_modes, public.wren_settings
  - outside: hosts api.exa.ai, api.x.com, www.googleapis.com
- **tagTestimonials** `TagInput` → `import("../enrichment/testimonials.js").TagTestimonialsStats` (exclusiveHandler): writes public.people; reads public.companies, public.imports
- **team** `TeamInput` → `TeamStats` (exclusiveHandler): writes public.check_outcomes, public.documents, public.people, public.team_searches, public.unit_holds, public.vendor_usage; reads public.clients, public.companies, public.imports, public.limits, public.runs, public.vendor_modes
  - outside: npm tldts
- **triggers** `LimitInput` → `TriggersStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.documents, public.findings, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.clients, public.limits, public.people, public.suppressions, public.unit_holds
  - outside: npm @wrenautomation/read, tldts
- **youtube** `LimitInput` → `YouTubeStats` (exclusiveHandler): writes public.documents, public.findings, public.unit_holds; reads public.clients, public.companies, public.leads, public.limits, public.own_contact_points, public.people, public.vendor_modes, public.vendor_usage
- **youtubeSearch** `LimitInput` → `YouTubeSearchStats` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.companies, public.import_errors, public.imports, public.leads, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.sightings; reads pipeline.shape_versions, public.clients, public.limits, public.people, public.suppressions, public.unit_holds
  - outside: npm tldts

## ProfileResearch (object)

File: packages/research/src/restate/profile-research.ts

- **run** `ProfileResearchInput` → `ProfileResearchStats` (exclusiveHandler): writes public.documents, public.profile_findings, public.profile_lookups, public.runs, public.vendor_usage; reads public.clients, public.companies, public.company_event_checks, public.company_lookups, public.limits, public.people, public.person_lookups, public.profile_keys, public.profiles, public.signal_checks, public.social_handles, public.vendor_modes, public.wren_settings
  - outside: npm tldts

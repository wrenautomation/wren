# @wren/channel-meta: routes

Services: 1.

## Ads (service)

File: packages/channel-meta/src/restate.ts

- **accounts** `void` → `import("./ads.js").AdAccount[]` (serviceHandler)
- **audit** `void` → `import("./audit.js").Audit` (serviceHandler): reads public.clients, public.wren_settings
- **campaigns** `void` → `import("./ads.js").CampaignRow[]` (serviceHandler)
- **insights** `{ preset?: string; level?: "account" | "campaign" | "adset" | "ad"; daily?: boolean; }` → `import("./ads.js").InsightRow[]` (serviceHandler)
- **interests** `{ q: string; limit?: number }` → `import("./ads.js").Interest[]` (serviceHandler)
- **launch** `LaunchSpec` → `import("./ads.js").Launched` (serviceHandler): writes public.ad_launches
- **leadConsents** `LeadConsent & { limit?: number }` → `{ given: number; skipped: number; }` (serviceHandler): writes pipeline.deals, pipeline.instances, public.consent_events, public.consents, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles; reads pipeline.shape_versions, public.topics
- **leadForm** `LeadFormSpec` → `string` (serviceHandler)
- **leadForms** `void` → `import("./ads.js").LeadFormRow[]` (serviceHandler)
- **leads** `{ formId: string; limit?: number }` → `import("./ads.js").Lead[]` (serviceHandler)
- **resume** `{ campaignId: string }` → `void` (serviceHandler): writes public.ad_launches
- **start** `Tree & { dailyBudgetUsd: number }` → `void` (serviceHandler): writes public.ad_launches
- **stop** `{ campaignId: string; reason?: string }` → `void` (serviceHandler): writes public.ad_launches

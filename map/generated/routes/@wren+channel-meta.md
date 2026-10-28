# @wren/channel-meta: routes

Services: 1.

## Ads (service)

File: packages/channel-meta/src/restate.ts

- **accounts** `void` → `import("./ads.js").AdAccount[]` (serviceHandler)
- **campaigns** `void` → `import("./ads.js").CampaignRow[]` (serviceHandler)
- **launch** `LaunchSpec` → `import("./ads.js").Launched` (serviceHandler)
- **start** `Tree & { dailyBudgetUsd: number }` → `void` (serviceHandler)
- **stop** `{ campaignId: string; reason?: string }` → `void` (serviceHandler)
- **resume** `{ campaignId: string }` → `void` (serviceHandler)
- **leadForm** `LeadFormSpec` → `string` (serviceHandler)
- **leadForms** `void` → `import("./ads.js").LeadFormRow[]` (serviceHandler)
- **leads** `{ formId: string; limit?: number }` → `import("./ads.js").Lead[]` (serviceHandler)
- **leadConsents** `LeadConsent & { limit?: number }` → `{ given: number; skipped: number; }` (serviceHandler)
- **interests** `{ q: string; limit?: number }` → `import("./ads.js").Interest[]` (serviceHandler)
- **audit** `void` → `import("./audit.js").Audit` (serviceHandler)
- **insights** `{ preset?: string; level?: "account" | "campaign" | "adset" | "ad"; daily?: boolean; }` → `import("./ads.js").InsightRow[]` (serviceHandler)

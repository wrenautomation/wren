# @wren/channel-meta: interface

Exports: 73. Files: 14.

## packages/channel-meta/src/ads.ts

- **AdAccount** (interface) `interface AdAccount { id: string; name?: string; account_status?: number; currency?: string; amount_spent?: string; created_time?: string; }`
- **AdRow** (interface) `interface AdRow { id: string; name?: string; adset_id?: string; effective_status?: string; creative?: { id: string; object_type?: string; url_tags?: string }; }`
- **AdSetRow** (interface) `interface AdSetRow { id: string; name?: string; campaign_id?: string; effective_status?: string; optimization_goal?: string; promoted_object?: { pixel_id?: string; custom_event_type?: string; page_id?: string }; daily_budget?: string; learning_stage_info?: { status?: string }; }`
- **CampaignRow** (interface) `interface CampaignRow { id: string; name: string; status: string; effective_status?: string; objective?: string; daily_budget?: string; }`
- **InsightRow** (interface) `interface InsightRow { date_start?: string; date_stop?: string; campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; spend?: string; impressions?: string; reach?: string; clicks?: string; cpc?: string; ctr?: string; actions?: { action_type: string; value: string }[]; account_currency?: string; }`
- **Interest** (interface) `interface Interest { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; }`
- **LaunchSpec** (interface) `interface LaunchSpec { name: string; objective: MetaObjective; dailyBudgetUsd: number; targeting: Targeting; optimizationGoal?: string; format?: string; creative: { message: string; link: string; headline?: string; description?: string; callToAction?: string; media?: { kind: "image" | "video"; source: string; thumbnail?: string }; leadForm?: { id: string } | LeadFormSpec; }; status?: AdStatus; }`
- **Launched** (interface) `interface Launched extends Tree { creativeId: string; status: AdStatus; dailyBudgetUsd: number; leadFormId?: string; }`
- **Lead** (interface) `interface Lead { id: string; created_time?: string; ad_id?: string; campaign_id?: string; field_data?: { name: string; values: string[] }[]; custom_disclaimer_responses?: { checkbox_key: string; is_checked: boolean | string }[]; }`
- **LeadFormRow** (interface) `interface LeadFormRow { id: string; name: string; status?: string; leads_count?: number; created_time?: string; }`
- **LeadFormSpec** (interface) `interface LeadFormSpec { name: string; privacyUrl: string; questions?: Record<string, unknown>[]; followUpUrl?: string; }`
- **META_OBJECTIVES** (const) `readonly ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION", "OUTCOME_SALES"]`
- **MetaAds** (type) `type MetaAds = ReturnType<typeof metaAds>;`
- **MetaObjective** (type) `type MetaObjective = (typeof META_OBJECTIVES)[number];`
- **PixelRow** (interface) `interface PixelRow { id: string; name?: string; creation_time?: string; last_fired_time?: string; is_unavailable?: boolean; }`
- **Tree** (interface) `interface Tree { campaignId: string; adsetId: string; adId: string; }`
- **URL_TAGS** (const) `"utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}"`
- **accountIdOf** (function) `(id: string): string`
- **metaAds** (function) `(sites: SiteClient, o: MetaAdsOptions = {}): { accounts: () => Promise<AdAccount[]>; account: () => Promise<AdAccount>; adsets: () => Promise<AdSetRow[]>; ads: () => Promise<AdRow[]>; pixels: () => Promise<PixelRow[]>; campaigns(): Promise<CampaignRow[]>; launch(spec: LaunchSpec): Promise<Launched>; leadForm: (form: LeadFormSpec, followUp?: st…`
- **toMinor** (function) `(usd: number): number`

## packages/channel-meta/src/audit.ts

- **Audit** (interface) `interface Audit { at: string; accountId: string | null; coldStart: ColdStart; scope: "live" | "paused"; controls: Control[]; categories: Partial<Record<Category, { health: number | null; coverage: number }>>; health: number | null; coverage: number; grade: "graded" | "provisional" | "insufficient"; gaps: string[]; drafts: Draft[]; errors: Record<string, string>; }`
- **AuditSettings** (type) `type AuditSettings = z.infer<typeof auditSettingsSchema>;`
- **Category** (type) `type Category = | "measurement" | "creative" | "structure" | "audiences" | "delivery" | "policy";`
- **Cold** (type) `type Cold = "cold" | "warm" | "unknown";`
- **Control** (interface) `interface Control { id: string; category: Category; severity: Severity; state: ControlState; detail: string; }`
- **Draft** (interface) `interface Draft { control: string | null; text: string; }`
- **Evidence** (interface) `interface Evidence { now: string; account: AdAccount | null; campaigns: CampaignRow[] | null; adsets: AdSetRow[] | null; ads: AdRow[] | null; pixels: PixelRow[] | null; recent: InsightRow[] | null; matured: InsightRow[] | null; errors: Record<string, string>; }`
- **audit** (function) `(e: Evidence, s: AuditSettings = auditSettingsSchema.parse({})): Audit`
- **auditSettingsSchema** (const) `z.ZodObject<{ pixelStaleDays: z.ZodDefault<z.ZodNumber>; minAdsPerAdset: z.ZodDefault<z.ZodNumber>; maxAdsetsPerCampaign: z.ZodDefault<z.ZodNumber>; minBudgetUse: z.ZodDefault<z.ZodNumber>; conversionLagDays: z.ZodDefault<z.ZodNumber>; }, z.core.$strict>`
- **coldStart** (function) `(e: Evidence): ColdStart`
- **controls** (function) `(e: Evidence, cold: ColdStart, s: AuditSettings): { scope: Audit["scope"]; controls: Control[]; }`
- **drafts** (function) `(cs: Control[], cold: ColdStart): Draft[]`
- **gatherEvidence** (function) `(ads: MetaAds, now: Date, s: AuditSettings = auditSettingsSchema.parse({})): Promise<Evidence>`
- **score** (function) `(cs: Control[]): Pick<Audit, "categories" | "health" | "coverage" | "grade" | "gaps">`

## packages/channel-meta/src/bridge.ts

- **ideaFromVerdict** (function) `(v: Verdict): string`
- **isWinner** (function) `(v: Verdict): boolean`
- **specFromPost** (function) `(post: PostLike, o: SpecFromPostOptions = {}): LaunchSpec`

## packages/channel-meta/src/components.ts

- **META_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/channel-meta/src/content-web.ts

- **instagramWebContent** (function) `(sites: SiteClient, o: { now?: () => Date; host?: MediaHost } = {}): ContentChannel`

## packages/channel-meta/src/content.ts

- **facebookContent** (function) `(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel`
- **fbCurveOf** (function) `(graph: unknown): Array<{ ratio: number; watch: number }>`
- **igFollowersOf** (function) `(metric: string, d: Demographics | undefined): InsightValue[]`
- **igMetricsFor** (function) `(kind: string | null | undefined): string[]`
- **instagramContent** (function) `(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel`

## packages/channel-meta/src/days.ts

- **leadsOf** (function) `(row: InsightRow): number`
- **upsertAdDays** (function) `(db: Queryable, rows: readonly InsightRow[]): Promise<number>`

## packages/channel-meta/src/launches.ts

- **Verdict** (interface) `interface Verdict { launch: AdLaunch; result: AdsetResult; pause: string | null; }`
- **activeLaunches** (function) `(db: Db): Promise<AdLaunch[]>`
- **formatLaunches** (function) `(rows: AdLaunch[]): string[]`
- **formatVerdicts** (function) `(vs: Verdict[]): string[]`
- **judge** (function) `(launches: AdLaunch[], rows: InsightRow[], o: { pauseAfterUsd: number }): Verdict[]`
- **launchesByCampaign** (function) `(db: Db, campaignIds: string[]): Promise<AdLaunch[]>`
- **listLaunches** (function) `(db: Db, limit = 50): Promise<AdLaunch[]>`
- **markStarted** (function) `(db: Db, campaignId: string, dailyBudgetUsd: number, now = new Date()): Promise<AdLaunch | null>`
- **markStopped** (function) `(db: Db, campaignId: string, reason: string | null = null, now = new Date()): Promise<AdLaunch | null>`
- **recordLaunch** (function) `(db: Db, r: { adAccountId: string; spec: LaunchSpec; launched: Launched }): Promise<AdLaunch>`
- **resultOf** (function) `(row: InsightRow): AdsetResult | null`

## packages/channel-meta/src/records.ts

- **adDayRecord** (const) `import("@wren/core/records").RecordType`

## packages/channel-meta/src/restate.ts

- **AdsService** (type) `type AdsService = ReturnType<typeof makeAds>;`
- **makeAds** (function) `(deps: AdsDeps): restate.ServiceDefinition<"Ads", { accounts: (ctx: restate.Context) => Promise<import("./ads.js").AdAccount[]>; campaigns: (ctx: restate.Context) => Promise<import("./ads.js").CampaignRow[]>; launch: (ctx: restate.Context, spec: LaunchSpec) => Promise<import("./ads.js").Launched>; start: (ctx: resta…`

## packages/channel-meta/src/schema.ts

- **AdDay** (type) `type AdDay = typeof adDays.$inferSelect;`
- **AdLaunch** (type) `type AdLaunch = typeof adLaunches.$inferSelect;`
- **LAUNCH_STATUSES** (const) `readonly ["paused", "active", "stopped"]`
- **LaunchStatus** (type) `type LaunchStatus = (typeof LAUNCH_STATUSES)[number];`
- **adDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "ad_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "ad_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; isPr…`
- **adLaunches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "ad_launches"; schema: undefined; columns: { name: import("drizzle-orm/pg-core").PgColumn<{ name: "name"; tableName: "ad_launches"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **marketingAdDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_ad_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_ad_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`

## packages/channel-meta/src/setups.ts

- **metaChecks** (function) `(sites: SiteClient): Record<string, SetupCheck>`

## packages/channel-meta/src/threads.ts

- **threadsContent** (function) `(sites: SiteClient, o: ThreadsContentOptions = {}): ContentChannel`

## packages/channel-meta/src/watch.ts

- **AdsWatch** (type) `type AdsWatch = ReturnType<typeof makeAdsWatch>;`
- **WATCH_KEY** (const) `"default"`
- **WatchStats** (interface) `interface WatchStats { active: number; days: number; verdicts: { campaignId: string; name: string; spendUsd: number; clicks: number; results: number; paused: boolean; }[]; failed: { campaignId: string; error: string }[]; ideas: { campaignId: string; ideaId: string }[]; insightsError?: string; }`
- **makeAdsWatch** (function) `(deps: AdsWatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) =>…`

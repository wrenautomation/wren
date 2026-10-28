# @wren/channel-search: interface

Exports: 105. Files: 16.

## packages/channel-search/src/answers.ts

- **ask** (function) `(sites: SiteClient, engine: Engine, phrase: string, host: string): Promise<Answer>`
- **dueKeywords** (function) `(db: Db, engine: Engine, today: string, limit: number): Promise<SearchKeyword[]>`
- **recordAnswer** (function) `(db: Db, k: SearchKeyword, engine: Engine, a: Answer, o: { today: string; runId: string | null }): Promise<number>`
- **Answer** (interface) `interface Answer { cited: boolean; rank: number | null; overview: boolean | null; sources: string[]; questions: string[]; }`
- **isSite** (function) `(url: string | null | undefined, host: string): boolean`

## packages/channel-search/src/apply.ts

- **applyProposals** (function) `(sources: readonly SourceFile[], proposals: readonly SearchProposal[]): Applied`
- **pullRequestBody** (function) `(a: Applied): string`
- **Applied** (interface) `interface Applied { files: SourceFile[]; applied: SearchProposal[]; byHand: Array<{ proposal: SearchProposal; reason: string }>; }`

## packages/channel-search/src/brief.ts

- **brief** (function) `(db: Db, o: { today: string; days?: number }): Promise<Brief>`
- **formatBrief** (function) `(b: Brief): string[]`
- **PageLine** (type) `type PageLine = { url: string; coverage: string | null; indexed: boolean; on: string; impressions: number; clicks: number; position: number | null; };`
- **Brief** (interface) `interface Brief { since: string; keywords: KeywordLine[]; pages: PageLine[]; }`

## packages/channel-search/src/citability.ts

- **scorePassage** (function) `(text: string, heading = ""): PassageScore`
- **passagesOf** (function) `(markdown: string): { heading: string; text: string }[]`
- **citability** (function) `(markdown: string): Citability`

## packages/channel-search/src/components.ts

- **SEARCH_COMPONENT** (const) `"search.watch"`
- **searchSettingsSchema** (const) `z.ZodObject<{ origin: z.ZodOptional<z.ZodURL>; }, z.core.$strict>`
- **SEARCH_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/channel-search/src/console.ts

- **searchConsoleClient** (function) `(key: ServiceAccountKey, fetch: FetchLike = (u, i) => globalThis.fetch(u, i)): SearchConsoleClient`
- **searchAnalytics** (function) `(c: SearchConsoleClient, site: string, q: { startDate: string; endDate: string; dimensions: readonly string[] }): Promise<AnalyticsRow[]>`
- **inspectUrl** (function) `(c: SearchConsoleClient, site: string, url: string): Promise<Inspection>`
- **sitemapUrls** (function) `(fetch: FetchLike, sitemap: string): Promise<string[]>`
- **submitSitemap** (function) `(c: SearchConsoleClient, site: string, sitemap: string): Promise<void>`
- **listSites** (function) `(c: SearchConsoleClient): Promise<SiteEntry[]>`
- **PAGE_LIMIT_MS** (const) `30000`
- **SearchConsoleClient** (interface) `interface SearchConsoleClient { fetch: FetchLike; token: () => Promise<string>; }`

## packages/channel-search/src/heat.ts

- **rollupHeat** (function) `(events: readonly SiteEvent[]): { heat: HeatDayRow[]; scroll: ScrollDayRow[]; from: number | null; }`
- **writeHeatDays** (function) `(db: Queryable, rows: { heat: readonly HeatDayRow[]; scroll: readonly ScrollDayRow[] }): Promise<number>`

## packages/channel-search/src/keywords.ts

- **activeKeywords** (function) `(db: Db): Promise<SearchKeyword[]>`
- **addKeywords** (function) `(db: Db, phrases: readonly string[], o: { source: KeywordSource; page?: string | null; parentId?: number | null; runId?: string | null; }): Promise<number>`
- **retireKeyword** (function) `(db: Db, phrase: string): Promise<boolean>`
- **discoverKeywords** (function) `(db: Db, o: { today: string; days?: number; minImpressions?: number; runId: string | null }): Promise<number>`
- **fanOut** (function) `(db: Db, llm: LlmClient, o: { about: string; runId: string | null }): Promise<FanOutStats>`

## packages/channel-search/src/propose.ts

- **wordsChanged** (function) `(a: string, b: string): number`
- **refusal** (function) `(p: ProposalDraft, site: string): string | null`
- **storeProposals** (function) `(db: Db, drafts: readonly ProposalDraft[], o: { site: string; today: string; runId: string | null; dry?: boolean }): Promise<ProposeStats>`
- **ProposalBatch** (const) `z.ZodUnion<readonly [z.ZodArray<z.ZodObject<{ page: z.ZodString; kind: z.ZodEnum<{ page: "page"; title: "title"; description: "description"; heading: "heading"; copy: "copy"; faq: "faq"; }>; current: z.ZodString; proposed: z.ZodString; why: z.ZodString; keywords: z.ZodDefault<z.ZodArray<z.ZodString>…`
- **ProposalDraft** (type) `type ProposalDraft = z.infer<typeof Proposal>;`

## packages/channel-search/src/records.ts

- **searchPageRecord** (const) `import("@wren/core/records").RecordType`
- **keywordRecord** (const) `import("@wren/core/records").RecordType`
- **searchDayRecord** (const) `import("@wren/core/records").RecordType`
- **funnelRecord** (const) `import("@wren/core/records").RecordType`
- **SEARCH_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **sessionRecord** (function) `(src: SessionSource): import("@wren/core/records").RecordType`
- **surveyAnswerRecord** (function) `(site: SessionSource["site"]): import("@wren/core/records").RecordType`
- **widthOf** (function) `(w: number): HeatWidth`
- **Heat** (interface) `interface Heat { cells: { path: string; cell: number; clicks: number; rage: number }[]; bands: number[]; snapshot: { url: string; w: number } | null; }`
- **heatRecord** (function) `(src?: SessionSource): import("@wren/core/records").RecordType`

## packages/channel-search/src/restate/watch.ts

- **originOf** (function) `(property: string): string | null`
- **clientSearch** (function) `(main: Queryable, id: string): Promise<ClientSearch>`
- **makeSearchWatch** (function) `(deps: SearchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>; start: (ctx: restate.Ob…`
- **makeSearchWeek** (function) `(deps: SearchWeekDeps): restate.ServiceDefinition<"SearchWeek", { run: (ctx: restate.Context, req: { today: string; }) => Promise<WeekStats>; }>`
- **SEARCH_KEY** (const) `"default"`
- **weekOf** (function) `(d: Date): string`
- **SearchWatch** (type) `type SearchWatch = ReturnType<typeof makeSearchWatch>;`
- **SearchWeek** (type) `type SearchWeek = ReturnType<typeof makeSearchWeek>;`

## packages/channel-search/src/schema.ts

- **searchDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "search_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **SearchDay** (type) `type SearchDay = typeof searchDays.$inferSelect;`
- **INSPECTION_VERDICTS** (const) `readonly ["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"]`
- **InspectionVerdict** (type) `type InspectionVerdict = (typeof INSPECTION_VERDICTS)[number];`
- **searchPages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_pages"; schema: undefined; columns: { url: import("drizzle-orm/pg-core").PgColumn<{ name: "url"; tableName: "search_pages"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **SearchPage** (type) `type SearchPage = typeof searchPages.$inferSelect;`
- **KEYWORD_SOURCES** (const) `readonly ["seed", "fanout", "query"]`
- **KeywordSource** (type) `type KeywordSource = (typeof KEYWORD_SOURCES)[number];`
- **searchKeywords** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_keywords"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "search_keywords"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **SearchKeyword** (type) `type SearchKeyword = typeof searchKeywords.$inferSelect;`
- **ENGINES** (const) `readonly ["google", "perplexity"]`
- **Engine** (type) `type Engine = (typeof ENGINES)[number];`
- **searchAnswers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_answers"; schema: undefined; columns: { engine: import("drizzle-orm/pg-core").PgColumn<{ name: "engine"; tableName: "search_answers"; dataType: "string"; columnType: "PgVarchar"; data: "google" | "perplexity"; driverParam: string; notN…`
- **SearchAnswer** (type) `type SearchAnswer = typeof searchAnswers.$inferSelect;`
- **PROPOSAL_KINDS** (const) `readonly ["title", "description", "heading", "copy", "faq", "page"]`
- **ProposalKind** (type) `type ProposalKind = (typeof PROPOSAL_KINDS)[number];`
- **PROPOSAL_STATES** (const) `readonly ["open", "taken", "dropped"]`
- **ProposalState** (type) `type ProposalState = (typeof PROPOSAL_STATES)[number];`
- **searchProposals** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_proposals"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "search_proposals"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **SearchProposal** (type) `type SearchProposal = typeof searchProposals.$inferSelect;`
- **SITE_CHANNELS** (const) `readonly ["email", "sms", "ads", "content", "search", "reach", "other", "direct"]`
- **SiteChannel** (type) `type SiteChannel = (typeof SITE_CHANNELS)[number];`
- **siteDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "site_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **SiteDay** (type) `type SiteDay = typeof siteDays.$inferSelect;`
- **linkDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "link_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "link_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **LinkDay** (type) `type LinkDay = typeof linkDays.$inferSelect;`
- **HEAT_WIDTHS** (const) `readonly ["phone", "tablet", "laptop", "wide"]`
- **HeatWidth** (type) `type HeatWidth = (typeof HEAT_WIDTHS)[number];`
- **heatDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "heat_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "heat_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **scrollDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "scroll_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "scroll_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **marketingSearchPageRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_search_page_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_search_page_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: fa…`
- **marketingKeywordRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_keyword_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_keyword_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault…`
- **marketingSearchDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_search_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_search_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: fals…`
- **marketingAnswerRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_answer_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_answer_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **marketingSiteDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_site_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_site_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; i…`
- **marketingLinkDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_link_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_link_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; i…`
- **marketingFunnelRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_funnel_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_funnel_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **marketingHeatRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_heat_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_heat_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`

## packages/channel-search/src/setups.ts

- **propertyOf** (function) `(ref: string, sites: readonly T[]): T | null`
- **searchConsoleChecks** (function) `(client: () => SearchConsoleClient): Record<string, SetupCheck>`

## packages/channel-search/src/site-days.ts

- **rollupSite** (function) `(hits: readonly SiteHit[], applications: readonly SiteApplication[], calls: readonly BookedCall[] = [], paid: readonly PaidEngagement[] = []): SiteDayRow[]`
- **upsertSiteDays** (function) `(db: Queryable, rows: readonly SiteDayRow[]): Promise<number>`
- **callsAndPaid** (function) `(db: Queryable): Promise<{ calls: BookedCall[]; paid: PaidEngagement[] }>`
- **BookedCall** (interface) `interface BookedCall { day: string; code: string | null; email: string | null; }`

## packages/channel-search/src/site.ts

- **siteText** (function) `(fetch: FetchLike, origin: string, urls: readonly string[]): Promise<string>`

## packages/channel-search/src/sync.ts

- **syncSearch** (function) `(db: Db, o: SyncOptions): Promise<SyncStats>`
- **formatChanges** (function) `(changes: readonly IndexChange[]): string[]`
- **STALE_DAYS** (const) `14`
- **SyncStats** (interface) `interface SyncStats { rows: number; window: [string, string]; inspected: number; indexed: number; changes: IndexChange[]; added: string[]; }`

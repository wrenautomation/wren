# @wren/channel-search: interface

Exports: 105. Files: 16.

## packages/channel-search/src/answers.ts

- **Answer** (interface) `interface Answer { cited: boolean; rank: number | null; overview: boolean | null; sources: string[]; questions: string[]; }`
- **ask** (function) `(sites: SiteClient, engine: Engine, phrase: string, host: string): Promise<Answer>`
- **dueKeywords** (function) `(db: Db, engine: Engine, today: string, limit: number): Promise<SearchKeyword[]>`
- **isSite** (function) `(url: string | null | undefined, host: string): boolean`
- **recordAnswer** (function) `(db: Db, k: SearchKeyword, engine: Engine, a: Answer, o: { today: string; runId: string | null }): Promise<number>`

## packages/channel-search/src/apply.ts

- **Applied** (interface) `interface Applied { files: SourceFile[]; applied: SearchProposal[]; byHand: Array<{ proposal: SearchProposal; reason: string }>; }`
- **applyProposals** (function) `(sources: readonly SourceFile[], proposals: readonly SearchProposal[]): Applied`
- **pullRequestBody** (function) `(a: Applied): string`

## packages/channel-search/src/brief.ts

- **Brief** (interface) `interface Brief { since: string; keywords: KeywordLine[]; pages: PageLine[]; }`
- **PageLine** (type) `type PageLine = { url: string; coverage: string | null; indexed: boolean; on: string; impressions: number; clicks: number; position: number | null; };`
- **brief** (function) `(db: Db, o: { today: string; days?: number }): Promise<Brief>`
- **formatBrief** (function) `(b: Brief): string[]`

## packages/channel-search/src/citability.ts

- **citability** (function) `(markdown: string): Citability`
- **passagesOf** (function) `(markdown: string): { heading: string; text: string }[]`
- **scorePassage** (function) `(text: string, heading = ""): PassageScore`

## packages/channel-search/src/components.ts

- **SEARCH_COMPONENT** (const) `"search.watch"`
- **SEARCH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **searchSettingsSchema** (const) `z.ZodObject<{ origin: z.ZodOptional<z.ZodURL>; }, z.core.$strict>`

## packages/channel-search/src/console.ts

- **PAGE_LIMIT_MS** (const) `30000`
- **SearchConsoleClient** (interface) `interface SearchConsoleClient { fetch: FetchLike; token: () => Promise<string>; }`
- **inspectUrl** (function) `(c: SearchConsoleClient, site: string, url: string): Promise<Inspection>`
- **listSites** (function) `(c: SearchConsoleClient): Promise<SiteEntry[]>`
- **searchAnalytics** (function) `(c: SearchConsoleClient, site: string, q: { startDate: string; endDate: string; dimensions: readonly string[] }): Promise<AnalyticsRow[]>`
- **searchConsoleClient** (function) `(key: ServiceAccountKey, fetch: FetchLike = (u, i) => globalThis.fetch(u, i)): SearchConsoleClient`
- **sitemapUrls** (function) `(fetch: FetchLike, sitemap: string): Promise<string[]>`
- **submitSitemap** (function) `(c: SearchConsoleClient, site: string, sitemap: string): Promise<void>`

## packages/channel-search/src/heat.ts

- **rollupHeat** (function) `(events: readonly SiteEvent[]): { heat: HeatDayRow[]; scroll: ScrollDayRow[]; from: number | null; }`
- **writeHeatDays** (function) `(db: Queryable, rows: { heat: readonly HeatDayRow[]; scroll: readonly ScrollDayRow[] }): Promise<number>`

## packages/channel-search/src/keywords.ts

- **activeKeywords** (function) `(db: Db): Promise<SearchKeyword[]>`
- **addKeywords** (function) `(db: Db, phrases: readonly string[], o: { source: KeywordSource; page?: string | null; parentId?: number | null; runId?: string | null; }): Promise<number>`
- **discoverKeywords** (function) `(db: Db, o: { today: string; days?: number; minImpressions?: number; runId: string | null }): Promise<number>`
- **fanOut** (function) `(db: Db, llm: LlmClient, o: { about: string; runId: string | null }): Promise<FanOutStats>`
- **retireKeyword** (function) `(db: Db, phrase: string): Promise<boolean>`

## packages/channel-search/src/propose.ts

- **ProposalBatch** (const) `z.ZodUnion<readonly [z.ZodArray<z.ZodObject<{ page: z.ZodString; kind: z.ZodEnum<{ page: "page"; title: "title"; description: "description"; heading: "heading"; copy: "copy"; faq: "faq"; }>; current: z.ZodString; proposed: z.ZodString; why: z.ZodString; keywords: z.ZodDefault<z.ZodArray<z.ZodString>…`
- **ProposalDraft** (type) `type ProposalDraft = z.infer<typeof Proposal>;`
- **refusal** (function) `(p: ProposalDraft, site: string): string | null`
- **storeProposals** (function) `(db: Db, drafts: readonly ProposalDraft[], o: { site: string; today: string; runId: string | null; dry?: boolean }): Promise<ProposeStats>`
- **wordsChanged** (function) `(a: string, b: string): number`

## packages/channel-search/src/records.ts

- **Heat** (interface) `interface Heat { cells: { path: string; cell: number; clicks: number; rage: number }[]; bands: number[]; snapshot: { url: string; w: number } | null; }`
- **SEARCH_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **funnelRecord** (const) `import("@wren/core/records").RecordType`
- **heatRecord** (function) `(src?: SessionSource): import("@wren/core/records").RecordType`
- **keywordRecord** (const) `import("@wren/core/records").RecordType`
- **searchDayRecord** (const) `import("@wren/core/records").RecordType`
- **searchPageRecord** (const) `import("@wren/core/records").RecordType`
- **sessionRecord** (function) `(src: SessionSource): import("@wren/core/records").RecordType`
- **surveyAnswerRecord** (function) `(site: SessionSource["site"]): import("@wren/core/records").RecordType`
- **widthOf** (function) `(w: number): HeatWidth`

## packages/channel-search/src/restate/watch.ts

- **SEARCH_KEY** (const) `"default"`
- **SearchWatch** (type) `type SearchWatch = ReturnType<typeof makeSearchWatch>;`
- **SearchWeek** (type) `type SearchWeek = ReturnType<typeof makeSearchWeek>;`
- **clientSearch** (function) `(main: Queryable, id: string): Promise<ClientSearch>`
- **makeSearchWatch** (function) `(deps: SearchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>; start: (ctx: restate.Ob…`
- **makeSearchWeek** (function) `(deps: SearchWeekDeps): restate.ServiceDefinition<"SearchWeek", { run: (ctx: restate.Context, req: { today: string; }) => Promise<WeekStats>; }>`
- **originOf** (function) `(property: string): string | null`
- **weekOf** (function) `(d: Date): string`

## packages/channel-search/src/schema.ts

- **ENGINES** (const) `readonly ["google", "perplexity"]`
- **Engine** (type) `type Engine = (typeof ENGINES)[number];`
- **HEAT_WIDTHS** (const) `readonly ["phone", "tablet", "laptop", "wide"]`
- **HeatWidth** (type) `type HeatWidth = (typeof HEAT_WIDTHS)[number];`
- **INSPECTION_VERDICTS** (const) `readonly ["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"]`
- **InspectionVerdict** (type) `type InspectionVerdict = (typeof INSPECTION_VERDICTS)[number];`
- **KEYWORD_SOURCES** (const) `readonly ["seed", "fanout", "query"]`
- **KeywordSource** (type) `type KeywordSource = (typeof KEYWORD_SOURCES)[number];`
- **LinkDay** (type) `type LinkDay = typeof linkDays.$inferSelect;`
- **PROPOSAL_KINDS** (const) `readonly ["title", "description", "heading", "copy", "faq", "page"]`
- **PROPOSAL_STATES** (const) `readonly ["open", "taken", "dropped"]`
- **ProposalKind** (type) `type ProposalKind = (typeof PROPOSAL_KINDS)[number];`
- **ProposalState** (type) `type ProposalState = (typeof PROPOSAL_STATES)[number];`
- **SITE_CHANNELS** (const) `readonly ["email", "sms", "ads", "content", "search", "reach", "other", "direct"]`
- **SearchAnswer** (type) `type SearchAnswer = typeof searchAnswers.$inferSelect;`
- **SearchDay** (type) `type SearchDay = typeof searchDays.$inferSelect;`
- **SearchKeyword** (type) `type SearchKeyword = typeof searchKeywords.$inferSelect;`
- **SearchPage** (type) `type SearchPage = typeof searchPages.$inferSelect;`
- **SearchProposal** (type) `type SearchProposal = typeof searchProposals.$inferSelect;`
- **SiteChannel** (type) `type SiteChannel = (typeof SITE_CHANNELS)[number];`
- **SiteDay** (type) `type SiteDay = typeof siteDays.$inferSelect;`
- **heatDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "heat_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "heat_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **linkDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "link_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "link_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **marketingAnswerRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_answer_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_answer_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **marketingFunnelRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_funnel_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_funnel_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **marketingHeatRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_heat_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_heat_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **marketingKeywordRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_keyword_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_keyword_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault…`
- **marketingLinkDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_link_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_link_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; i…`
- **marketingSearchDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_search_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_search_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: fals…`
- **marketingSearchPageRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_search_page_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_search_page_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: fa…`
- **marketingSiteDayRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_site_day_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_site_day_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; i…`
- **scrollDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "scroll_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "scroll_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **searchAnswers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_answers"; schema: undefined; columns: { engine: import("drizzle-orm/pg-core").PgColumn<{ name: "engine"; tableName: "search_answers"; dataType: "string"; columnType: "PgVarchar"; data: "google" | "perplexity"; driverParam: string; notN…`
- **searchDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "search_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **searchKeywords** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_keywords"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "search_keywords"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **searchPages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_pages"; schema: undefined; columns: { url: import("drizzle-orm/pg-core").PgColumn<{ name: "url"; tableName: "search_pages"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; …`
- **searchProposals** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "search_proposals"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "search_proposals"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **siteDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_days"; schema: undefined; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "site_days"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; …`

## packages/channel-search/src/setups.ts

- **propertyOf** (function) `(ref: string, sites: readonly T[]): T | null`
- **searchConsoleChecks** (function) `(client: () => SearchConsoleClient): Record<string, SetupCheck>`

## packages/channel-search/src/site-days.ts

- **BookedCall** (interface) `interface BookedCall { day: string; code: string | null; email: string | null; }`
- **callsAndPaid** (function) `(db: Queryable): Promise<{ calls: BookedCall[]; paid: PaidEngagement[] }>`
- **rollupSite** (function) `(hits: readonly SiteHit[], applications: readonly SiteApplication[], calls: readonly BookedCall[] = [], paid: readonly PaidEngagement[] = []): SiteDayRow[]`
- **upsertSiteDays** (function) `(db: Queryable, rows: readonly SiteDayRow[]): Promise<number>`

## packages/channel-search/src/site.ts

- **siteText** (function) `(fetch: FetchLike, origin: string, urls: readonly string[]): Promise<string>`

## packages/channel-search/src/sync.ts

- **STALE_DAYS** (const) `14`
- **SyncStats** (interface) `interface SyncStats { rows: number; window: [string, string]; inspected: number; indexed: number; changes: IndexChange[]; added: string[]; }`
- **formatChanges** (function) `(changes: readonly IndexChange[]): string[]`
- **syncSearch** (function) `(db: Db, o: SyncOptions): Promise<SyncStats>`

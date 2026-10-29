# @wren/research: interface

Exports: 646. Files: 78.

## packages/core/src/buckets.ts

- **Bucket** (interface) `interface Bucket { perDay: number; burst: number; }`
- **bucketRoom** (function) `(spent: readonly number[], now: number, bucket: Bucket): { room: number; nextInMs: number }`

## packages/db/src/columns.ts

- **pgSafe** (function) `(v: T): T`

## packages/research/src/companies/boards.ts

- **Board** (interface) `interface Board { ats: string; token: string; page: string; api: string; }`
- **Job** (interface) `interface Job { title: string; location: string | null; url: string | null; postedAt: string | null; }`
- **boardPageOf** (function) `(url: string): string | null`
- **findBoards** (function) `(page: string): Board[]`
- **readBoard** (function) `(fetcher: Fetcher, board: Board): Promise<BoardRead>`

## packages/research/src/companies/customers.ts

- **CustomersResult** (interface) `interface CustomersResult { customers: NamedCustomer[]; dropped: { name: string; why: string }[]; tried: CustomersTried[]; }`
- **buildCustomersPrompt** (function) `(firm: string, pages: PageMaterial[]): string`
- **findCustomers** (function) `(fetcher: Fetcher, llm: LlmClient, firm: { name: string; site: string }, opts: CustomersOptions = {}): Promise<CustomersResult>`
- **gateCustomers** (function) `(said: z.infer<typeof customersSchema>["customers"], firm: { name: string; site: string }, pages: PageMaterial[]): Omit<CustomersResult, "tried">`
- **imageNames** (function) `(html: string): string[]`

## packages/research/src/companies/events.ts

- **CompanyEvent** (interface) `interface CompanyEvent { kind: EventKind; date: string; title: string; snippet: string | null; url: string; source: "rss" | "google" | "exa"; raw: unknown; }`
- **EVENT_KINDS** (const) `readonly EventKind[]`
- **EventHit** (interface) `interface EventHit { title: string; url: string; snippet?: string | null; date?: string | null; raw?: unknown; }`
- **EventKind** (type) `type EventKind = (typeof NEWS_KINDS)[number];`
- **EventsResult** (interface) `interface EventsResult { state: EventsState; events: CompanyEvent[]; tried: EventsTried[]; retryAt: Date | null; googleStopped: boolean; }`
- **NEWS_KINDS** (const) `readonly ["acquisition", "merger", "funding", "leader", "launch", "office", "award", "partnership", "expansion"]`
- **NEWS_RSS** (const) `"https://news.google.com/rss/search"`
- **eventDate** (function) `(said: string | null | undefined, now: Date): string | null`
- **eventDocument** (function) `(e: CompanyEvent): DocumentDraft`
- **eventFinding** (function) `(companyId: number, e: CompanyEvent): CompanyFindingDraft & { signalAt: Date; dated: "published" }`
- **eventKindOf** (function) `(text: string, kinds: readonly EventKind[] = NEWS_KINDS): EventKind | null`
- **eventQuery** (function) `(firm: Firm, source: CompanyEvent["source"], kinds: readonly EventKind[] = EVENT_KINDS): string | null`
- **googleWords** (function) `(kind: EventKind): readonly string[]`
- **readEvents** (function) `(hits: readonly EventHit[], firm: Firm, source: CompanyEvent["source"], now: Date, kinds: readonly EventKind[] = EVENT_KINDS): CompanyEvent[]`
- **readRss** (function) `(xml: string): EventHit[] | null`
- **searchEvents** (function) `(sites: SiteClient, firm: Firm, opts: { google: boolean; kinds?: readonly EventKind[]; fetcher?: Fetcher | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<EventsResult>`

## packages/research/src/companies/hiring.ts

- **CompanySubject** (interface) `interface CompanySubject { companyId: number; firm: Firm; linkedinPage: string | null; }`
- **HiringOptions** (interface) `interface HiringOptions { linkedin: string | null; linkedinCappedUntil?: Date | null; google?: boolean; accountRoom?: number; now?: () => Date; sleep?: (ms: number) => Promise<void>; }`
- **HiringResult** (interface) `interface HiringResult { state: CompanyCheckState; finding: CompanyFindingDraft | null; tried: CheckTried[]; retryAt: Date | null; cappedBy: string | null; served: ReadSource | null; }`
- **checkHiring** (function) `(deps: HiringDeps, s: CompanySubject, opts: HiringOptions): Promise<HiringResult>`

## packages/research/src/companies/ppp-size.ts

- **CompanyPlace** (interface) `interface CompanyPlace { id: number; names: string[]; zip: string | null; state: string | null; }`
- **PPP_MODEL** (const) `"ppp-foia"`
- **PppLoan** (type) `type PppLoan = Record<string, string>;`
- **businessNameKey** (function) `(name: string): string`
- **pppFirmographics** (function) `(how: PppMatch, release: string, loans: readonly PppLoan[]): { source: string; release: string; match: PppMatch; jobs_reported: number | null; payroll_yearly_estimate: number | null; franchise: string | null; loans: readonly PppLoan[]; }`
- **pppIndex** (function) `(loans: readonly PppLoan[]): { match(c: CompanyPlace): { how: PppMatch; loans: PppLoan[]; } | null; }`
- **readPppLoans** (function) `(dir: string): { release: string; loans: PppLoan[] }`
- **sizeFromPpp** (function) `(db: Queryable, opts: { dir: string; niche: string }): Promise<PppSizeStats>`

## packages/research/src/companies/profile.ts

- **COMPANY_PAGE_STAGE** (const) `"research.company-page"`
- **CompanyPage** (interface) `interface CompanyPage { name: string; handle: string; url: string; website?: string; phone?: string; industry?: string; size?: string; headquarters?: string; founded?: string | number; type?: string; employees?: string | number; about?: string; text: string; source: string; }`
- **PageSource** (type) `type PageSource = "held" | "people" | "page" | "google" | "companies";`
- **ProfileSubject** (interface) `interface ProfileSubject { companyId: number; firm: Firm; linkedinUrl: string | null; personCompanyUrl?: string | null; pageLinks?: string[]; }`
- **companyPageUrl** (function) `(handle: string): string`
- **firmSite** (function) `(website: string | null | undefined, domain: string | null): boolean`
- **linkedinCompany** (function) `(url: string | null | undefined): string | null`
- **lookUpCompany** (function) `(sites: SiteClient, s: ProfileSubject, opts: ProfileOptions = {}): Promise<ProfileResult>`
- **readCompanyPage** (function) `(call: ReturnType<typeof paced>, url: string, tried: { what: string; outcome: string }[]): Promise<CompanyPage | null>`
- **recordCompanyLookup** (function) `(db: Queryable, companyId: number, r: ProfileResult, runId: string | null = null): Promise<void>`

## packages/research/src/companies/store.ts

- **recordCompanyCheck** (function) `(db: Queryable, companyId: number, r: HiringResult, runId: string | null = null): Promise<void>`
- **recordCompanyEvents** (function) `(db: Queryable, companyId: number, r: EventsResult, runId: string | null = null): Promise<void>`

## packages/research/src/components.ts

- **DOSSIER** (const) `"research.dossier"`
- **LEAD_SHEET** (const) `"research.lead_sheet"`
- **LeadSheetSettings** (type) `type LeadSheetSettings = z.infer<typeof leadSheetSettingsSchema>;`
- **RESEARCH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **RESEARCH_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`
- **SOCIAL** (const) `"research.social"`
- **SocialSettings** (type) `type SocialSettings = z.infer<typeof socialSettingsSchema>;`
- **leadSheetSettingsSchema** (const) `z.ZodObject<{ genericWords: z.ZodDefault<z.ZodArray<z.ZodString>>; crawlHints: z.ZodDefault<z.ZodArray<z.ZodString>>; perPass: z.ZodPrefault<z.ZodObject<{ discover: z.ZodOptional<z.ZodNumber>; verify: z.ZodOptional<z.ZodNumber>; crawl: z.ZodOptional<z.ZodNumber>; render: z.ZodOptional<z.ZodNumber>; …`
- **socialSettingsSchema** (const) `z.ZodObject<{ youtube: z.ZodDefault<z.ZodBoolean>; instagram: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>`

## packages/research/src/discovery/candidates.ts

- **domainCandidates** (function) `(name: string, opts: CandidateOptions = {}): string[]`
- **nameTokens** (function) `(name: string): string[]`

## packages/research/src/discovery/find.ts

- **findHomepage** (function) `(name: string, stated: string | null, deps: FindHomepageDeps): Promise<FoundHomepage | null>`
- **siteName** (function) `(html: string, domain: string): string | null`

## packages/research/src/discovery/gate.ts

- **GateEvidence** (interface) `interface GateEvidence { url: string; matched_tokens: string[]; matched_registry_key: boolean; page_title: string; }`
- **gatePage** (function) `(input: GateInput): GateEvidence | null`
- **registryDigits** (function) `(sourceKey: string | null | undefined): string | null`

## packages/research/src/discovery/homepage.ts

- **politeHomepageFetcher** (function) `(fetcher: Fetcher): HomepageFetcher`

## packages/research/src/discovery/service.ts

- **DISCOVERY_SOURCE_TYPE** (const) `"domain-discovery"`
- **DiscoveryStats** (interface) `interface DiscoveryStats { companies_scanned: number; no_name: number; candidates_tried: number; dns_misses: number; resolver_errors: number; fetch_misses: number; gate_rejections: number; already_claimed: number; domains_attached: number; niche_null_skipped?: number; }`
- **DiscoveryUnitOptions** (interface) `interface DiscoveryUnitOptions { batchId: number; rowNumber: number; genericWords?: ReadonlySet<string>; resolves?: Resolves; fetchHomepage: HomepageFetcher; }`
- **DomainVerificationStats** (interface) `interface DomainVerificationStats { companies_scanned: number; fetch_misses: number; gate_rejections: number; domains_verified: number; niche_null_skipped?: number; unverified_preview: string[]; }`
- **HomepageFetcher** (type) `type HomepageFetcher = (domain: string) => Promise<Page | null>;`
- **Page** (interface) `interface Page { url: string; title: string; text: string; }`
- **Resolves** (type) `type Resolves = (domain: string) => Promise<boolean | null>;`
- **VERIFICATION_SOURCE_TYPE** (const) `"domain-verification"`
- **addDiscoveryStats** (function) `(total: DiscoveryStats, unit: DiscoveryStats): DiscoveryStats`
- **addVerificationStats** (function) `(total: DomainVerificationStats, unit: DomainVerificationStats): DomainVerificationStats`
- **closeDiscoveryBatch** (function) `(db: Queryable, batchId: number, stats: object): Promise<void>`
- **countDiscoveryNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **countVerificationNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **discoverCompany** (function) `(db: Queryable, company: Company, opts: DiscoveryUnitOptions): Promise<DiscoveryStats>`
- **dohResolves** (const) `Resolves`
- **emptyDiscoveryStats** (function) `(): DiscoveryStats`
- **emptyVerificationStats** (function) `(): DomainVerificationStats`
- **openDiscoveryBatch** (function) `(db: Queryable, sourceType: string, opts: { limit?: number; niche?: string | null }): Promise<ImportBatch>`
- **runDomainDiscovery** (function) `(db: Queryable, opts: DiscoveryOptions): Promise<{ batch: ImportBatch; stats: DiscoveryStats }>`
- **runDomainVerification** (function) `(db: Queryable, opts: DomainVerificationOptions): Promise<{ batch: ImportBatch; stats: DomainVerificationStats }>`
- **selectDiscoveryTargets** (function) `(db: Queryable, opts: { limit?: number; niche?: string | null; retryAfterDays?: number }): Promise<Company[]>`
- **selectVerificationTargets** (function) `(db: Queryable, opts: { limit?: number; niche?: string | null; retryAfterDays?: number }): Promise<Company[]>`
- **verifyCompanyDomain** (function) `(db: Queryable, company: Company, opts: DiscoveryUnitOptions): Promise<DomainVerificationStats>`

## packages/research/src/dossier.ts

- **BriefFact** (interface) `interface BriefFact { what: string; text: string; source: string | null; via: string; seen: string; }`
- **Dossier** (interface) `interface Dossier { company: { id: number; name: string | null; domain: string | null; niche: string | null; country: string | null; timezone: string | null; }; facts: Fact[]; people: PersonDossier[]; }`
- **DossierBrief** (interface) `interface DossierBrief { facts: BriefFact[]; posts: { site: string; kind: string; text: string; url: string | null; published: string | null; }[]; people: { name: string; title: string | null; linkedinUrl: string | null; origin: string; facts: BriefFact[]; }[]; }`
- **Fact** (interface) `interface Fact { what: string; value: unknown; confidence: number | null; source: string | null; via: string; seenAt: Date; }`
- **MoreFacts** (interface) `interface MoreFacts { byCompany: ReadonlyMap<number, readonly Fact[]>; byPerson: ReadonlyMap<number, readonly Fact[]>; }`
- **RecentPost** (interface) `interface RecentPost { site: string; kind: string; text: string; url: string | null; publishedAt: Date | null; likes: number | null; comments: number | null; }`
- **dossierBrief** (function) `(d: Dossier): DossierBrief`
- **dossierText** (function) `(d: Dossier): string`
- **dossiers** (function) `(db: Queryable, companyIds: readonly number[]): Promise<Dossier[]>`
- **findCompanyIds** (function) `(db: Queryable, query: string, limit = 10): Promise<number[]>`
- **nicheCompanyIds** (function) `(db: Queryable, niche: string, limit: number, afterId = 0): Promise<number[]>`
- **recentPosts** (function) `(d: Dossier, perSite = POSTS_PER_SITE): RecentPost[]`
- **withFacts** (function) `(list: readonly Dossier[], more: MoreFacts): Dossier[]`

## packages/research/src/enrichment/ad-library.ts

- **AD_LIBRARY_BUCKET** (const) `Bucket`
- **AD_LIBRARY_COMMAND** (const) `"enrich ad-library"`
- **Ad** (interface) `interface Ad { libraryId: string; advertiser: string | null; page?: string | null; url?: string | null; caption?: string | null; [field: string]: unknown; }`
- **AdLibraryStats** (interface) `interface AdLibraryStats { selected: number; read: number; ads: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **adKeywordsDue** (function) `(db: Queryable, keywords: readonly string[], opts: { now: Date; limit: number; country?: string }): Promise<string[]>`
- **adLibraryRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = AD_LIBRARY_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **adLibraryUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; country?: string; platforms?: Iterable<string> }): Promise<AdLibraryUnit>`
- **adRows** (function) `(ads: readonly Ad[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **countAdLibraryUnit** (function) `(s: AdLibraryStats, u: AdLibraryUnit): string | null`
- **emptyAdLibraryStats** (function) `(): AdLibraryStats`
- **mergePageFirm** (function) `(db: Queryable, key: string, domain: string): Promise<PageMerge>`
- **pageFirmPairs** (function) `(db: Queryable): Promise<{ key: string; domain: string }[]>`
- **pageKey** (function) `(ad: Ad): string`

## packages/research/src/enrichment/audit-backfill.ts

- **BackfillStats** (interface) `interface BackfillStats extends Record<string, number> { selected: number; backfilled: number; legacy_pick_lifted: number; free_routes: number; }`
- **backfillCallRecords** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<BackfillStats>`

## packages/research/src/enrichment/contacts.ts

- **CONTACTS_MODEL** (const) `"deterministic"`
- **ContactsStats** (interface) `interface ContactsStats { selected: number; scanned: number; points: number; pages_with_points: number; }`
- **contactsInPage** (function) `(html: string | null, text: string, opts: { tels?: readonly string[] | null; people?: readonly { id: number; first: string | null; last: string | null }[]; } = {}): PagePoint[]`
- **loadContactTarget** (function) `(db: Queryable, id: number): Promise<ContactsTarget | null>`
- **runContacts** (function) `(db: Queryable, opts: ContactsRunOptions = {}): Promise<ContactsStats>`
- **scanContacts** (function) `(db: Queryable, doc: ContactsTarget, runId: string | null = null, pages: PageStore | null = null): Promise<PagePoint[]>`
- **selectContactTargets** (function) `(db: Queryable, opts: { limit?: number | undefined; niche?: string | null | undefined } = {}): Promise<number[]>`
- **socialProfile** (function) `(raw: string): { kind: Social; url: string } | null`

## packages/research/src/enrichment/crawler.ts

- **CrawlStats** (interface) `interface CrawlStats { companies_crawled: number; pages_stored: number; fetch_errors: number; homepage_unreachable: number; robots_warned: number; shells_stored: number; niche_null_skipped: number; dead_skipped: number; remembered_skipped: number; robots_disallowed_urls: string[]; }`
- **EMPTY_HASH** (const) `string`
- **HTTP_TIER** (const) `"httpx"`
- **addCrawlStats** (function) `(total: CrawlStats, unit: CrawlStats): CrawlStats`
- **countCrawlNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **crawlCompany** (function) `(db: Queryable, fetcher: Fetcher, company: Pick<Company, "id" | "domain">, opts: CrawlCompanyOptions = {}): Promise<CrawlStats>`
- **emptyCrawlStats** (function) `(): CrawlStats`
- **pageRow** (function) `(companyId: number | null, url: string, resp: FetchResponse, opts: { robotsDisallowed?: boolean } = {}): { companyId: number | null; url: string; finalUrl: string | null; kind: "webpage"; statusCode: number; contentHash: string; title: string | null; text: string; html: string; fetchTier: string; isShell: boolean; robotsDisallowed: boolean; }`
- **robotsDisallows** (function) `(fetcher: Fetcher, url: string, cache: RobotsCache, stats: RobotsCounters): Promise<boolean>`
- **runCrawl** (function) `(db: Queryable, fetcher: Fetcher, opts: CrawlRunOptions = {}): Promise<CrawlStats>`
- **selectCrawlTargets** (function) `(db: Queryable, opts: CrawlSelectOptions = {}): Promise<Company[]>`
- **stripNul** (function) `(s: string): string`

## packages/research/src/enrichment/email-pick/graph.ts

- **ClassifyOptions** (interface) `interface ClassifyOptions { runId?: string | null | undefined; tracer?: Tracer | null | undefined; }`
- **FREE_PICK_METHODS** (const) `ReadonlySet<string>`
- **PICK_VERSION** (const) `"v3"`
- **Pick** (interface) `interface Pick { method: PickMethod; emails: ClassifiedEmail[]; best_send_to: string | null; notes?: string | null; ungrounded?: string[]; ungrounded_names?: string[]; }`
- **PickOutcome** (interface) `interface PickOutcome { pick: Pick; llm: Envelope | null; parse_error: string | null; provider_rejected: string | null; }`
- **PickState** (interface) `interface PickState { company: PickCompany; signals: EmailSignal[]; people: PickPerson[]; no_scannable: boolean; }`
- **RULES_PICKER** (const) `"deterministic"`
- **Route** (type) `type Route = "no_content" | "empty_verdict" | "auto_accept" | "classify";`
- **buildPickPrompt** (function) `(state: PickState): string`
- **byRules** (function) `(state: PickState): Pick`
- **classify** (function) `(llm: LlmClient, state: PickState, opts: ClassifyOptions = {}): Promise<PickOutcome>`
- **ground** (function) `(state: PickState, pick: Pick): Pick`
- **parsePick** (function) `(text: string): PickResult | string`
- **route** (function) `(state: PickState): Route`
- **runPickGraph** (function) `(llm: LlmClient | null, state: PickState, opts: ClassifyOptions = {}): Promise<PickOutcome>`

## packages/research/src/enrichment/email-pick/run.ts

- **ApplyPicksStats** (interface) `interface ApplyPicksStats extends Record<string, unknown> { picks_applied: number; person_emails: number; people_from_addresses: number; role_leads: number; companies_without_send_to: number; }`
- **EmailPickStats** (interface) `interface EmailPickStats { selected: number; picked: number; auto_accepted: number; no_signals: number; no_content: number; classified: number; parse_errors: number; provider_rejected: number; ungrounded_emails: number; ungrounded_names: number; aborted: string | null; }`
- **applyPicks** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<ApplyPicksStats>`
- **gatherState** (function) `(db: Queryable, company: Company): Promise<PickState>`
- **pickCompany** (function) `(db: Queryable, llm: LlmClient | null, company: Company, opts: PickUnitOptions = {}): Promise<PickOutcome>`
- **runEmailPick** (function) `(db: Queryable, llm: LlmClient | null, opts: EmailPickRunOptions = {}): Promise<EmailPickStats>`
- **selectPickTargets** (function) `(db: Queryable, llm: LlmClient | null, opts: PickSelectOptions = {}): Promise<Company[]>`

## packages/research/src/enrichment/email-scan.ts

- **EmailSignal** (interface) `interface EmailSignal { email: string; source: SignalSource; context: string; page_url: string; on_domain: boolean; }`
- **SCAN_MODEL** (const) `"deterministic"`
- **SCAN_VERSION** (const) `"v3"`
- **ScanStats** (interface) `interface ScanStats { selected: number; scanned: number; signals: number; pages_with_signals: number; }`
- **SignalSource** (type) `type SignalSource = "mailto" | "text" | "markup" | "deobfuscated";`
- **loadScanTarget** (function) `(db: Queryable, id: number): Promise<ScanTarget | null>`
- **runScan** (function) `(db: Queryable, opts: ScanRunOptions = {}): Promise<ScanStats>`
- **scanDocument** (function) `(db: Queryable, doc: ScanTarget, runId: string | null = null, pages: PageStore | null = null): Promise<EmailSignal[]>`
- **scanPage** (function) `(html: string | null, text: string, opts: { pageUrl: string; companyDomain: string | null | undefined }): EmailSignal[]`
- **selectScanTargets** (function) `(db: Queryable, opts: ScanSelectOptions = {}): Promise<ScanTarget[]>`

## packages/research/src/enrichment/exa-search.ts

- **EXA_SEARCH_BUCKET** (const) `Bucket`
- **EXA_SEARCH_COMMAND** (const) `"enrich exa-search"`
- **ExaFirm** (interface) `interface ExaFirm { url: string; title: string | null; domain: string; raw: unknown; }`
- **ExaSearchStats** (interface) `interface ExaSearchStats { selected: number; read: number; results: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **countExaSearchUnit** (function) `(s: ExaSearchStats, u: ExaSearchUnit): string | null`
- **emptyExaSearchStats** (function) `(): ExaSearchStats`
- **exaPageKey** (function) `(url: string): string`
- **exaRef** (function) `(q: string): string`
- **exaRows** (function) `(results: readonly ExaFirm[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **exaSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = EXA_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **exaSearchUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; n?: number; platforms?: Iterable<string> }): Promise<ExaSearchUnit>`
- **exaSearches** (function) `(queries: readonly string[], cities: readonly string[]): string[]`
- **exaSearchesDue** (function) `(db: Queryable, searches: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`

## packages/research/src/enrichment/extraction.ts

- **ApplyExtractionsStats** (interface) `interface ApplyExtractionsStats extends Record<string, unknown> { enrichments_applied: number; }`
- **DEFAULT_EXTRACTION_SPEC** (const) `ExtractionSpec`
- **ExtractedPerson** (const) `z.ZodObject<{ full_name: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; title: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; email: z.ZodPipe<z.ZodOptional<z.ZodNullable…`
- **ExtractionSpec** (interface) `interface ExtractionSpec { promptVersion: string; prompt: string; }`
- **ExtractionStats** (interface) `interface ExtractionStats { selected: number; extracted: number; parse_errors: number; provider_rejected: number; ungrounded_emails: number; skipped_older_version: number; aborted: string | null; }`
- **PROMPT_VERSION** (const) `"v2"`
- **applyExtractions** (function) `(db: Queryable, opts: { limit?: number; spec?: ExtractionSpec } = {}): Promise<ApplyExtractionsStats>`
- **buildExtractionPrompt** (function) `(document: PromptDocument, spec: ExtractionSpec = DEFAULT_EXTRACTION_SPEC): string`
- **extractDocument** (function) `(db: Queryable, llm: LlmClient, doc: ExtractionTarget, opts: ExtractionUnitOptions = {}): Promise<{ outcome: ExtractionOutcome; ungrounded: string[] }>`
- **groundEmails** (function) `(parsed: ExtractionResult, pageText: string): { parsed: ExtractionResult; dropped: string[] }`
- **loadExtractionTarget** (function) `(db: Queryable, id: number): Promise<ExtractionTarget | null>`
- **parseExtraction** (function) `(text: string): ExtractionResult | string`
- **runExtraction** (function) `(db: Queryable, llm: LlmClient, opts: ExtractionRunOptions = {}): Promise<ExtractionStats>`
- **selectExtractionTargets** (function) `(db: Queryable, llm: LlmClient, opts: ExtractionSelectOptions = {}): Promise<{ targets: ExtractionTarget[]; skippedOlderVersion: number }>`

## packages/research/src/enrichment/fb-groups.ts

- **FB_GROUPS_COMMAND** (const) `"enrich fb-groups"`
- **FbGroupsStats** (interface) `interface FbGroupsStats { selected: number; searches: number; groups_found: number; groups_new: number; posts_new: number; abouts: number; posts: number; mapped: number; errors: number; stopped: string | null; }`
- **GROUP_READ_BUCKET** (const) `Bucket`
- **GROUP_SEARCH_BUCKET** (const) `Bucket`
- **countFbGroupsUnit** (function) `(s: FbGroupsStats, u: FbGroupsUnit): string | null`
- **emptyFbGroupsStats** (function) `(): FbGroupsStats`
- **groupAboutUnit** (function) `(db: Queryable, sites: SiteClient, r: { groupId: number; group: string }): Promise<FbGroupsUnit>`
- **groupKeywordsDue** (function) `(db: Queryable, niche: string, keywords: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **groupPostUnit** (function) `(db: Queryable, sites: SiteClient, r: { postId: number; group: string; post: string }): Promise<FbGroupsUnit>`
- **groupReadRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = GROUP_READ_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **groupReadsDue** (function) `(db: Queryable, niche: string, opts: { now: Date; limit: number }): Promise<GroupRead[]>`
- **groupSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = GROUP_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **groupSearchUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; n?: number }): Promise<FbGroupsUnit>`
- **linkDomains** (function) `(links: string | null | undefined): string[]`
- **mapPosts** (function) `(db: Queryable, niche: string, now: Date): Promise<MapStats>`
- **wordsOf** (function) `(s: string): string[]`

## packages/research/src/enrichment/instagram.ts

- **INSTAGRAM_BUCKET** (const) `Bucket`
- **INSTAGRAM_COMMAND** (const) `"enrich instagram"`
- **INSTAGRAM_MIN_BATCH** (const) `30`
- **InstagramAnswer** (type) `type InstagramAnswer = | { found: true; profile: InstagramProfile; media: InstagramMedia[] } | { found: false; reason: string };`
- **InstagramStats** (interface) `interface InstagramStats { selected: number; read: number; missing: number; posts: number; errors: number; stopped: string | null; }`
- **countInstagramUnit** (function) `(stats: InstagramStats, u: InstagramUnit, streak: { errors: number }): string | null`
- **emptyInstagramStats** (function) `(): InstagramStats`
- **instagramDue** (function) `(id: SQL): SQL<unknown>`
- **instagramFindings** (function) `(companyId: number, link: string, read: { profile: InstagramProfile; media: InstagramMedia[] } | { missing: string }): CompanyFindingDraft[]`
- **instagramRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = INSTAGRAM_BUCKET, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **instagramUnit** (function) `(db: Queryable, sites: SiteClient, w: InstagramWork): Promise<InstagramUnit>`
- **instagramUser** (function) `(link: string): { user: string } | { missing: string }`
- **instagramWaitMs** (function) `(room: number, nextInMs: number, want = INSTAGRAM_MIN_BATCH, bucket: Bucket = INSTAGRAM_BUCKET): number`
- **instagramWork** (function) `(db: Queryable, opts: { niche: string | null; limit: number }): Promise<InstagramWork[]>`

## packages/research/src/enrichment/news-triggers.ts

- **TRIGGERS_BUCKET** (const) `Bucket`
- **TRIGGERS_COMMAND** (const) `"enrich triggers"`
- **TRIGGERS_SOURCE** (const) `"news_trigger"`
- **TriggersStats** (interface) `interface TriggersStats { selected: number; read: number; hits: number; named: number; matched: number; created: number; kept: number; errors: number; stopped: string | null; }`
- **countTriggerUnit** (function) `(s: TriggersStats, u: TriggerUnit): void`
- **emptyTriggersStats** (function) `(): TriggersStats`
- **triggerHits** (function) `(hits: readonly EventHit[], now: Date, kinds: readonly EventKind[] = TRIGGER_KINDS): CompanyEvent[]`
- **triggerKey** (function) `(name: string): string | null`
- **triggerQuery** (function) `(word: string, kinds: readonly EventKind[] = TRIGGER_KINDS): string`
- **triggerUnit** (function) `(db: Queryable, deps: { fetcher: Fetcher; llm: LlmClient }, w: { word: string; niche: string; now: Date }): Promise<TriggerUnit>`
- **triggersDue** (function) `(db: Queryable, words: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **triggersRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = TRIGGERS_BUCKET): Promise<{ room: number; nextInMs: number }>`

## packages/research/src/enrichment/opener.ts

- **OPENER_MAX_WORDS** (const) `25`
- **OPENER_VERSION** (const) `"v1"`
- **Opener** (interface) `interface Opener { line: string; quote: string; source_url: string; }`
- **OpenerProposal** (const) `z.ZodObject<{ line: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; quote: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; source_url: z.ZodPipe<z.ZodOptional<z.ZodNullable…`
- **OpenerStats** (interface) `interface OpenerStats { selected: number; written: number; no_line: number; rejected: Partial<Record<OpenerRejection, number>>; parse_errors: number; provider_rejected: number; no_pages: number; aborted: string | null; }`
- **SitePage** (interface) `interface SitePage { url: string; text: string; fetchedAt: Date; }`
- **buildOpenerPrompt** (function) `(company: string, pages: readonly EvidencePage[]): string`
- **countOpener** (function) `(stats: OpenerStats, unit: { outcome: OpenerOutcome; rejected: OpenerRejection | null }): void`
- **emptyOpenerStats** (function) `(selected: number): OpenerStats`
- **groundOpener** (function) `(proposal: OpenerProposal, pages: readonly EvidencePage[], companyName = ""): { opener: Opener | null; rejected: OpenerRejection | null }`
- **openerEvidence** (function) `(pages: readonly SitePage[]): EvidencePage[]`
- **runOpener** (function) `(db: Queryable, llm: LlmClient, opts: OpenerSelectOptions & OpenerUnitOptions = {}): Promise<OpenerStats>`
- **selectOpenerTargets** (function) `(db: Queryable, llm: LlmClient, opts: OpenerSelectOptions = {}): Promise<number[]>`
- **writeOpener** (function) `(db: Queryable, llm: LlmClient, companyId: number, opts: OpenerUnitOptions = {}): Promise<{ outcome: OpenerOutcome; rejected: OpenerRejection | null }>`

## packages/research/src/enrichment/profiles.ts

- **GOOGLE_PER_DAY** (const) `400`
- **PROFILES_COMMAND** (const) `"enrich profiles"`
- **ProfileStats** (interface) `interface ProfileStats { selected: number; people_matched: number; people_unresolved: number; companies_matched: number; companies_unresolved: number; google: number; errors: number; stopped: string | null; }`
- **ProfileUnit** (interface) `interface ProfileUnit { personId: number; person: LookupState | "error"; company: LookupState | "done" | "skipped" | "error"; google: number; googleStopped: boolean; capped: boolean; linkedinCappedUntil: string | null; failedRead: boolean; error: string | null; }`
- **countProfileUnit** (function) `(stats: ProfileStats, u: ProfileUnit, streak: { errors: number }): string | null`
- **emptyProfileStats** (function) `(): ProfileStats`
- **googleLeft** (function) `(db: Queryable, opts: { now: Date; timezone: string; perDay?: number; signals?: number; also?: Queryable | null }): Promise<number>`
- **linkedinLinks** (function) `(html: string, who: { first: string | null; last: string | null }): { people: string[]; companies: string[] }`
- **linkedinParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **profileUnit** (function) `(db: Queryable, sites: SiteClient, work: ProfileWork, opts: { googleLeft: number; linkedin?: string | null; linkedinCappedUntil?: Date | null; ledger?: ReadLedger | null; runId?: string | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<ProfileUnit>`
- **profileWork** (function) `(db: Queryable, personIds: readonly number[], opts: { limit?: number; again?: boolean; pages?: PageStore | null } = {}): Promise<ProfileWork[]>`
- **profilesParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **runProfiles** (function) `(db: Queryable, sites: SiteClient, opts: RunProfilesOptions): Promise<ProfileStats>`

## packages/research/src/enrichment/readings.ts

- **ReadingFirm** (interface) `interface ReadingFirm { company_id: number; name: string | null; domain: string | null; pages: ReadingPage[]; }`
- **ReadingResult** (const) `z.ZodObject<{ company_id: z.ZodNumber; people: z.ZodDefault<z.ZodArray<z.ZodObject<{ full_name: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; title: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, st…`
- **exportReadings** (function) `(db: Queryable, opts: { niche: string; reader: string; limit?: number; maxPerFirm?: number }): Promise<ReadingFirm[]>`
- **leadershipExcerpt** (function) `(text: string, radius = 2, max = 1500): string`
- **loadReadings** (function) `(db: Queryable, opts: { reader: string; promptVersion: string; exported: ReadingFirm[]; results: ReadingResult[]; }): Promise<LoadReadingsStats>`

## packages/research/src/enrichment/remote-browser.ts

- **CdpBrowser** (interface) `interface CdpBrowser { contexts(): CdpContext[]; newContext(opts: { userAgent: string }): Promise<CdpContext>; close(): Promise<void>; }`
- **CdpContext** (interface) `interface CdpContext { setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>; route(url: string, handler: (route: CdpRoute) => Promise<void> | void): Promise<void>; newPage(): Promise<CdpPage>; clearCookies(): Promise<void>; }`
- **CdpPage** (interface) `interface CdpPage { goto( url: string, opts: { waitUntil: "load"; timeout: number }, ): Promise<{ status(): number } | null>; waitForTimeout(ms: number): Promise<void>; content(): Promise<string>; url(): string; close(): Promise<void>; }`
- **browserbaseRenderer** (function) `(userAgent: string, opts: BrowserbaseOptions): Promise<BrowserRenderer>`
- **cdpRenderer** (function) `(userAgent: string, opts: CdpOptions): Promise<BrowserRenderer>`
- **openSession** (function) `(opts: Pick<BrowserbaseOptions, "apiKey" | "projectId" | "fetch">): Promise<SessionResponse>`

## packages/research/src/enrichment/render.ts

- **BrowserRenderer** (interface) `interface BrowserRenderer { render: Renderer; close(): Promise<void>; }`
- **DEFAULT_LADDER_LIMIT** (const) `40`
- **RenderStats** (interface) `interface RenderStats { companies_rendered: number; pages_stored: number; still_shell: number; render_errors: number; robots_warned: number; homepage_unrendered: number; niche_null_skipped: number; ladder_requests: number; ladder_pages: number; ladder_dead: number; robots_disallowed_urls: string[]; }`
- **RenderUnavailable** (class) `override name`
- **RenderedPage** (interface) `interface RenderedPage { html: string; finalUrl: string; statusCode: number | null; }`
- **Renderer** (type) `type Renderer = (url: string) => Promise<RenderedPage>;`
- **addRenderStats** (function) `(total: RenderStats, unit: RenderStats): RenderStats`
- **browserRenderer** (function) `(userAgent: string): Promise<BrowserRenderer>`
- **climbCompany** (function) `(db: Queryable, ladder: LadderRun, robotsFetcher: Fetcher, company: Pick<Company, "id" | "domain">, robots: RobotsCache, opts: RenderCompanyOptions = {}): Promise<RenderStats>`
- **countRenderNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **emptyRenderStats** (function) `(): RenderStats`
- **renderCompany** (function) `(db: Queryable, renderer: Renderer, robotsFetcher: Fetcher, company: Pick<Company, "id" | "domain">, robots: RobotsCache, opts: RenderCompanyOptions = {}): Promise<RenderStats>`
- **runRender** (function) `(db: Queryable, renderer: Renderer, robotsFetcher: Fetcher, opts: RenderRunOptions = {}): Promise<RenderStats>`
- **selectRenderTargets** (function) `(db: Queryable, opts: RenderSelectOptions = {}): Promise<RenderTargets>`

## packages/research/src/enrichment/shard.ts

- **Shard** (class) `parse(text: string): Shard; of(index: number, count: number): Shard; where(idColumn: PgColumn): SQL; toString(): string`

## packages/research/src/enrichment/shared-pages.ts

- **sharedPages** (function) `(main: Db, inner: Fetcher, store?: PageStore | null): Fetcher`

## packages/research/src/enrichment/store.ts

- **upsertEnrichment** (function) `(db: Queryable, input: UpsertEnrichment): Promise<Enrichment>`

## packages/research/src/enrichment/team.ts

- **TEAM_BUCKET** (const) `Bucket`
- **TEAM_COMMAND** (const) `"enrich team"`
- **TeamStats** (interface) `interface TeamStats { selected: number; firms_matched: number; firms_unresolved: number; firms_skipped: number; people_added: number; people_filled: number; errors: number; stopped: string | null; }`
- **countTeamUnit** (function) `(stats: TeamStats, u: TeamUnit, streak: { errors: number }): string | null`
- **emptyTeamStats** (function) `(): TeamStats`
- **teamDue** (function) `(id: SQL): SQL<unknown>`
- **teamParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **teamRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = TEAM_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **teamUnit** (function) `(db: Queryable, sites: SiteClient, work: TeamWork, opts: { runId?: string | null; now?: () => Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<TeamUnit>`
- **teamWork** (function) `(db: Queryable, companyIds: readonly number[], opts: { limit?: number } = {}): Promise<TeamWork[]>`

## packages/research/src/enrichment/testimonials.ts

- **TagTestimonialsStats** (interface) `interface TagTestimonialsStats extends Record<string, unknown> { scanned: number; tagged: number; skipped_already_tagged: number; dry_run: boolean; candidates?: TestimonialCandidate[]; }`
- **classifyTitle** (function) `(title: string | null | undefined, opts: { companyName: string | null | undefined; documentUrl?: string | null | undefined }): TestimonialTag | null`
- **documentUrlFrom** (function) `(person: Pick<Person, "originRef" | "raw">): string | null`
- **isOwnCompany** (function) `(org: string, companyName: string | null | undefined): boolean`
- **tagTestimonials** (function) `(db: Queryable, opts: TagTestimonialsOptions): Promise<TagTestimonialsStats>`

## packages/research/src/enrichment/urls.ts

- **PEOPLE_PAGE_HINTS** (const) `readonly string[]`
- **looksLikePeoplePage** (function) `(url: string, anchor: string, hints: readonly string[]): boolean`
- **parseUrl** (function) `(url: string): URL | null`
- **peoplePageCandidates** (function) `(links: ReadonlyArray<{ url: string; anchor: string }>, domain: string, hints: readonly string[]): string[]`
- **sameHost** (function) `(url: string, domain: string): boolean`

## packages/research/src/enrichment/youtube-search.ts

- **FoundChannel** (interface) `interface FoundChannel { id: string; snippet?: { title?: string; description?: string }; [part: string]: unknown; }`
- **YOUTUBE_SEARCH_BUCKET** (const) `Bucket`
- **YOUTUBE_SEARCH_COMMAND** (const) `"enrich youtube-search"`
- **YouTubeSearchStats** (interface) `interface YouTubeSearchStats { selected: number; read: number; channels: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **channelSite** (function) `(about: string, platforms: Iterable<string> = []): string | null`
- **countYouTubeSearchUnit** (function) `(s: YouTubeSearchStats, u: YouTubeSearchUnit): string | null`
- **emptyYouTubeSearchStats** (function) `(): YouTubeSearchStats`
- **searchChannels** (function) `(get: YouTubeGet, q: string): Promise<FoundChannel[]>`
- **youtubeSearchRef** (function) `(q: string): string`
- **youtubeSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = YOUTUBE_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **youtubeSearchRows** (function) `(channels: readonly FoundChannel[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **youtubeSearchUnit** (function) `(db: Queryable, get: YouTubeGet, w: { q: string; niche: string; platforms?: Iterable<string> }): Promise<YouTubeSearchUnit>`
- **youtubeSearchesDue** (function) `(db: Queryable, searches: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`

## packages/research/src/enrichment/youtube.ts

- **CHANNEL_PARTS** (const) `"snippet,contentDetails,statistics,brandingSettings,topicDetails,status,localizations"`
- **Channel** (interface) `interface Channel { id: string; title: string; handle: string | null; about: string; country: string | null; subscribers: number | null; videos: number | null; views: number | null; keywords: string | null; topics: string[]; publishedAt: string | null; uploads: string | null; raw: unknown; }`
- **READ_UNITS** (const) `3`
- **Upload** (interface) `interface Upload { videoId: string; title: string; description: string; publishedAt: string; views: number | null; likes: number | null; comments: number | null; seconds: number | null; tags: string[]; live: boolean; raw: unknown; }`
- **YOUTUBE_BUCKET** (const) `Bucket`
- **YOUTUBE_COMMAND** (const) `"enrich youtube"`
- **YOUTUBE_MIN_BATCH** (const) `100`
- **YOUTUBE_READ_SCOPE** (const) `"https://www.googleapis.com/auth/youtube.readonly"`
- **YouTubeError** (class) `constructor(readonly status: number, readonly reason: string, message: string); get quota(): boolean`
- **YouTubeGet** (type) `type YouTubeGet = (resource: string, query: Record<string, string>) => Promise<unknown>;`
- **YouTubeStats** (interface) `interface YouTubeStats { selected: number; read: number; missing: number; uploads: number; errors: number; stopped: string | null; }`
- **channelRef** (function) `(link: string): ChannelRef | { missing: string }`
- **clientYouTube** (function) `(o: { client: string; keys: VendorKeys; wren: YouTubeGet; own: (key: string) => YouTubeGet; part: string; runId?: string | null; }): YouTubeGet`
- **countYouTubeUnit** (function) `(stats: YouTubeStats, u: YouTubeUnit, streak: { errors: number }): string | null`
- **emptyYouTubeStats** (function) `(): YouTubeStats`
- **readChannel** (function) `(get: YouTubeGet, ref: ChannelRef): Promise<Channel | null>`
- **readUploads** (function) `(get: YouTubeGet, playlistId: string, limit = UPLOADS): Promise<Upload[]>`
- **seconds** (function) `(iso: string | undefined): number | null`
- **youtubeApi** (function) `(token: () => Promise<string>, fetch: typeof globalThis.fetch = globalThis.fetch): YouTubeGet`
- **youtubeDue** (function) `(id: SQL): SQL<unknown>`
- **youtubeFindings** (function) `(companyId: number, link: string, read: { channel: Channel; uploads: Upload[] } | { missing: string }): CompanyFindingDraft[]`
- **youtubeKeyApi** (function) `(key: string, fetch: typeof globalThis.fetch = globalThis.fetch): YouTubeGet`
- **youtubeReadRoom** (function) `(db: Queryable, main: Queryable, client: string | null, now: Date, bucket: Bucket = YOUTUBE_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **youtubeRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = YOUTUBE_BUCKET, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **youtubeUnit** (function) `(db: Queryable, get: YouTubeGet, w: YouTubeWork): Promise<YouTubeUnit>`
- **youtubeWork** (function) `(db: Queryable, opts: { niche: string | null; limit: number }): Promise<YouTubeWork[]>`

## packages/research/src/fetch/datasets.ts

- **Dataset** (interface) `interface Dataset { name: string; description: string; listFiles: (fetcher: PoliteFetcher, limit: number) => Promise<RemoteFile[]>; download?: (fetcher: PoliteFetcher, remote: RemoteFile, dest: string) => Promise<DownloadResult>; }`
- **RemoteFile** (interface) `interface RemoteFile { dataset: string; fileName: string; url: string; period: string; }`
- **fetchDataset** (function) `(fetcher: PoliteFetcher, dataset: Dataset, opts: { limit: number; destRoot: string; onFile?: (file: FetchedFile) => void }): Promise<FetchedFile[]>`

## packages/research/src/fetch/overture.ts

- **OVERTURE_BUCKET** (const) `"overturemaps-us-west-2"`
- **OverturePlacesSpec** (interface) `interface OverturePlacesSpec { name: string; description: string; categories: readonly string[]; countries: readonly string[]; }`
- **overturePlaces** (function) `(spec: OverturePlacesSpec): Dataset`
- **parseReleases** (function) `(listingXml: string): string[]`
- **placesCopySql** (function) `(spec: OverturePlacesSpec, release: string, dest: string): string`

## packages/research/src/fetch/ppp.ts

- **PPP_DATASET_PAGE** (const) `"https://data.sba.gov/dataset/ppp-foia"`
- **filterLoanCsv** (function) `(input: Readable, output: NodeJS.WritableStream, naics: ReadonlySet<string>): Promise<{ read: number; kept: number }>`
- **parsePppFileLinks** (function) `(html: string): { fileName: string; url: string; release: string }[]`
- **pppLoans** (function) `(spec: PppLoansSpec): Dataset`

## packages/research/src/fetch/sba.ts

- **SBA_SEARCH_URL** (const) `"https://search.certifications.sba.gov/_api/v2/search"`
- **checkSbaAnswer** (function) `(text: string, naics: string): number`
- **sbaSearch** (function) `(spec: SbaSearchSpec, today = () => new Date()): Dataset`
- **sbaSearchBody** (function) `(naics: string): Record<string, unknown>`

## packages/research/src/findings.ts

- **CompanyFindingDraft** (interface) `interface CompanyFindingDraft extends Draft { companyId: number; }`
- **DocumentDraft** (interface) `interface DocumentDraft { url: string; kind: Exclude<DocumentKind, "pdf">; title: string | null; text: string; fetchTier: string; }`
- **FindingDraft** (interface) `interface FindingDraft extends Draft { personId: number; }`
- **SignalDraft** (type) `type SignalDraft = (FindingDraft | CompanyFindingDraft) & { signalAt: Date; dated: SignalDated; };`
- **keepDocument** (function) `(db: Queryable, draft: DocumentDraft): Promise<number>`
- **keepFinding** (function) `(db: Queryable, draft: FindingDraft | CompanyFindingDraft): Promise<number>`
- **keepSignal** (function) `(db: Queryable, draft: SignalDraft): Promise<{ ok: true; id: number } | { ok: false; reason: string }>`
- **keepingAnswers** (function) `(sites: SiteClient, db: Queryable): SiteClient`
- **signalDate** (function) `(d: Pick<Draft, "kind" | "value" | "sourceUrl" | "signalAt" | "dated">, now: Date = new Date()): { at: Date; dated: SignalDated } | null`
- **signalRefusal** (function) `(d: Draft): string | null`

## packages/research/src/limits.ts

- **AD_LIBRARY_LIMIT** (const) `LimitDef`
- **EXA_SEARCH_LIMIT** (const) `LimitDef`
- **GROUP_READ_LIMIT** (const) `LimitDef`
- **GROUP_SEARCH_LIMIT** (const) `LimitDef`
- **INSTAGRAM_LIMIT** (const) `LimitDef`
- **RESEARCH_LIMITS** (const) `readonly LimitDef[]`
- **TEAM_LIMIT** (const) `LimitDef`
- **TRIGGERS_LIMIT** (const) `LimitDef`
- **YOUTUBE_LIMIT** (const) `LimitDef`
- **YOUTUBE_SEARCH_LIMIT** (const) `LimitDef`
- **collectorsWithLimits** (function) `(main: Queryable, collectors: readonly C[]): Promise<C[]>`
- **googleLimits** (function) `(main: Queryable): Promise<{ perDay: number; signals: number }>`

## packages/research/src/linkedin-reads.ts

- **ACCOUNT_VENDOR** (const) `"linkedin"`
- **ReadLedger** (interface) `interface ReadLedger { room(): Promise<number>; served(source: ReadSource, units?: number): Promise<void>; }`
- **ReadSource** (type) `type ReadSource = "search" | "account";`
- **SEARCH_VENDOR** (const) `"linkedin_search"`
- **accountRoom** (function) `(main: Queryable, client: string | null, now: Date = new Date()): Promise<number>`
- **idTime** (function) `(id: string, now: Date): Date | null`
- **postOfUrl** (function) `(url: string): { vanity: string; urn: string; id: string } | null`
- **readLedger** (function) `(main: Db, o: { client: string | null; part: string; runId?: string | null }): ReadLedger`
- **vendorOfSource** (function) `(s: ReadSource): string`

## packages/research/src/pacing.ts

- **Capped** (class) `constructor(readonly site: string, readonly retryAt: Date, readonly why: string)`
- **Stopped** (interface) `interface Stopped { until: Date | null; why: string; }`
- **failedRead** (function) `(err: unknown, site: string): boolean`
- **paced** (function) `(sites: SiteClient, clock: () => Date, sleep: (ms: number) => Promise<void>): <T>(site: string, method: import("@wren/core/content").SiteMethod, path: string, input?: Record<string, unknown> | undefined, account?: string | undefined) => Promise<T>`
- **realSleep** (function) `(ms: number): Promise<void>`
- **refusedBy** (function) `(err: unknown): number | null`
- **retryAfter** (function) `(err: unknown): number | null`
- **searchStopped** (function) `(err: unknown, site: string): Stopped | null`

## packages/research/src/pages.ts

- **ArchiveStats** (interface) `interface ArchiveStats { moved: number; chars: number; more: boolean; }`
- **PageStore** (interface) `interface PageStore { put(key: string, html: string): Promise<void>; get(key: string): Promise<string>; }`
- **archivePages** (function) `(db: Queryable, store: PageStore, opts: ArchiveOptions): Promise<ArchiveStats>`
- **htmlOf** (function) `(doc: { html: string | null; htmlKey: string | null }, store: PageStore | null | undefined): Promise<string | null>`
- **memoryPageStore** (function) `(): PageStore & { keys(): string[] }`
- **pageCounts** (function) `(db: Queryable): Promise<{ inline: number; archived: number }>`
- **s3PageStore** (function) `(bucket: string, client: S3Client = new S3Client({})): PageStore`
- **telHrefs** (function) `(html: string): string[]`
- **pageKey** (function) `(documentId: number): string`

## packages/research/src/people/contacts.ts

- **findContacts** (function) `(sites: SiteClient, firm: Firm, opts: ContactsOptions = {}): Promise<FoundContact[]>`
- **splitName** (function) `(full: string): { first: string; last: string } | null`

## packages/research/src/people/elsewhere.ts

- **ElsewhereHit** (interface) `interface ElsewhereHit { kind: "handle" | "link"; platform: string; value: string; url: string; title: string; confidence: number; matched: { name: boolean; firm: boolean; handle: boolean }; query: string; }`
- **ElsewhereSubject** (interface) `interface ElsewhereSubject { firstName: string | null; lastName: string | null; firm: Firm; handles: { platform: string; handle: string }[]; }`
- **HITS_PER_QUERY** (const) `8`
- **nameIn** (function) `(title: string): string`
- **pageOf** (function) `(url: string, title: string, subject: ElsewhereSubject): Page | null`
- **queriesFor** (function) `(s: ElsewhereSubject): string[]`
- **searchElsewhere** (function) `(call: <T>(...args: Parameters<SiteClient["call"]>) => Promise<T>, s: ElsewhereSubject): Promise<ElsewhereRun>`
- **Page** (interface) `interface Page { kind: "handle" | "link"; platform: string; value: string; url: string; }`

## packages/research/src/people/fit-traits.ts

- **fitTraitsOf** (function) `(db: Queryable, profile: number, facts: ProfileFacts): Promise<PersonTraits>`

## packages/research/src/people/lookup.ts

- **CACHE_VIA** (const) `"exa-cache"`
- **LookupOptions** (interface) `interface LookupOptions { linkedin: string | null; google?: boolean; linkedinCappedUntil?: Date | null; accountReads?: number; elsewhere?: boolean; now?: () => Date; sleep?: (ms: number) => Promise<void>; }`
- **LookupResult** (interface) `interface LookupResult { state: LookupState; profile: ProfileLink | null; findings: FindingDraft[]; tried: Tried[]; retryAt: Date | null; cappedBy: string | null; pages: DocumentDraft[]; googleStopped: Stopped | null; accountReads: number; elsewhere?: ElsewhereHit[]; }`
- **LookupSubject** (interface) `interface LookupSubject { personId: number | null; firstName: string | null; lastName: string | null; firm: Firm; linkedinUrl: string | null; pageLinks?: string[]; email: { address: string; result: string; verifier: string } | null; handles?: { platform: string; handle: string }[]; }`
- **Tried** (interface) `interface Tried { step: | "email" | "cache" | "google" | "search" | "profile" | "linkedin search" | "elsewhere" | "capped"; what: string; outcome: string; }`
- **emailFindings** (function) `(s: LookupSubject): FindingDraft[]`
- **lookUpPerson** (function) `(sites: SiteClient, s: LookupSubject, opts: LookupOptions): Promise<LookupResult>`
- **searched** (function) `(t: { step: string; what: string }): boolean`

## packages/research/src/people/names.ts

- **Firm** (interface) `interface Firm { name: string | null; domain: string | null; }`
- **bareCompanyName** (function) `(name: string): string`
- **companyPhrase** (function) `(name: string): string`
- **domainLabel** (function) `(domain: string): string`
- **firmNames** (function) `(firm: Firm): string[]`
- **isFirm** (function) `(name: string, firm: Firm): boolean`
- **mentionsFirm** (function) `(text: string, firm: Firm, except: string[] = []): boolean`
- **plain** (function) `(s: string): string`
- **sameCompany** (function) `(a: string, b: string): boolean`
- **sameName** (function) `(want: NameParts, seen: string): boolean`

## packages/research/src/people/profile-link.ts

- **ProfileLink** (interface) `interface ProfileLink { url: string; vanity: string; }`
- **linkedinProfile** (function) `(url: string): ProfileLink | null`

## packages/research/src/people/profile-research.ts

- **ProfileFacts** (interface) `interface ProfileFacts { name: string | null; emails: string[]; handles: { platform: string; handle: string; url: string | null }[]; person: { fullName: string; firstName: string | null; lastName: string | null; title: string | null; company: string | null; domain: string | null; linkedinUrl: string | null; } | null; employers: string[]; }`
- **beginProfileResearch** (function) `(db: Queryable, lookupId: number): Promise<{ profileId: number; subject: LookupSubject } | null>`
- **errorWords** (function) `(err: unknown): string`
- **failProfileResearch** (function) `(db: Queryable, lookupId: number, error: string): Promise<void>`
- **findingsOf** (function) `(r: LookupResult, held: { platform: string; handle: string }[] = []): FindingRow[]`
- **firmOf** (function) `(f: ProfileFacts): Firm`
- **firmOfRole** (function) `(role: string): string | null`
- **readProfileFacts** (function) `(db: Queryable, profileId: number): Promise<ProfileFacts>`
- **researchPlan** (function) `(db: Queryable, o: { now: Date; timezone: string; perDay?: number }): Promise<{ google: number; linkedinUntil: string | null }>`
- **researchProfile** (function) `(db: Queryable, sites: SiteClient, lookupId: number, opts: { googleLeft: number; linkedin?: string | null; linkedinCappedUntil?: Date | null; ledger?: ReadLedger | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<ProfileResearchResult>`
- **subjectOf** (function) `(f: ProfileFacts): LookupSubject`

## packages/research/src/people/store.ts

- **recordLookup** (function) `(db: Queryable, personId: number, r: LookupResult, runId: string | null = null): Promise<void>`

## packages/research/src/people/team.ts

- **TeamMember** (interface) `interface TeamMember { fullName: string; firstName: string; lastName: string; title: string; linkedin: string; vanity: string; }`
- **TeamProfile** (interface) `interface TeamProfile { name: string; url: string; headline: string | null; roles: { title: string; company: string; current: boolean }[]; }`
- **keepTeam** (function) `(firm: Firm, profiles: readonly TeamProfile[]): TeamMember[]`
- **searchTeam** (function) `(sites: SiteClient, firm: Firm, opts: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<TeamSearchResult | null>`
- **teamQuery** (function) `(firm: Firm): string | null`

## packages/research/src/phones.ts

- **isTollFree** (function) `(e164: string): boolean`
- **phonesOf** (function) `(tels: readonly string[], text: string | null): FoundPhone[]`
- **toUsE164** (function) `(raw: string): string | null`

## packages/research/src/records.ts

- **RESEARCH_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/research/src/restate/discovery.ts

- **Discovery** (type) `type Discovery = ReturnType<typeof makeDiscovery>;`
- **DiscoveryDeps** (interface) `interface DiscoveryDeps { db: Db; clientDb?: ((client: string) => Db) | null; fetcher: Fetcher | null; genericWordsFor?: (niche: string | null) => ReadonlySet<string>; resolves?: Resolves; fetchHomepage?: HomepageFetcher; }`
- **makeDiscovery** (function) `(deps: DiscoveryDeps): restate.VirtualObjectDefinition<"Discovery", { discover: (ctx: restate.ObjectContext, input?: DiscoveryInput) => Promise<DiscoveryStats>; verify: (ctx: restate.ObjectContext, input?: DiscoveryInput) => Promise<DomainVerificationStats>; }>`

## packages/research/src/restate/enrichment-context.ts

- **ALL_NICHES** (const) `"all"`
- **CrawlInput** (interface) `interface CrawlInput { limit?: number; shard?: string; pagesPerSite?: number; extraHints?: string[]; }`
- **EnrichmentDeps** (interface) `interface EnrichmentDeps { db: Db; clientDb?: ((client: string) => Db) | null; fetcher: Fetcher | null; llm: LlmClient; clientLlm?: ((client: string, part: string, runId: string | null) => LlmClient) | null; renderer?: (() => Promise<BrowserRenderer>) | null; tracer?: Tracer; extractionSpec?: ExtractionSpec; renderJitter?: readonly [number, number]; renderIdleMs?: number; crawlHintsFor?: (niche: string | null) => ReadonlySet<string>; pages?: PageStore | null; sites?: SiteClient | null; linkedin?: string | null; recheck?: (db: Queryable, companyIds: number[]) => Promise<unknown>; youtube?: YouTubeGet | null; keys?: KeyStore | null; instagram?: SiteClient | null; ladder?: SiteClient | null; desk?: SiteClient | null; adsFor?: (niche: string) => { keywords: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; groupsFor?: (niche: string) => { keywords: readonly string[] } | null; exaSites?: SiteClient | null; exaFor?: (niche: string) => { queries: readonly string[]; cities: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; triggersFor?: (niche: string) => { words: readonly string[]; screen: CompanyScreen | null; } | null; youtubeSearchFor?: (niche: string) => { queries: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; }`
- **LimitInput** (interface) `interface LimitInput { limit?: number; }`
- **clientBlock** (function) `(main: Queryable, key: string, component: string): Promise<{ client: string; block: unknown; accounts: Record<string, string> } | null>`
- **keyScope** (function) `(key: string, main: Db, clientDb?: ((client: string) => Db) | null): { db: Db; niche: string | null }`

## packages/research/src/restate/enrichment-crawl.ts

- **ExtractInput** (interface) `interface ExtractInput { limit?: number; shard?: string; reextract?: boolean; }`
- **RenderInput** (interface) `interface RenderInput extends CrawlInput { ladderLimit?: number; }`
- **ScanInput** (interface) `interface ScanInput { limit?: number; }`

## packages/research/src/restate/enrichment-people.ts

- **ProfilesInput** (interface) `interface ProfilesInput { personIds: number[]; limit?: number; timezone: string; }`
- **SignalsInput** (interface) `interface SignalsInput { personIds: number[]; companyIds?: number[]; limit?: number; timezone: string; collector?: string; }`
- **TeamInput** (interface) `interface TeamInput { companyIds: number[]; limit?: number; }`

## packages/research/src/restate/enrichment-picks.ts

- **EmailPickInput** (interface) `interface EmailPickInput extends PickInput { rules?: boolean; }`
- **PickInput** (interface) `interface PickInput { limit?: number; shard?: string; }`
- **TagInput** (interface) `interface TagInput { limit?: number; dryRun?: boolean; }`

## packages/research/src/restate/enrichment.ts

- **makeEnrichment** (function) `(deps: EnrichmentDeps): restate.VirtualObjectDefinition<"Enrichment", { adLibrary: (ctx: restate.ObjectContext, input?: import("./enrichment-context.js").LimitInput) => Promise<import("../index.js").AdLibraryStats>; exaSearch: (ctx: restate.ObjectContext, input?: import("./enrichment-context.js").LimitInput) => Promise<imp…`
- **Enrichment** (type) `type Enrichment = ReturnType<typeof makeEnrichment>;`

## packages/research/src/restate/page-archive.ts

- **PAGE_ARCHIVE_KEY** (const) `"all"`
- **PageArchive** (type) `type PageArchive = ReturnType<typeof makePageArchive>;`
- **makePageArchive** (function) `(deps: PageArchiveDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ArchiveStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ArchiveStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`

## packages/research/src/restate/profile-research.ts

- **ProfileResearch** (type) `type ProfileResearch = ReturnType<typeof makeProfileResearch>;`
- **ProfileResearchStats** (interface) `interface ProfileResearchStats { state: "matched" | "unresolved" | "capped" | "failed" | "skipped"; findings: number; google: number; error?: string; }`
- **makeProfileResearch** (function) `(deps: ProfileResearchDeps): restate.VirtualObjectDefinition<"ProfileResearch", { run: (ctx: restate.ObjectContext, input: ProfileResearchInput) => Promise<ProfileResearchStats>; }>`

## packages/research/src/schema.ts

- **COMPANY_CHECK_STATES** (const) `readonly ["hiring", "no_openings", "unresolved", "capped"]`
- **CONTACT_KINDS** (const) `readonly ["phone", "linkedin_company", "linkedin_person", "x", "instagram", "facebook", "youtube", "tiktok"]`
- **CONTACT_SOURCES** (const) `readonly ["link", "text"]`
- **CompanyCheck** (type) `type CompanyCheck = typeof companyChecks.$inferSelect;`
- **CompanyCheckState** (type) `type CompanyCheckState = (typeof COMPANY_CHECK_STATES)[number];`
- **CompanyLookup** (type) `type CompanyLookup = typeof companyLookups.$inferSelect;`
- **ContactKind** (type) `type ContactKind = (typeof CONTACT_KINDS)[number];`
- **ContactPoint** (type) `type ContactPoint = typeof contactPoints.$inferSelect;`
- **ContactSource** (type) `type ContactSource = (typeof CONTACT_SOURCES)[number];`
- **DISCOVERY_KINDS** (const) `readonly ["discover", "verify"]`
- **DISCOVERY_OUTCOMES** (const) `readonly ["attached", "verified", "no_name", "no_candidate", "unreachable", "gate_rejected"]`
- **DOCUMENT_KINDS** (const) `readonly ["webpage", "pdf", "snippet", "profile", "video", "post", "audio"]`
- **DiscoveryAttempt** (type) `type DiscoveryAttempt = typeof discoveryAttempts.$inferSelect;`
- **DiscoveryKind** (type) `type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];`
- **DiscoveryOutcome** (type) `type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];`
- **Document** (type) `type Document = typeof documents.$inferSelect;`
- **DocumentKind** (type) `type DocumentKind = (typeof DOCUMENT_KINDS)[number];`
- **ENRICHMENT_KINDS** (const) `readonly ["people_extraction", "firmographics", "email_scan", "contact_scan", "email_pick", "opener", "video"]`
- **EVENT_CHECK_STATES** (const) `readonly ["found", "none", "unresolved", "capped"]`
- **Enrichment** (type) `type Enrichment = typeof enrichments.$inferSelect;`
- **EnrichmentKind** (type) `type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];`
- **FINDING_BYS** (const) `readonly ["model", "code", "hand"]`
- **FINDING_KINDS** (const) `readonly ["job_change", "still_there", "left", "hiring", "post", "news", "profile", "stack", "site_change", "talk", "demand", "fact"]`
- **Finding** (type) `type Finding = typeof findings.$inferSelect;`
- **FindingKind** (type) `type FindingKind = (typeof FINDING_KINDS)[number];`
- **LOOKUP_STATES** (const) `readonly ["matched", "unresolved", "capped"]`
- **LookupState** (type) `type LookupState = (typeof LOOKUP_STATES)[number];`
- **NewDocument** (type) `type NewDocument = typeof documents.$inferInsert;`
- **NewEnrichment** (type) `type NewEnrichment = typeof enrichments.$inferInsert;`
- **OWN_CONTACT_MAX_FIRMS** (const) `5`
- **PersonLookup** (type) `type PersonLookup = typeof personLookups.$inferSelect;`
- **Proof** (type) `type Proof = | { t: number; len?: number } | { quote: string } | { frame: number } | { method: string };`
- **SIGNAL_CHECK_STATES** (const) `readonly ["found", "none", "unresolved", "capped"]`
- **SIGNAL_DATED** (const) `readonly ["published", "approx", "seen"]`
- **SIGNAL_KINDS** (const) `readonly ["news", "post", "hiring", "job_change", "stack", "site_change", "talk", "demand"]`
- **STUDY_OUTCOMES** (const) `readonly ["ok", "empty", "refused", "failed"]`
- **STUDY_STEPS** (const) `readonly ["plan", "search", "ask", "read", "claims", "draft"]`
- **SignalCheck** (type) `type SignalCheck = typeof signalChecks.$inferSelect;`
- **SignalCheckState** (type) `type SignalCheckState = (typeof SIGNAL_CHECK_STATES)[number];`
- **SignalDated** (type) `type SignalDated = (typeof SIGNAL_DATED)[number];`
- **SignalKind** (type) `type SignalKind = (typeof SIGNAL_KINDS)[number];`
- **Study** (type) `type Study = typeof studies.$inferSelect;`
- **StudyOutcome** (type) `type StudyOutcome = (typeof STUDY_OUTCOMES)[number];`
- **StudyStep** (type) `type StudyStep = (typeof STUDY_STEPS)[number];`
- **StudyStepRow** (type) `type StudyStepRow = typeof studySteps.$inferSelect;`
- **TeamSearch** (type) `type TeamSearch = typeof teamSearches.$inferSelect;`
- **companyChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_checks"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNu…`
- **companyEventChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_event_checks"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_event_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | n…`
- **companyLookups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_lookups"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_lookups"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`
- **contactPoints** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contact_points"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "contact_points"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **discoveryAttempts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "discovery_attempts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "discovery_attempts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **documents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "documents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "documents"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **enrichments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "enrichments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "enrichments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **fetchTiers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "fetch_tiers"; schema: undefined; columns: { domain: import("drizzle-orm/pg-core").PgColumn<{ name: "domain"; tableName: "fetch_tiers"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **findings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "findings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "findings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **ownContactPoints** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"own_contact_points", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "own_contact_points"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrim…`
- **personLookups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "person_lookups"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "person_lookups"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`
- **researchSignals** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"research_signals", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "research_signals"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryK…`
- **signalChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "signal_checks"; schema: undefined; columns: { collector: import("drizzle-orm/pg-core").PgColumn<{ name: "collector"; tableName: "signal_checks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **studies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "studies"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "studies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **studySteps** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "study_steps"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "study_steps"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **teamSearches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "team_searches"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "team_searches"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`

## packages/research/src/signals/collectors.ts

- **COLLECTORS** (const) `readonly Collector[]`
- **anyCollectorBuilt** (function) `(): boolean`
- **collectorNamed** (function) `(name: string): Collector<z.ZodObject<z.core.$ZodLooseShape, z.core.$strip>> | null`
- **signalSettings** (function) `(db: Queryable): Promise<SignalsSettings>`
- **signalSettingsOf** (function) `(block: unknown): SignalsSettings`
- **signalsSettingsSchema** (const) `z.ZodObject<{ [x: string]: z.ZodPrefault<z.ZodObject<{ [x: string]: any; on: z.ZodDefault<z.ZodBoolean>; }, z.core.$strip>>; }, z.core.$strict>`

## packages/research/src/signals/index.ts

- **BaseDeps** (type) `type BaseDeps = Omit<SignalDeps, "googleLeft" | "now">;`
- **Collected** (interface) `interface Collected { state: SignalCheckState; signals: SignalDraft[]; tried: Tried[]; answer?: unknown; retryAt?: Date | null; stop?: string; spent?: readonly string[]; }`
- **Collector** (interface) `interface Collector<S extends z.ZodObject = z.ZodObject> { name: string; subject: SignalSubject; built: boolean; settings: S; bucket: Bucket; everyDays: number; metered: boolean; vendors?: readonly string[]; spends?(subject: string): readonly string[]; subjects?(db: Queryable, pass: Pass, s: z.infer<S>): Promise<string[]>; collect(deps: SignalDeps, subject: string, s: z.infer<S>): Promise<Collected>; }`
- **ONCE** (const) `36500`
- **Pass** (interface) `interface Pass { niche: string | null; personIds: number[]; companyIds: number[]; }`
- **Person** (interface) `interface Person { id: number; fullName: string; firstName: string | null; lastName: string | null; title: string | null; linkedinUrl: string | null; firm: Firm; }`
- **SIGNALS_COMMAND** (const) `"enrich signals"`
- **SIGNALS_COMPONENT** (const) `"research.signals"`
- **SIGNALS_GOOGLE_PER_DAY** (const) `100`
- **SIGNALS_HELD** (const) `"research.signals"`
- **SIGNALS_LIMIT** (const) `20`
- **Signal** (type) `type Signal = typeof researchSignals.$inferSelect;`
- **SignalDeps** (interface) `interface SignalDeps { db: Queryable; sites: SiteClient | null; desk: SiteClient | null; fetcher: Fetcher | null; pages: PageStore | null; youtube: YouTubeGet | null; llm: LlmClient | null; linkedin: string | null; linkedinReads?: string | null; linkedinRoom?: (() => Promise<number>) | null; also?: Queryable | null; googleLeft: number; now: Date; }`
- **SignalsSettings** (type) `type SignalsSettings = Record<string, CollectorSettings>;`
- **SignalsStats** (interface) `interface SignalsStats { checked: number; kept: number; collectors: Record<string, CollectorStats>; }`
- **collectorRoom** (function) `(db: Queryable, c: Pick<Collector, "name" | "bucket">, now: Date, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **countSignalUnit** (function) `(stats: SignalsStats, c: CollectorStats, u: SignalUnit | { ok: false; reason: string }): string | null`
- **defineCollector** (function) `(c: Collector<S>): Collector<S>`
- **emptySignalsStats** (function) `(): SignalsStats`
- **firmKey** (function) `(id: number): string`
- **passOf** (function) `(db: Queryable, niche: string | null, personIds: readonly number[], companyIds: readonly number[] = []): Promise<Pass>`
- **personKey** (function) `(id: number): string`
- **personOf** (function) `(db: Queryable, id: number): Promise<Person | null>`
- **planStats** (function) `(stats: SignalsStats, p: CollectorPlan): CollectorStats`
- **queuedFirms** (function) `(db: Queryable, limit: number): Promise<number[]>`
- **readAccount** (function) `(pool: string | null | undefined): string | null`
- **runSignals** (function) `(collectors: readonly Collector[], settings: SignalsSettings, base: BaseDeps, opts: { pass: Pass; timezone: string; limit?: number; only?: string | null; dry?: boolean; runId?: string | null; meter?: ((collector: string, vendors: readonly string[]) => Promise<void>) | null; google?: { perDay: number; signals: number }; onUnit?: (u: SignalUnit | { collector: string; subject: string; error: string }) => void; }): Promise<SignalsStats>`
- **signalPlan** (function) `(db: Queryable, collectors: readonly Collector[], settings: SignalsSettings, pass: Pass, opts: { now: Date; limit?: number | undefined; only?: string | null | undefined; also?: Queryable | null; gate?: (vendor: string, units: number) => Promise<Gate>; }): Promise<CollectorPlan[]>`
- **signalUnit** (function) `(c: Collector, subject: string, s: CollectorSettings, base: BaseDeps, opts: { timezone: string; runId?: string | null; dry?: boolean; meter?: ((vendors: readonly string[]) => Promise<void>) | null; google?: { perDay: number; signals: number }; }): Promise<SignalUnit>`
- **signalsFor** (function) `(db: Queryable, q: { companyId?: number; personId?: number; since?: Date; kinds?: readonly SignalKind[]; limit?: number; }): Promise<Signal[]>`
- **Firm** (interface) `interface Firm { id: number; name: string | null; domain: string | null; niche: string | null; country: string | null; linkedinUrl: string | null; }`
- **Tried** (interface) `interface Tried { step: string; what: string; outcome: string; [more: string]: unknown; }`
- **firmOf** (function) `(db: Queryable, id: number): Promise<Firm | null>`
- **subjectOf** (function) `(key: string): { companyId: number } | { personId: number } | null`

## packages/research/src/signals/linkedin.ts

- **WREN_LINKEDIN** (const) `ReadonlySet<string>`
- **clientLinkedin** (function) `(accounts: Readonly<Record<string, string>> | null): string | null`

## packages/research/src/social-schema.ts

- **POST_MAPPINGS** (const) `readonly ["link", "author", "name"]`
- **PostMapping** (type) `type PostMapping = (typeof POST_MAPPINGS)[number];`
- **SOCIAL_NETWORKS** (const) `readonly ["facebook"]`
- **SocialGroup** (type) `type SocialGroup = typeof socialGroups.$inferSelect;`
- **SocialNetwork** (type) `type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];`
- **SocialPost** (type) `type SocialPost = typeof socialPosts.$inferSelect;`
- **socialGroups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_groups"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_groups"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **socialPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_posts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_posts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **socialSearches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_searches"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_searches"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`

## packages/research/src/sops/cites.ts

- **expandCites** (function) `(md: string): string`
- **numberCites** (function) `(dir: string, md: string): Promise<string>`

## packages/research/src/sops/index.ts

- **DEFAULT_PRIORITY** (const) `5`
- **DriveGet** (type) `type DriveGet = (path: string, body: Record<string, unknown>) => Promise<unknown>;`
- **STYLE** (const) `"Style: short plain sentences a person would say out loud. Lead with the action. Fewer words, more signal. No filler, no hedging, no hype, no jargon, no restating. No \"not X but Y\" contrasts, no one-line closers that repeat the point, no colon reveals, no dashes, no forced groups of three, no bold…`
- **Source** (interface) `interface Source { name: string; md: string; }`
- **addSource** (function) `(dir: string, source: Source): Promise<string>`
- **audioSource** (function) `(audioUrl: string, opts: { url: string; title?: string | null; creator?: string | null; model: Model; fetchFn?: typeof fetch; ffmpeg?: string; priority?: number; }): Promise<Source>`
- **buildSop** (function) `(dir: string, llm: LlmClient): Promise<string>`
- **driveSources** (function) `(folderId: string, drive: DriveGet, priority = DEFAULT_PRIORITY, path = ""): Promise<Source[]>`
- **extractPoints** (function) `(dir: string, llm: LlmClient, only?: string): Promise<string[]>`
- **fileSource** (function) `(file: string, priority = DEFAULT_PRIORITY): Promise<Source>`
- **readSopDir** (function) `(dir: string): Promise<SopDir>`
- **sopPrompt** (function) `(input: SopInput): string`
- **toSource** (function) `(read: VideoRead, priority = DEFAULT_PRIORITY): Source`
- **videoSource** (function) `(url: string, ytDlp: string, priority = DEFAULT_PRIORITY, opts: Omit<WatchOptions, "ytDlp">): Promise<Source>`
- **writeSkill** (function) `(dir: string): Promise<string>`
- **youtubeByUrl** (function) `(url: string, opts: { model: Model; fetchFn?: typeof fetch; durationS?: number | null | undefined; priority?: number; }): Promise<Source>`
- **youtubeSource** (function) `(url: string, ytDlp: string, priority = DEFAULT_PRIORITY, opts: { video?: Model | null; fetchFn?: typeof fetch } = {}): Promise<Source>`

## packages/research/src/studies/recipes.ts

- **StudyInput** (interface) `interface StudyInput { question: string; angles: string[]; drafts: StudyDraftSpec[]; }`
- **questionStudy** (function) `(question: string, angles: readonly string[] = []): StudyInput`
- **verticalStudy** (function) `(b: VerticalBrief): StudyInput`

## packages/research/src/studies/run.ts

- **CLAIM_CALLS** (const) `readonly ["keep", "tune", "drop"]`
- **ClaimCall** (type) `type ClaimCall = (typeof CLAIM_CALLS)[number];`
- **StudyClaim** (interface) `interface StudyClaim extends NumberedClaim { key: string; call: string | null; comment: string | null; }`
- **StudyView** (interface) `interface StudyView { study: Study; angles: { angle: string; claims: StudyClaim[] }[]; drafts: { spec: StudyDraftSpec; kept: DraftItem[]; dropped: DroppedDraft[]; done: boolean; stale: boolean; }[]; titles: Map<string, string>; manual?: Map<string, ManualPage>; counts: { queries: number; pages: number; unread: number; gated: number; waiting: number; }; }`
- **addStudyPage** (function) `(db: Queryable, slug: string, page: HeldPage, now = new Date()): Promise<{ key: string; added: boolean }>`
- **callStudyClaims** (function) `(db: Queryable, slug: string, numbers: readonly number[], call: ClaimCall, by: string, comment: string | null = null): Promise<StudyClaim[]>`
- **claimKey** (function) `(document: number, slug: string, quote: string): string`
- **manualOf** (function) `(r: StudyStepRow): ManualPage | null`
- **openStudy** (function) `(db: Queryable, slug: string, input: StudyInput, niche: string | null = null): Promise<Study>`
- **pageTitle** (function) `(title: string | null | undefined): string | null`
- **runStudy** (function) `(db: Queryable, deps: StudyDeps, slug: string, opts: StudyRunOptions = {}): Promise<StudyStats>`
- **studyClaims** (function) `(db: Queryable, slug: string): Promise<StudyClaim[]>`
- **studyView** (function) `(db: Queryable, slug: string): Promise<StudyView>`

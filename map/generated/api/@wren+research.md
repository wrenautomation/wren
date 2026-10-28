# @wren/research: interface

Exports: 646. Files: 78.

## packages/core/src/buckets.ts

- **Bucket** (interface) `interface Bucket { perDay: number; burst: number; }`
- **bucketRoom** (function) `(spent: readonly number[], now: number, bucket: Bucket): { room: number; nextInMs: number }`

## packages/db/src/columns.ts

- **pgSafe** (function) `(v: T): T`

## packages/research/src/companies/boards.ts

- **boardPageOf** (function) `(url: string): string | null`
- **findBoards** (function) `(page: string): Board[]`
- **readBoard** (function) `(fetcher: Fetcher, board: Board): Promise<BoardRead>`
- **Job** (interface) `interface Job { title: string; location: string | null; url: string | null; postedAt: string | null; }`
- **Board** (interface) `interface Board { ats: string; token: string; page: string; api: string; }`

## packages/research/src/companies/customers.ts

- **imageNames** (function) `(html: string): string[]`
- **buildCustomersPrompt** (function) `(firm: string, pages: PageMaterial[]): string`
- **findCustomers** (function) `(fetcher: Fetcher, llm: LlmClient, firm: { name: string; site: string }, opts: CustomersOptions = {}): Promise<CustomersResult>`
- **gateCustomers** (function) `(said: z.infer<typeof customersSchema>["customers"], firm: { name: string; site: string }, pages: PageMaterial[]): Omit<CustomersResult, "tried">`
- **CustomersResult** (interface) `interface CustomersResult { customers: NamedCustomer[]; dropped: { name: string; why: string }[]; tried: CustomersTried[]; }`

## packages/research/src/companies/events.ts

- **eventDate** (function) `(said: string | null | undefined, now: Date): string | null`
- **readEvents** (function) `(hits: readonly EventHit[], firm: Firm, source: CompanyEvent["source"], now: Date, kinds: readonly EventKind[] = EVENT_KINDS): CompanyEvent[]`
- **readRss** (function) `(xml: string): EventHit[] | null`
- **searchEvents** (function) `(sites: SiteClient, firm: Firm, opts: { google: boolean; kinds?: readonly EventKind[]; fetcher?: Fetcher | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<EventsResult>`
- **NEWS_KINDS** (const) `readonly ["acquisition", "merger", "funding", "leader", "launch", "office", "award", "partnership", "expansion"]`
- **EventKind** (type) `type EventKind = (typeof NEWS_KINDS)[number];`
- **EVENT_KINDS** (const) `readonly EventKind[]`
- **eventKindOf** (function) `(text: string, kinds: readonly EventKind[] = NEWS_KINDS): EventKind | null`
- **googleWords** (function) `(kind: EventKind): readonly string[]`
- **CompanyEvent** (interface) `interface CompanyEvent { kind: EventKind; date: string; title: string; snippet: string | null; url: string; source: "rss" | "google" | "exa"; raw: unknown; }`
- **EventHit** (interface) `interface EventHit { title: string; url: string; snippet?: string | null; date?: string | null; raw?: unknown; }`
- **eventQuery** (function) `(firm: Firm, source: CompanyEvent["source"], kinds: readonly EventKind[] = EVENT_KINDS): string | null`
- **NEWS_RSS** (const) `"https://news.google.com/rss/search"`
- **EventsResult** (interface) `interface EventsResult { state: EventsState; events: CompanyEvent[]; tried: EventsTried[]; retryAt: Date | null; googleStopped: boolean; }`
- **eventDocument** (function) `(e: CompanyEvent): DocumentDraft`
- **eventFinding** (function) `(companyId: number, e: CompanyEvent): CompanyFindingDraft & { signalAt: Date; dated: "published" }`

## packages/research/src/companies/hiring.ts

- **checkHiring** (function) `(deps: HiringDeps, s: CompanySubject, opts: HiringOptions): Promise<HiringResult>`
- **CompanySubject** (interface) `interface CompanySubject { companyId: number; firm: Firm; linkedinPage: string | null; }`
- **HiringOptions** (interface) `interface HiringOptions { linkedin: string | null; linkedinCappedUntil?: Date | null; google?: boolean; accountRoom?: number; now?: () => Date; sleep?: (ms: number) => Promise<void>; }`
- **HiringResult** (interface) `interface HiringResult { state: CompanyCheckState; finding: CompanyFindingDraft | null; tried: CheckTried[]; retryAt: Date | null; cappedBy: string | null; served: ReadSource | null; }`

## packages/research/src/companies/ppp-size.ts

- **businessNameKey** (function) `(name: string): string`
- **readPppLoans** (function) `(dir: string): { release: string; loans: PppLoan[] }`
- **pppIndex** (function) `(loans: readonly PppLoan[]): { match(c: CompanyPlace): { how: PppMatch; loans: PppLoan[]; } | null; }`
- **pppFirmographics** (function) `(how: PppMatch, release: string, loans: readonly PppLoan[]): { source: string; release: string; match: PppMatch; jobs_reported: number | null; payroll_yearly_estimate: number | null; franchise: string | null; loans: readonly PppLoan[]; }`
- **sizeFromPpp** (function) `(db: Queryable, opts: { dir: string; niche: string }): Promise<PppSizeStats>`
- **PPP_MODEL** (const) `"ppp-foia"`
- **PppLoan** (type) `type PppLoan = Record<string, string>;`
- **CompanyPlace** (interface) `interface CompanyPlace { id: number; names: string[]; zip: string | null; state: string | null; }`

## packages/research/src/companies/profile.ts

- **linkedinCompany** (function) `(url: string | null | undefined): string | null`
- **firmSite** (function) `(website: string | null | undefined, domain: string | null): boolean`
- **readCompanyPage** (function) `(call: ReturnType<typeof paced>, url: string, tried: { what: string; outcome: string }[]): Promise<CompanyPage | null>`
- **lookUpCompany** (function) `(sites: SiteClient, s: ProfileSubject, opts: ProfileOptions = {}): Promise<ProfileResult>`
- **recordCompanyLookup** (function) `(db: Queryable, companyId: number, r: ProfileResult, runId: string | null = null): Promise<void>`
- **ProfileSubject** (interface) `interface ProfileSubject { companyId: number; firm: Firm; linkedinUrl: string | null; personCompanyUrl?: string | null; pageLinks?: string[]; }`
- **PageSource** (type) `type PageSource = "held" | "people" | "page" | "google" | "companies";`
- **COMPANY_PAGE_STAGE** (const) `"research.company-page"`
- **CompanyPage** (interface) `interface CompanyPage { name: string; handle: string; url: string; website?: string; phone?: string; industry?: string; size?: string; headquarters?: string; founded?: string | number; type?: string; employees?: string | number; about?: string; text: string; source: string; }`
- **companyPageUrl** (function) `(handle: string): string`

## packages/research/src/companies/store.ts

- **recordCompanyCheck** (function) `(db: Queryable, companyId: number, r: HiringResult, runId: string | null = null): Promise<void>`
- **recordCompanyEvents** (function) `(db: Queryable, companyId: number, r: EventsResult, runId: string | null = null): Promise<void>`

## packages/research/src/components.ts

- **leadSheetSettingsSchema** (const) `z.ZodObject<{ genericWords: z.ZodDefault<z.ZodArray<z.ZodString>>; crawlHints: z.ZodDefault<z.ZodArray<z.ZodString>>; perPass: z.ZodPrefault<z.ZodObject<{ discover: z.ZodOptional<z.ZodNumber>; verify: z.ZodOptional<z.ZodNumber>; crawl: z.ZodOptional<z.ZodNumber>; render: z.ZodOptional<z.ZodNumber>; …`
- **LeadSheetSettings** (type) `type LeadSheetSettings = z.infer<typeof leadSheetSettingsSchema>;`
- **LEAD_SHEET** (const) `"research.lead_sheet"`
- **socialSettingsSchema** (const) `z.ZodObject<{ youtube: z.ZodDefault<z.ZodBoolean>; instagram: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>`
- **SocialSettings** (type) `type SocialSettings = z.infer<typeof socialSettingsSchema>;`
- **SOCIAL** (const) `"research.social"`
- **DOSSIER** (const) `"research.dossier"`
- **RESEARCH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **RESEARCH_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/research/src/discovery/candidates.ts

- **nameTokens** (function) `(name: string): string[]`
- **domainCandidates** (function) `(name: string, opts: CandidateOptions = {}): string[]`

## packages/research/src/discovery/find.ts

- **findHomepage** (function) `(name: string, stated: string | null, deps: FindHomepageDeps): Promise<FoundHomepage | null>`
- **siteName** (function) `(html: string, domain: string): string | null`

## packages/research/src/discovery/gate.ts

- **registryDigits** (function) `(sourceKey: string | null | undefined): string | null`
- **gatePage** (function) `(input: GateInput): GateEvidence | null`
- **GateEvidence** (interface) `interface GateEvidence { url: string; matched_tokens: string[]; matched_registry_key: boolean; page_title: string; }`

## packages/research/src/discovery/homepage.ts

- **politeHomepageFetcher** (function) `(fetcher: Fetcher): HomepageFetcher`

## packages/research/src/discovery/service.ts

- **openDiscoveryBatch** (function) `(db: Queryable, sourceType: string, opts: { limit?: number; niche?: string | null }): Promise<ImportBatch>`
- **closeDiscoveryBatch** (function) `(db: Queryable, batchId: number, stats: object): Promise<void>`
- **selectDiscoveryTargets** (function) `(db: Queryable, opts: { limit?: number; niche?: string | null; retryAfterDays?: number }): Promise<Company[]>`
- **countDiscoveryNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **emptyDiscoveryStats** (function) `(): DiscoveryStats`
- **addDiscoveryStats** (function) `(total: DiscoveryStats, unit: DiscoveryStats): DiscoveryStats`
- **discoverCompany** (function) `(db: Queryable, company: Company, opts: DiscoveryUnitOptions): Promise<DiscoveryStats>`
- **runDomainDiscovery** (function) `(db: Queryable, opts: DiscoveryOptions): Promise<{ batch: ImportBatch; stats: DiscoveryStats }>`
- **selectVerificationTargets** (function) `(db: Queryable, opts: { limit?: number; niche?: string | null; retryAfterDays?: number }): Promise<Company[]>`
- **countVerificationNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **emptyVerificationStats** (function) `(): DomainVerificationStats`
- **addVerificationStats** (function) `(total: DomainVerificationStats, unit: DomainVerificationStats): DomainVerificationStats`
- **verifyCompanyDomain** (function) `(db: Queryable, company: Company, opts: DiscoveryUnitOptions): Promise<DomainVerificationStats>`
- **runDomainVerification** (function) `(db: Queryable, opts: DomainVerificationOptions): Promise<{ batch: ImportBatch; stats: DomainVerificationStats }>`
- **DISCOVERY_SOURCE_TYPE** (const) `"domain-discovery"`
- **VERIFICATION_SOURCE_TYPE** (const) `"domain-verification"`
- **Page** (interface) `interface Page { url: string; title: string; text: string; }`
- **HomepageFetcher** (type) `type HomepageFetcher = (domain: string) => Promise<Page | null>;`
- **Resolves** (type) `type Resolves = (domain: string) => Promise<boolean | null>;`
- **dohResolves** (const) `Resolves`
- **DiscoveryStats** (interface) `interface DiscoveryStats { companies_scanned: number; no_name: number; candidates_tried: number; dns_misses: number; resolver_errors: number; fetch_misses: number; gate_rejections: number; already_claimed: number; domains_attached: number; niche_null_skipped?: number; }`
- **DiscoveryUnitOptions** (interface) `interface DiscoveryUnitOptions { batchId: number; rowNumber: number; genericWords?: ReadonlySet<string>; resolves?: Resolves; fetchHomepage: HomepageFetcher; }`
- **DomainVerificationStats** (interface) `interface DomainVerificationStats { companies_scanned: number; fetch_misses: number; gate_rejections: number; domains_verified: number; niche_null_skipped?: number; unverified_preview: string[]; }`

## packages/research/src/dossier.ts

- **dossiers** (function) `(db: Queryable, companyIds: readonly number[]): Promise<Dossier[]>`
- **withFacts** (function) `(list: readonly Dossier[], more: MoreFacts): Dossier[]`
- **findCompanyIds** (function) `(db: Queryable, query: string, limit = 10): Promise<number[]>`
- **nicheCompanyIds** (function) `(db: Queryable, niche: string, limit: number, afterId = 0): Promise<number[]>`
- **recentPosts** (function) `(d: Dossier, perSite = POSTS_PER_SITE): RecentPost[]`
- **dossierText** (function) `(d: Dossier): string`
- **dossierBrief** (function) `(d: Dossier): DossierBrief`
- **Fact** (interface) `interface Fact { what: string; value: unknown; confidence: number | null; source: string | null; via: string; seenAt: Date; }`
- **Dossier** (interface) `interface Dossier { company: { id: number; name: string | null; domain: string | null; niche: string | null; country: string | null; timezone: string | null; }; facts: Fact[]; people: PersonDossier[]; }`
- **MoreFacts** (interface) `interface MoreFacts { byCompany: ReadonlyMap<number, readonly Fact[]>; byPerson: ReadonlyMap<number, readonly Fact[]>; }`
- **RecentPost** (interface) `interface RecentPost { site: string; kind: string; text: string; url: string | null; publishedAt: Date | null; likes: number | null; comments: number | null; }`
- **BriefFact** (interface) `interface BriefFact { what: string; text: string; source: string | null; via: string; seen: string; }`
- **DossierBrief** (interface) `interface DossierBrief { facts: BriefFact[]; posts: { site: string; kind: string; text: string; url: string | null; published: string | null; }[]; people: { name: string; title: string | null; linkedinUrl: string | null; origin: string; facts: BriefFact[]; }[]; }`

## packages/research/src/enrichment/ad-library.ts

- **pageKey** (function) `(ad: Ad): string`
- **adRows** (function) `(ads: readonly Ad[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **mergePageFirm** (function) `(db: Queryable, key: string, domain: string): Promise<PageMerge>`
- **pageFirmPairs** (function) `(db: Queryable): Promise<{ key: string; domain: string }[]>`
- **adLibraryRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = AD_LIBRARY_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **adKeywordsDue** (function) `(db: Queryable, keywords: readonly string[], opts: { now: Date; limit: number; country?: string }): Promise<string[]>`
- **adLibraryUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; country?: string; platforms?: Iterable<string> }): Promise<AdLibraryUnit>`
- **countAdLibraryUnit** (function) `(s: AdLibraryStats, u: AdLibraryUnit): string | null`
- **AD_LIBRARY_COMMAND** (const) `"enrich ad-library"`
- **AD_LIBRARY_BUCKET** (const) `Bucket`
- **Ad** (interface) `interface Ad { libraryId: string; advertiser: string | null; page?: string | null; url?: string | null; caption?: string | null; [field: string]: unknown; }`
- **AdLibraryStats** (interface) `interface AdLibraryStats { selected: number; read: number; ads: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **emptyAdLibraryStats** (function) `(): AdLibraryStats`

## packages/research/src/enrichment/audit-backfill.ts

- **backfillCallRecords** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<BackfillStats>`
- **BackfillStats** (interface) `interface BackfillStats extends Record<string, number> { selected: number; backfilled: number; legacy_pick_lifted: number; free_routes: number; }`

## packages/research/src/enrichment/contacts.ts

- **socialProfile** (function) `(raw: string): { kind: Social; url: string } | null`
- **contactsInPage** (function) `(html: string | null, text: string, opts: { tels?: readonly string[] | null; people?: readonly { id: number; first: string | null; last: string | null }[]; } = {}): PagePoint[]`
- **selectContactTargets** (function) `(db: Queryable, opts: { limit?: number | undefined; niche?: string | null | undefined } = {}): Promise<number[]>`
- **loadContactTarget** (function) `(db: Queryable, id: number): Promise<ContactsTarget | null>`
- **scanContacts** (function) `(db: Queryable, doc: ContactsTarget, runId: string | null = null, pages: PageStore | null = null): Promise<PagePoint[]>`
- **runContacts** (function) `(db: Queryable, opts: ContactsRunOptions = {}): Promise<ContactsStats>`
- **CONTACTS_MODEL** (const) `"deterministic"`
- **ContactsStats** (interface) `interface ContactsStats { selected: number; scanned: number; points: number; pages_with_points: number; }`

## packages/research/src/enrichment/crawler.ts

- **emptyCrawlStats** (function) `(): CrawlStats`
- **addCrawlStats** (function) `(total: CrawlStats, unit: CrawlStats): CrawlStats`
- **robotsDisallows** (function) `(fetcher: Fetcher, url: string, cache: RobotsCache, stats: RobotsCounters): Promise<boolean>`
- **pageRow** (function) `(companyId: number | null, url: string, resp: FetchResponse, opts: { robotsDisallowed?: boolean } = {}): { companyId: number | null; url: string; finalUrl: string | null; kind: "webpage"; statusCode: number; contentHash: string; title: string | null; text: string; html: string; fetchTier: string; isShell: boolean; robotsDisallowed: boolean; }`
- **crawlCompany** (function) `(db: Queryable, fetcher: Fetcher, company: Pick<Company, "id" | "domain">, opts: CrawlCompanyOptions = {}): Promise<CrawlStats>`
- **selectCrawlTargets** (function) `(db: Queryable, opts: CrawlSelectOptions = {}): Promise<Company[]>`
- **countCrawlNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **runCrawl** (function) `(db: Queryable, fetcher: Fetcher, opts: CrawlRunOptions = {}): Promise<CrawlStats>`
- **HTTP_TIER** (const) `"httpx"`
- **EMPTY_HASH** (const) `string`
- **stripNul** (function) `(s: string): string`
- **CrawlStats** (interface) `interface CrawlStats { companies_crawled: number; pages_stored: number; fetch_errors: number; homepage_unreachable: number; robots_warned: number; shells_stored: number; niche_null_skipped: number; dead_skipped: number; remembered_skipped: number; robots_disallowed_urls: string[]; }`

## packages/research/src/enrichment/email-pick/graph.ts

- **parsePick** (function) `(text: string): PickResult | string`
- **route** (function) `(state: PickState): Route`
- **buildPickPrompt** (function) `(state: PickState): string`
- **classify** (function) `(llm: LlmClient, state: PickState, opts: ClassifyOptions = {}): Promise<PickOutcome>`
- **ground** (function) `(state: PickState, pick: Pick): Pick`
- **byRules** (function) `(state: PickState): Pick`
- **runPickGraph** (function) `(llm: LlmClient | null, state: PickState, opts: ClassifyOptions = {}): Promise<PickOutcome>`
- **PICK_VERSION** (const) `"v3"`
- **FREE_PICK_METHODS** (const) `ReadonlySet<string>`
- **RULES_PICKER** (const) `"deterministic"`
- **Pick** (interface) `interface Pick { method: PickMethod; emails: ClassifiedEmail[]; best_send_to: string | null; notes?: string | null; ungrounded?: string[]; ungrounded_names?: string[]; }`
- **PickState** (interface) `interface PickState { company: PickCompany; signals: EmailSignal[]; people: PickPerson[]; no_scannable: boolean; }`
- **PickOutcome** (interface) `interface PickOutcome { pick: Pick; llm: Envelope | null; parse_error: string | null; provider_rejected: string | null; }`
- **Route** (type) `type Route = "no_content" | "empty_verdict" | "auto_accept" | "classify";`
- **ClassifyOptions** (interface) `interface ClassifyOptions { runId?: string | null | undefined; tracer?: Tracer | null | undefined; }`

## packages/research/src/enrichment/email-pick/run.ts

- **gatherState** (function) `(db: Queryable, company: Company): Promise<PickState>`
- **selectPickTargets** (function) `(db: Queryable, llm: LlmClient | null, opts: PickSelectOptions = {}): Promise<Company[]>`
- **pickCompany** (function) `(db: Queryable, llm: LlmClient | null, company: Company, opts: PickUnitOptions = {}): Promise<PickOutcome>`
- **runEmailPick** (function) `(db: Queryable, llm: LlmClient | null, opts: EmailPickRunOptions = {}): Promise<EmailPickStats>`
- **applyPicks** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<ApplyPicksStats>`
- **EmailPickStats** (interface) `interface EmailPickStats { selected: number; picked: number; auto_accepted: number; no_signals: number; no_content: number; classified: number; parse_errors: number; provider_rejected: number; ungrounded_emails: number; ungrounded_names: number; aborted: string | null; }`
- **ApplyPicksStats** (interface) `interface ApplyPicksStats extends Record<string, unknown> { picks_applied: number; person_emails: number; people_from_addresses: number; role_leads: number; companies_without_send_to: number; }`

## packages/research/src/enrichment/email-scan.ts

- **scanPage** (function) `(html: string | null, text: string, opts: { pageUrl: string; companyDomain: string | null | undefined }): EmailSignal[]`
- **selectScanTargets** (function) `(db: Queryable, opts: ScanSelectOptions = {}): Promise<ScanTarget[]>`
- **loadScanTarget** (function) `(db: Queryable, id: number): Promise<ScanTarget | null>`
- **scanDocument** (function) `(db: Queryable, doc: ScanTarget, runId: string | null = null, pages: PageStore | null = null): Promise<EmailSignal[]>`
- **runScan** (function) `(db: Queryable, opts: ScanRunOptions = {}): Promise<ScanStats>`
- **SCAN_VERSION** (const) `"v3"`
- **SCAN_MODEL** (const) `"deterministic"`
- **SignalSource** (type) `type SignalSource = "mailto" | "text" | "markup" | "deobfuscated";`
- **EmailSignal** (interface) `interface EmailSignal { email: string; source: SignalSource; context: string; page_url: string; on_domain: boolean; }`
- **ScanStats** (interface) `interface ScanStats { selected: number; scanned: number; signals: number; pages_with_signals: number; }`

## packages/research/src/enrichment/exa-search.ts

- **exaSearches** (function) `(queries: readonly string[], cities: readonly string[]): string[]`
- **exaPageKey** (function) `(url: string): string`
- **exaRows** (function) `(results: readonly ExaFirm[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **exaSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = EXA_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **exaSearchesDue** (function) `(db: Queryable, searches: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **exaSearchUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; n?: number; platforms?: Iterable<string> }): Promise<ExaSearchUnit>`
- **countExaSearchUnit** (function) `(s: ExaSearchStats, u: ExaSearchUnit): string | null`
- **EXA_SEARCH_COMMAND** (const) `"enrich exa-search"`
- **EXA_SEARCH_BUCKET** (const) `Bucket`
- **ExaFirm** (interface) `interface ExaFirm { url: string; title: string | null; domain: string; raw: unknown; }`
- **exaRef** (function) `(q: string): string`
- **ExaSearchStats** (interface) `interface ExaSearchStats { selected: number; read: number; results: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **emptyExaSearchStats** (function) `(): ExaSearchStats`

## packages/research/src/enrichment/extraction.ts

- **parseExtraction** (function) `(text: string): ExtractionResult | string`
- **groundEmails** (function) `(parsed: ExtractionResult, pageText: string): { parsed: ExtractionResult; dropped: string[] }`
- **buildExtractionPrompt** (function) `(document: PromptDocument, spec: ExtractionSpec = DEFAULT_EXTRACTION_SPEC): string`
- **selectExtractionTargets** (function) `(db: Queryable, llm: LlmClient, opts: ExtractionSelectOptions = {}): Promise<{ targets: ExtractionTarget[]; skippedOlderVersion: number }>`
- **loadExtractionTarget** (function) `(db: Queryable, id: number): Promise<ExtractionTarget | null>`
- **extractDocument** (function) `(db: Queryable, llm: LlmClient, doc: ExtractionTarget, opts: ExtractionUnitOptions = {}): Promise<{ outcome: ExtractionOutcome; ungrounded: string[] }>`
- **runExtraction** (function) `(db: Queryable, llm: LlmClient, opts: ExtractionRunOptions = {}): Promise<ExtractionStats>`
- **applyExtractions** (function) `(db: Queryable, opts: { limit?: number; spec?: ExtractionSpec } = {}): Promise<ApplyExtractionsStats>`
- **PROMPT_VERSION** (const) `"v2"`
- **ExtractedPerson** (const) `z.ZodObject<{ full_name: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; title: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; email: z.ZodPipe<z.ZodOptional<z.ZodNullable…`
- **ExtractionSpec** (interface) `interface ExtractionSpec { promptVersion: string; prompt: string; }`
- **DEFAULT_EXTRACTION_SPEC** (const) `ExtractionSpec`
- **ExtractionStats** (interface) `interface ExtractionStats { selected: number; extracted: number; parse_errors: number; provider_rejected: number; ungrounded_emails: number; skipped_older_version: number; aborted: string | null; }`
- **ApplyExtractionsStats** (interface) `interface ApplyExtractionsStats extends Record<string, unknown> { enrichments_applied: number; }`

## packages/research/src/enrichment/fb-groups.ts

- **groupSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = GROUP_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **groupReadRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = GROUP_READ_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **groupKeywordsDue** (function) `(db: Queryable, niche: string, keywords: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **groupReadsDue** (function) `(db: Queryable, niche: string, opts: { now: Date; limit: number }): Promise<GroupRead[]>`
- **groupSearchUnit** (function) `(db: Queryable, sites: SiteClient, w: { q: string; niche: string; n?: number }): Promise<FbGroupsUnit>`
- **groupAboutUnit** (function) `(db: Queryable, sites: SiteClient, r: { groupId: number; group: string }): Promise<FbGroupsUnit>`
- **groupPostUnit** (function) `(db: Queryable, sites: SiteClient, r: { postId: number; group: string; post: string }): Promise<FbGroupsUnit>`
- **linkDomains** (function) `(links: string | null | undefined): string[]`
- **mapPosts** (function) `(db: Queryable, niche: string, now: Date): Promise<MapStats>`
- **countFbGroupsUnit** (function) `(s: FbGroupsStats, u: FbGroupsUnit): string | null`
- **FB_GROUPS_COMMAND** (const) `"enrich fb-groups"`
- **GROUP_SEARCH_BUCKET** (const) `Bucket`
- **GROUP_READ_BUCKET** (const) `Bucket`
- **wordsOf** (function) `(s: string): string[]`
- **FbGroupsStats** (interface) `interface FbGroupsStats { selected: number; searches: number; groups_found: number; groups_new: number; posts_new: number; abouts: number; posts: number; mapped: number; errors: number; stopped: string | null; }`
- **emptyFbGroupsStats** (function) `(): FbGroupsStats`

## packages/research/src/enrichment/instagram.ts

- **instagramUser** (function) `(link: string): { user: string } | { missing: string }`
- **instagramFindings** (function) `(companyId: number, link: string, read: { profile: InstagramProfile; media: InstagramMedia[] } | { missing: string }): CompanyFindingDraft[]`
- **instagramWork** (function) `(db: Queryable, opts: { niche: string | null; limit: number }): Promise<InstagramWork[]>`
- **instagramRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = INSTAGRAM_BUCKET, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **instagramWaitMs** (function) `(room: number, nextInMs: number, want = INSTAGRAM_MIN_BATCH, bucket: Bucket = INSTAGRAM_BUCKET): number`
- **instagramUnit** (function) `(db: Queryable, sites: SiteClient, w: InstagramWork): Promise<InstagramUnit>`
- **countInstagramUnit** (function) `(stats: InstagramStats, u: InstagramUnit, streak: { errors: number }): string | null`
- **INSTAGRAM_COMMAND** (const) `"enrich instagram"`
- **INSTAGRAM_BUCKET** (const) `Bucket`
- **INSTAGRAM_MIN_BATCH** (const) `30`
- **InstagramAnswer** (type) `type InstagramAnswer = | { found: true; profile: InstagramProfile; media: InstagramMedia[] } | { found: false; reason: string };`
- **instagramDue** (function) `(id: SQL): SQL<unknown>`
- **InstagramStats** (interface) `interface InstagramStats { selected: number; read: number; missing: number; posts: number; errors: number; stopped: string | null; }`
- **emptyInstagramStats** (function) `(): InstagramStats`

## packages/research/src/enrichment/news-triggers.ts

- **triggerQuery** (function) `(word: string, kinds: readonly EventKind[] = TRIGGER_KINDS): string`
- **triggerHits** (function) `(hits: readonly EventHit[], now: Date, kinds: readonly EventKind[] = TRIGGER_KINDS): CompanyEvent[]`
- **triggersRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = TRIGGERS_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **triggersDue** (function) `(db: Queryable, words: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **triggerUnit** (function) `(db: Queryable, deps: { fetcher: Fetcher; llm: LlmClient }, w: { word: string; niche: string; now: Date }): Promise<TriggerUnit>`
- **countTriggerUnit** (function) `(s: TriggersStats, u: TriggerUnit): void`
- **TRIGGERS_COMMAND** (const) `"enrich triggers"`
- **TRIGGERS_SOURCE** (const) `"news_trigger"`
- **TRIGGERS_BUCKET** (const) `Bucket`
- **triggerKey** (function) `(name: string): string | null`
- **TriggersStats** (interface) `interface TriggersStats { selected: number; read: number; hits: number; named: number; matched: number; created: number; kept: number; errors: number; stopped: string | null; }`
- **emptyTriggersStats** (function) `(): TriggersStats`

## packages/research/src/enrichment/opener.ts

- **openerEvidence** (function) `(pages: readonly SitePage[]): EvidencePage[]`
- **buildOpenerPrompt** (function) `(company: string, pages: readonly EvidencePage[]): string`
- **groundOpener** (function) `(proposal: OpenerProposal, pages: readonly EvidencePage[], companyName = ""): { opener: Opener | null; rejected: OpenerRejection | null }`
- **selectOpenerTargets** (function) `(db: Queryable, llm: LlmClient, opts: OpenerSelectOptions = {}): Promise<number[]>`
- **writeOpener** (function) `(db: Queryable, llm: LlmClient, companyId: number, opts: OpenerUnitOptions = {}): Promise<{ outcome: OpenerOutcome; rejected: OpenerRejection | null }>`
- **countOpener** (function) `(stats: OpenerStats, unit: { outcome: OpenerOutcome; rejected: OpenerRejection | null }): void`
- **runOpener** (function) `(db: Queryable, llm: LlmClient, opts: OpenerSelectOptions & OpenerUnitOptions = {}): Promise<OpenerStats>`
- **OPENER_VERSION** (const) `"v1"`
- **OPENER_MAX_WORDS** (const) `25`
- **OpenerProposal** (const) `z.ZodObject<{ line: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; quote: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; source_url: z.ZodPipe<z.ZodOptional<z.ZodNullable…`
- **Opener** (interface) `interface Opener { line: string; quote: string; source_url: string; }`
- **SitePage** (interface) `interface SitePage { url: string; text: string; fetchedAt: Date; }`
- **OpenerStats** (interface) `interface OpenerStats { selected: number; written: number; no_line: number; rejected: Partial<Record<OpenerRejection, number>>; parse_errors: number; provider_rejected: number; no_pages: number; aborted: string | null; }`
- **emptyOpenerStats** (function) `(selected: number): OpenerStats`

## packages/research/src/enrichment/profiles.ts

- **profilesParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **linkedinParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **googleLeft** (function) `(db: Queryable, opts: { now: Date; timezone: string; perDay?: number; signals?: number; also?: Queryable | null }): Promise<number>`
- **linkedinLinks** (function) `(html: string, who: { first: string | null; last: string | null }): { people: string[]; companies: string[] }`
- **profileWork** (function) `(db: Queryable, personIds: readonly number[], opts: { limit?: number; again?: boolean; pages?: PageStore | null } = {}): Promise<ProfileWork[]>`
- **profileUnit** (function) `(db: Queryable, sites: SiteClient, work: ProfileWork, opts: { googleLeft: number; linkedin?: string | null; linkedinCappedUntil?: Date | null; ledger?: ReadLedger | null; runId?: string | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<ProfileUnit>`
- **countProfileUnit** (function) `(stats: ProfileStats, u: ProfileUnit, streak: { errors: number }): string | null`
- **runProfiles** (function) `(db: Queryable, sites: SiteClient, opts: RunProfilesOptions): Promise<ProfileStats>`
- **PROFILES_COMMAND** (const) `"enrich profiles"`
- **GOOGLE_PER_DAY** (const) `400`
- **ProfileUnit** (interface) `interface ProfileUnit { personId: number; person: LookupState | "error"; company: LookupState | "done" | "skipped" | "error"; google: number; googleStopped: boolean; capped: boolean; linkedinCappedUntil: string | null; failedRead: boolean; error: string | null; }`
- **ProfileStats** (interface) `interface ProfileStats { selected: number; people_matched: number; people_unresolved: number; companies_matched: number; companies_unresolved: number; google: number; errors: number; stopped: string | null; }`
- **emptyProfileStats** (function) `(): ProfileStats`

## packages/research/src/enrichment/readings.ts

- **leadershipExcerpt** (function) `(text: string, radius = 2, max = 1500): string`
- **exportReadings** (function) `(db: Queryable, opts: { niche: string; reader: string; limit?: number; maxPerFirm?: number }): Promise<ReadingFirm[]>`
- **loadReadings** (function) `(db: Queryable, opts: { reader: string; promptVersion: string; exported: ReadingFirm[]; results: ReadingResult[]; }): Promise<LoadReadingsStats>`
- **ReadingFirm** (interface) `interface ReadingFirm { company_id: number; name: string | null; domain: string | null; pages: ReadingPage[]; }`
- **ReadingResult** (const) `z.ZodObject<{ company_id: z.ZodNumber; people: z.ZodDefault<z.ZodArray<z.ZodObject<{ full_name: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>; title: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, st…`

## packages/research/src/enrichment/remote-browser.ts

- **openSession** (function) `(opts: Pick<BrowserbaseOptions, "apiKey" | "projectId" | "fetch">): Promise<SessionResponse>`
- **cdpRenderer** (function) `(userAgent: string, opts: CdpOptions): Promise<BrowserRenderer>`
- **browserbaseRenderer** (function) `(userAgent: string, opts: BrowserbaseOptions): Promise<BrowserRenderer>`
- **CdpBrowser** (interface) `interface CdpBrowser { contexts(): CdpContext[]; newContext(opts: { userAgent: string }): Promise<CdpContext>; close(): Promise<void>; }`
- **CdpContext** (interface) `interface CdpContext { setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>; route(url: string, handler: (route: CdpRoute) => Promise<void> | void): Promise<void>; newPage(): Promise<CdpPage>; clearCookies(): Promise<void>; }`
- **CdpPage** (interface) `interface CdpPage { goto( url: string, opts: { waitUntil: "load"; timeout: number }, ): Promise<{ status(): number } | null>; waitForTimeout(ms: number): Promise<void>; content(): Promise<string>; url(): string; close(): Promise<void>; }`

## packages/research/src/enrichment/render.ts

- **browserRenderer** (function) `(userAgent: string): Promise<BrowserRenderer>`
- **emptyRenderStats** (function) `(): RenderStats`
- **addRenderStats** (function) `(total: RenderStats, unit: RenderStats): RenderStats`
- **renderCompany** (function) `(db: Queryable, renderer: Renderer, robotsFetcher: Fetcher, company: Pick<Company, "id" | "domain">, robots: RobotsCache, opts: RenderCompanyOptions = {}): Promise<RenderStats>`
- **climbCompany** (function) `(db: Queryable, ladder: LadderRun, robotsFetcher: Fetcher, company: Pick<Company, "id" | "domain">, robots: RobotsCache, opts: RenderCompanyOptions = {}): Promise<RenderStats>`
- **selectRenderTargets** (function) `(db: Queryable, opts: RenderSelectOptions = {}): Promise<RenderTargets>`
- **countRenderNicheNullSkipped** (function) `(db: Queryable): Promise<number>`
- **runRender** (function) `(db: Queryable, renderer: Renderer, robotsFetcher: Fetcher, opts: RenderRunOptions = {}): Promise<RenderStats>`
- **DEFAULT_LADDER_LIMIT** (const) `40`
- **RenderedPage** (interface) `interface RenderedPage { html: string; finalUrl: string; statusCode: number | null; }`
- **Renderer** (type) `type Renderer = (url: string) => Promise<RenderedPage>;`
- **RenderUnavailable** (class) `override name`
- **BrowserRenderer** (interface) `interface BrowserRenderer { render: Renderer; close(): Promise<void>; }`
- **RenderStats** (interface) `interface RenderStats { companies_rendered: number; pages_stored: number; still_shell: number; render_errors: number; robots_warned: number; homepage_unrendered: number; niche_null_skipped: number; ladder_requests: number; ladder_pages: number; ladder_dead: number; robots_disallowed_urls: string[]; }`

## packages/research/src/enrichment/shard.ts

- **Shard** (class) `parse(text: string): Shard; of(index: number, count: number): Shard; where(idColumn: PgColumn): SQL; toString(): string`

## packages/research/src/enrichment/shared-pages.ts

- **sharedPages** (function) `(main: Db, inner: Fetcher, store?: PageStore | null): Fetcher`

## packages/research/src/enrichment/store.ts

- **upsertEnrichment** (function) `(db: Queryable, input: UpsertEnrichment): Promise<Enrichment>`

## packages/research/src/enrichment/team.ts

- **teamParkedUntil** (function) `(db: Queryable): Promise<Date | null>`
- **teamRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = TEAM_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **teamWork** (function) `(db: Queryable, companyIds: readonly number[], opts: { limit?: number } = {}): Promise<TeamWork[]>`
- **teamUnit** (function) `(db: Queryable, sites: SiteClient, work: TeamWork, opts: { runId?: string | null; now?: () => Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<TeamUnit>`
- **countTeamUnit** (function) `(stats: TeamStats, u: TeamUnit, streak: { errors: number }): string | null`
- **TEAM_COMMAND** (const) `"enrich team"`
- **TEAM_BUCKET** (const) `Bucket`
- **TeamStats** (interface) `interface TeamStats { selected: number; firms_matched: number; firms_unresolved: number; firms_skipped: number; people_added: number; people_filled: number; errors: number; stopped: string | null; }`
- **emptyTeamStats** (function) `(): TeamStats`
- **teamDue** (function) `(id: SQL): SQL<unknown>`

## packages/research/src/enrichment/testimonials.ts

- **isOwnCompany** (function) `(org: string, companyName: string | null | undefined): boolean`
- **classifyTitle** (function) `(title: string | null | undefined, opts: { companyName: string | null | undefined; documentUrl?: string | null | undefined }): TestimonialTag | null`
- **documentUrlFrom** (function) `(person: Pick<Person, "originRef" | "raw">): string | null`
- **tagTestimonials** (function) `(db: Queryable, opts: TagTestimonialsOptions): Promise<TagTestimonialsStats>`
- **TagTestimonialsStats** (interface) `interface TagTestimonialsStats extends Record<string, unknown> { scanned: number; tagged: number; skipped_already_tagged: number; dry_run: boolean; candidates?: TestimonialCandidate[]; }`

## packages/research/src/enrichment/urls.ts

- **parseUrl** (function) `(url: string): URL | null`
- **sameHost** (function) `(url: string, domain: string): boolean`
- **looksLikePeoplePage** (function) `(url: string, anchor: string, hints: readonly string[]): boolean`
- **peoplePageCandidates** (function) `(links: ReadonlyArray<{ url: string; anchor: string }>, domain: string, hints: readonly string[]): string[]`
- **PEOPLE_PAGE_HINTS** (const) `readonly string[]`

## packages/research/src/enrichment/youtube-search.ts

- **channelSite** (function) `(about: string, platforms: Iterable<string> = []): string | null`
- **searchChannels** (function) `(get: YouTubeGet, q: string): Promise<FoundChannel[]>`
- **youtubeSearchRows** (function) `(channels: readonly FoundChannel[], q: string, platforms: Iterable<string> = []): RawRow[]`
- **youtubeSearchRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = YOUTUBE_SEARCH_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **youtubeSearchesDue** (function) `(db: Queryable, searches: readonly string[], opts: { now: Date; limit: number }): Promise<string[]>`
- **youtubeSearchUnit** (function) `(db: Queryable, get: YouTubeGet, w: { q: string; niche: string; platforms?: Iterable<string> }): Promise<YouTubeSearchUnit>`
- **countYouTubeSearchUnit** (function) `(s: YouTubeSearchStats, u: YouTubeSearchUnit): string | null`
- **YOUTUBE_SEARCH_COMMAND** (const) `"enrich youtube-search"`
- **YOUTUBE_SEARCH_BUCKET** (const) `Bucket`
- **youtubeSearchRef** (function) `(q: string): string`
- **FoundChannel** (interface) `interface FoundChannel { id: string; snippet?: { title?: string; description?: string }; [part: string]: unknown; }`
- **YouTubeSearchStats** (interface) `interface YouTubeSearchStats { selected: number; read: number; channels: number; created: number; seen: number; errors: number; stopped: string | null; }`
- **emptyYouTubeSearchStats** (function) `(): YouTubeSearchStats`

## packages/research/src/enrichment/youtube.ts

- **youtubeApi** (function) `(token: () => Promise<string>, fetch: typeof globalThis.fetch = globalThis.fetch): YouTubeGet`
- **youtubeKeyApi** (function) `(key: string, fetch: typeof globalThis.fetch = globalThis.fetch): YouTubeGet`
- **channelRef** (function) `(link: string): ChannelRef | { missing: string }`
- **seconds** (function) `(iso: string | undefined): number | null`
- **readChannel** (function) `(get: YouTubeGet, ref: ChannelRef): Promise<Channel | null>`
- **readUploads** (function) `(get: YouTubeGet, playlistId: string, limit = UPLOADS): Promise<Upload[]>`
- **youtubeFindings** (function) `(companyId: number, link: string, read: { channel: Channel; uploads: Upload[] } | { missing: string }): CompanyFindingDraft[]`
- **youtubeWork** (function) `(db: Queryable, opts: { niche: string | null; limit: number }): Promise<YouTubeWork[]>`
- **youtubeRoom** (function) `(db: Queryable, now: Date, bucket: Bucket = YOUTUBE_BUCKET, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **youtubeReadRoom** (function) `(db: Queryable, main: Queryable, client: string | null, now: Date, bucket: Bucket = YOUTUBE_BUCKET): Promise<{ room: number; nextInMs: number }>`
- **youtubeUnit** (function) `(db: Queryable, get: YouTubeGet, w: YouTubeWork): Promise<YouTubeUnit>`
- **clientYouTube** (function) `(o: { client: string; keys: VendorKeys; wren: YouTubeGet; own: (key: string) => YouTubeGet; part: string; runId?: string | null; }): YouTubeGet`
- **countYouTubeUnit** (function) `(stats: YouTubeStats, u: YouTubeUnit, streak: { errors: number }): string | null`
- **YOUTUBE_COMMAND** (const) `"enrich youtube"`
- **YOUTUBE_READ_SCOPE** (const) `"https://www.googleapis.com/auth/youtube.readonly"`
- **YOUTUBE_BUCKET** (const) `Bucket`
- **YOUTUBE_MIN_BATCH** (const) `100`
- **CHANNEL_PARTS** (const) `"snippet,contentDetails,statistics,brandingSettings,topicDetails,status,localizations"`
- **YouTubeError** (class) `constructor(readonly status: number, readonly reason: string, message: string); get quota(): boolean`
- **YouTubeGet** (type) `type YouTubeGet = (resource: string, query: Record<string, string>) => Promise<unknown>;`
- **Channel** (interface) `interface Channel { id: string; title: string; handle: string | null; about: string; country: string | null; subscribers: number | null; videos: number | null; views: number | null; keywords: string | null; topics: string[]; publishedAt: string | null; uploads: string | null; raw: unknown; }`
- **Upload** (interface) `interface Upload { videoId: string; title: string; description: string; publishedAt: string; views: number | null; likes: number | null; comments: number | null; seconds: number | null; tags: string[]; live: boolean; raw: unknown; }`
- **youtubeDue** (function) `(id: SQL): SQL<unknown>`
- **READ_UNITS** (const) `3`
- **YouTubeStats** (interface) `interface YouTubeStats { selected: number; read: number; missing: number; uploads: number; errors: number; stopped: string | null; }`
- **emptyYouTubeStats** (function) `(): YouTubeStats`

## packages/research/src/fetch/datasets.ts

- **fetchDataset** (function) `(fetcher: PoliteFetcher, dataset: Dataset, opts: { limit: number; destRoot: string; onFile?: (file: FetchedFile) => void }): Promise<FetchedFile[]>`
- **RemoteFile** (interface) `interface RemoteFile { dataset: string; fileName: string; url: string; period: string; }`
- **Dataset** (interface) `interface Dataset { name: string; description: string; listFiles: (fetcher: PoliteFetcher, limit: number) => Promise<RemoteFile[]>; download?: (fetcher: PoliteFetcher, remote: RemoteFile, dest: string) => Promise<DownloadResult>; }`

## packages/research/src/fetch/overture.ts

- **parseReleases** (function) `(listingXml: string): string[]`
- **placesCopySql** (function) `(spec: OverturePlacesSpec, release: string, dest: string): string`
- **overturePlaces** (function) `(spec: OverturePlacesSpec): Dataset`
- **OVERTURE_BUCKET** (const) `"overturemaps-us-west-2"`
- **OverturePlacesSpec** (interface) `interface OverturePlacesSpec { name: string; description: string; categories: readonly string[]; countries: readonly string[]; }`

## packages/research/src/fetch/ppp.ts

- **parsePppFileLinks** (function) `(html: string): { fileName: string; url: string; release: string }[]`
- **filterLoanCsv** (function) `(input: Readable, output: NodeJS.WritableStream, naics: ReadonlySet<string>): Promise<{ read: number; kept: number }>`
- **pppLoans** (function) `(spec: PppLoansSpec): Dataset`
- **PPP_DATASET_PAGE** (const) `"https://data.sba.gov/dataset/ppp-foia"`

## packages/research/src/fetch/sba.ts

- **sbaSearchBody** (function) `(naics: string): Record<string, unknown>`
- **checkSbaAnswer** (function) `(text: string, naics: string): number`
- **sbaSearch** (function) `(spec: SbaSearchSpec, today = () => new Date()): Dataset`
- **SBA_SEARCH_URL** (const) `"https://search.certifications.sba.gov/_api/v2/search"`

## packages/research/src/findings.ts

- **signalDate** (function) `(d: Pick<Draft, "kind" | "value" | "sourceUrl" | "signalAt" | "dated">, now: Date = new Date()): { at: Date; dated: SignalDated } | null`
- **signalRefusal** (function) `(d: Draft): string | null`
- **keepSignal** (function) `(db: Queryable, draft: SignalDraft): Promise<{ ok: true; id: number } | { ok: false; reason: string }>`
- **keepDocument** (function) `(db: Queryable, draft: DocumentDraft): Promise<number>`
- **keepingAnswers** (function) `(sites: SiteClient, db: Queryable): SiteClient`
- **keepFinding** (function) `(db: Queryable, draft: FindingDraft | CompanyFindingDraft): Promise<number>`
- **DocumentDraft** (interface) `interface DocumentDraft { url: string; kind: Exclude<DocumentKind, "pdf">; title: string | null; text: string; fetchTier: string; }`
- **FindingDraft** (interface) `interface FindingDraft extends Draft { personId: number; }`
- **CompanyFindingDraft** (interface) `interface CompanyFindingDraft extends Draft { companyId: number; }`
- **SignalDraft** (type) `type SignalDraft = (FindingDraft | CompanyFindingDraft) & { signalAt: Date; dated: SignalDated; };`

## packages/research/src/limits.ts

- **collectorsWithLimits** (function) `(main: Queryable, collectors: readonly C[]): Promise<C[]>`
- **googleLimits** (function) `(main: Queryable): Promise<{ perDay: number; signals: number }>`
- **INSTAGRAM_LIMIT** (const) `LimitDef`
- **YOUTUBE_LIMIT** (const) `LimitDef`
- **YOUTUBE_SEARCH_LIMIT** (const) `LimitDef`
- **AD_LIBRARY_LIMIT** (const) `LimitDef`
- **GROUP_SEARCH_LIMIT** (const) `LimitDef`
- **GROUP_READ_LIMIT** (const) `LimitDef`
- **EXA_SEARCH_LIMIT** (const) `LimitDef`
- **TRIGGERS_LIMIT** (const) `LimitDef`
- **TEAM_LIMIT** (const) `LimitDef`
- **RESEARCH_LIMITS** (const) `readonly LimitDef[]`

## packages/research/src/linkedin-reads.ts

- **accountRoom** (function) `(main: Queryable, client: string | null, now: Date = new Date()): Promise<number>`
- **readLedger** (function) `(main: Db, o: { client: string | null; part: string; runId?: string | null }): ReadLedger`
- **postOfUrl** (function) `(url: string): { vanity: string; urn: string; id: string } | null`
- **idTime** (function) `(id: string, now: Date): Date | null`
- **ACCOUNT_VENDOR** (const) `"linkedin"`
- **SEARCH_VENDOR** (const) `"linkedin_search"`
- **ReadSource** (type) `type ReadSource = "search" | "account";`
- **vendorOfSource** (function) `(s: ReadSource): string`
- **ReadLedger** (interface) `interface ReadLedger { room(): Promise<number>; served(source: ReadSource, units?: number): Promise<void>; }`

## packages/research/src/pacing.ts

- **searchStopped** (function) `(err: unknown, site: string): Stopped | null`
- **retryAfter** (function) `(err: unknown): number | null`
- **paced** (function) `(sites: SiteClient, clock: () => Date, sleep: (ms: number) => Promise<void>): <T>(site: string, method: import("@wren/core/content").SiteMethod, path: string, input?: Record<string, unknown> | undefined, account?: string | undefined) => Promise<T>`
- **Capped** (class) `constructor(readonly site: string, readonly retryAt: Date, readonly why: string)`
- **refusedBy** (function) `(err: unknown): number | null`
- **failedRead** (function) `(err: unknown, site: string): boolean`
- **Stopped** (interface) `interface Stopped { until: Date | null; why: string; }`
- **realSleep** (function) `(ms: number): Promise<void>`

## packages/research/src/pages.ts

- **s3PageStore** (function) `(bucket: string, client: S3Client = new S3Client({})): PageStore`
- **memoryPageStore** (function) `(): PageStore & { keys(): string[] }`
- **telHrefs** (function) `(html: string): string[]`
- **htmlOf** (function) `(doc: { html: string | null; htmlKey: string | null }, store: PageStore | null | undefined): Promise<string | null>`
- **archivePages** (function) `(db: Queryable, store: PageStore, opts: ArchiveOptions): Promise<ArchiveStats>`
- **pageCounts** (function) `(db: Queryable): Promise<{ inline: number; archived: number }>`
- **PageStore** (interface) `interface PageStore { put(key: string, html: string): Promise<void>; get(key: string): Promise<string>; }`
- **pageKey** (function) `(documentId: number): string`
- **ArchiveStats** (interface) `interface ArchiveStats { moved: number; chars: number; more: boolean; }`

## packages/research/src/people/contacts.ts

- **splitName** (function) `(full: string): { first: string; last: string } | null`
- **findContacts** (function) `(sites: SiteClient, firm: Firm, opts: ContactsOptions = {}): Promise<FoundContact[]>`

## packages/research/src/people/elsewhere.ts

- **pageOf** (function) `(url: string, title: string, subject: ElsewhereSubject): Page | null`
- **nameIn** (function) `(title: string): string`
- **queriesFor** (function) `(s: ElsewhereSubject): string[]`
- **searchElsewhere** (function) `(call: <T>(...args: Parameters<SiteClient["call"]>) => Promise<T>, s: ElsewhereSubject): Promise<ElsewhereRun>`
- **HITS_PER_QUERY** (const) `8`
- **ElsewhereHit** (interface) `interface ElsewhereHit { kind: "handle" | "link"; platform: string; value: string; url: string; title: string; confidence: number; matched: { name: boolean; firm: boolean; handle: boolean }; query: string; }`
- **ElsewhereSubject** (interface) `interface ElsewhereSubject { firstName: string | null; lastName: string | null; firm: Firm; handles: { platform: string; handle: string }[]; }`
- **Page** (interface) `interface Page { kind: "handle" | "link"; platform: string; value: string; url: string; }`

## packages/research/src/people/fit-traits.ts

- **fitTraitsOf** (function) `(db: Queryable, profile: number, facts: ProfileFacts): Promise<PersonTraits>`

## packages/research/src/people/lookup.ts

- **emailFindings** (function) `(s: LookupSubject): FindingDraft[]`
- **lookUpPerson** (function) `(sites: SiteClient, s: LookupSubject, opts: LookupOptions): Promise<LookupResult>`
- **LookupSubject** (interface) `interface LookupSubject { personId: number | null; firstName: string | null; lastName: string | null; firm: Firm; linkedinUrl: string | null; pageLinks?: string[]; email: { address: string; result: string; verifier: string } | null; handles?: { platform: string; handle: string }[]; }`
- **Tried** (interface) `interface Tried { step: | "email" | "cache" | "google" | "search" | "profile" | "linkedin search" | "elsewhere" | "capped"; what: string; outcome: string; }`
- **LookupResult** (interface) `interface LookupResult { state: LookupState; profile: ProfileLink | null; findings: FindingDraft[]; tried: Tried[]; retryAt: Date | null; cappedBy: string | null; pages: DocumentDraft[]; googleStopped: Stopped | null; accountReads: number; elsewhere?: ElsewhereHit[]; }`
- **LookupOptions** (interface) `interface LookupOptions { linkedin: string | null; google?: boolean; linkedinCappedUntil?: Date | null; accountReads?: number; elsewhere?: boolean; now?: () => Date; sleep?: (ms: number) => Promise<void>; }`
- **CACHE_VIA** (const) `"exa-cache"`
- **searched** (function) `(t: { step: string; what: string }): boolean`

## packages/research/src/people/names.ts

- **sameName** (function) `(want: NameParts, seen: string): boolean`
- **sameCompany** (function) `(a: string, b: string): boolean`
- **bareCompanyName** (function) `(name: string): string`
- **mentionsFirm** (function) `(text: string, firm: Firm, except: string[] = []): boolean`
- **isFirm** (function) `(name: string, firm: Firm): boolean`
- **plain** (function) `(s: string): string`
- **companyPhrase** (function) `(name: string): string`
- **domainLabel** (function) `(domain: string): string`
- **Firm** (interface) `interface Firm { name: string | null; domain: string | null; }`
- **firmNames** (function) `(firm: Firm): string[]`

## packages/research/src/people/profile-link.ts

- **linkedinProfile** (function) `(url: string): ProfileLink | null`
- **ProfileLink** (interface) `interface ProfileLink { url: string; vanity: string; }`

## packages/research/src/people/profile-research.ts

- **firmOfRole** (function) `(role: string): string | null`
- **firmOf** (function) `(f: ProfileFacts): Firm`
- **subjectOf** (function) `(f: ProfileFacts): LookupSubject`
- **readProfileFacts** (function) `(db: Queryable, profileId: number): Promise<ProfileFacts>`
- **findingsOf** (function) `(r: LookupResult, held: { platform: string; handle: string }[] = []): FindingRow[]`
- **errorWords** (function) `(err: unknown): string`
- **beginProfileResearch** (function) `(db: Queryable, lookupId: number): Promise<{ profileId: number; subject: LookupSubject } | null>`
- **failProfileResearch** (function) `(db: Queryable, lookupId: number, error: string): Promise<void>`
- **researchPlan** (function) `(db: Queryable, o: { now: Date; timezone: string; perDay?: number }): Promise<{ google: number; linkedinUntil: string | null }>`
- **researchProfile** (function) `(db: Queryable, sites: SiteClient, lookupId: number, opts: { googleLeft: number; linkedin?: string | null; linkedinCappedUntil?: Date | null; ledger?: ReadLedger | null; now?: () => Date; sleep?: (ms: number) => Promise<void>; }): Promise<ProfileResearchResult>`
- **ProfileFacts** (interface) `interface ProfileFacts { name: string | null; emails: string[]; handles: { platform: string; handle: string; url: string | null }[]; person: { fullName: string; firstName: string | null; lastName: string | null; title: string | null; company: string | null; domain: string | null; linkedinUrl: string | null; } | null; employers: string[]; }`

## packages/research/src/people/store.ts

- **recordLookup** (function) `(db: Queryable, personId: number, r: LookupResult, runId: string | null = null): Promise<void>`

## packages/research/src/people/team.ts

- **teamQuery** (function) `(firm: Firm): string | null`
- **keepTeam** (function) `(firm: Firm, profiles: readonly TeamProfile[]): TeamMember[]`
- **searchTeam** (function) `(sites: SiteClient, firm: Firm, opts: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<TeamSearchResult | null>`
- **TeamProfile** (interface) `interface TeamProfile { name: string; url: string; headline: string | null; roles: { title: string; company: string; current: boolean }[]; }`
- **TeamMember** (interface) `interface TeamMember { fullName: string; firstName: string; lastName: string; title: string; linkedin: string; vanity: string; }`

## packages/research/src/phones.ts

- **toUsE164** (function) `(raw: string): string | null`
- **isTollFree** (function) `(e164: string): boolean`
- **phonesOf** (function) `(tels: readonly string[], text: string | null): FoundPhone[]`

## packages/research/src/records.ts

- **RESEARCH_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/research/src/restate/discovery.ts

- **makeDiscovery** (function) `(deps: DiscoveryDeps): restate.VirtualObjectDefinition<"Discovery", { discover: (ctx: restate.ObjectContext, input?: DiscoveryInput) => Promise<DiscoveryStats>; verify: (ctx: restate.ObjectContext, input?: DiscoveryInput) => Promise<DomainVerificationStats>; }>`
- **DiscoveryDeps** (interface) `interface DiscoveryDeps { db: Db; clientDb?: ((client: string) => Db) | null; fetcher: Fetcher | null; genericWordsFor?: (niche: string | null) => ReadonlySet<string>; resolves?: Resolves; fetchHomepage?: HomepageFetcher; }`
- **Discovery** (type) `type Discovery = ReturnType<typeof makeDiscovery>;`

## packages/research/src/restate/enrichment-context.ts

- **ALL_NICHES** (const) `"all"`
- **CrawlInput** (interface) `interface CrawlInput { limit?: number; shard?: string; pagesPerSite?: number; extraHints?: string[]; }`
- **clientBlock** (function) `(main: Queryable, key: string, component: string): Promise<{ client: string; block: unknown; accounts: Record<string, string> } | null>`
- **EnrichmentDeps** (interface) `interface EnrichmentDeps { db: Db; clientDb?: ((client: string) => Db) | null; fetcher: Fetcher | null; llm: LlmClient; clientLlm?: ((client: string, part: string, runId: string | null) => LlmClient) | null; renderer?: (() => Promise<BrowserRenderer>) | null; tracer?: Tracer; extractionSpec?: ExtractionSpec; renderJitter?: readonly [number, number]; renderIdleMs?: number; crawlHintsFor?: (niche: string | null) => ReadonlySet<string>; pages?: PageStore | null; sites?: SiteClient | null; linkedin?: string | null; recheck?: (db: Queryable, companyIds: number[]) => Promise<unknown>; youtube?: YouTubeGet | null; keys?: KeyStore | null; instagram?: SiteClient | null; ladder?: SiteClient | null; desk?: SiteClient | null; adsFor?: (niche: string) => { keywords: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; groupsFor?: (niche: string) => { keywords: readonly string[] } | null; exaSites?: SiteClient | null; exaFor?: (niche: string) => { queries: readonly string[]; cities: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; triggersFor?: (niche: string) => { words: readonly string[]; screen: CompanyScreen | null; } | null; youtubeSearchFor?: (niche: string) => { queries: readonly string[]; platforms: Iterable<string>; screen: CompanyScreen | null; } | null; }`
- **keyScope** (function) `(key: string, main: Db, clientDb?: ((client: string) => Db) | null): { db: Db; niche: string | null }`
- **LimitInput** (interface) `interface LimitInput { limit?: number; }`

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

- **makePageArchive** (function) `(deps: PageArchiveDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ArchiveStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ArchiveStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **PAGE_ARCHIVE_KEY** (const) `"all"`
- **PageArchive** (type) `type PageArchive = ReturnType<typeof makePageArchive>;`

## packages/research/src/restate/profile-research.ts

- **makeProfileResearch** (function) `(deps: ProfileResearchDeps): restate.VirtualObjectDefinition<"ProfileResearch", { run: (ctx: restate.ObjectContext, input: ProfileResearchInput) => Promise<ProfileResearchStats>; }>`
- **ProfileResearchStats** (interface) `interface ProfileResearchStats { state: "matched" | "unresolved" | "capped" | "failed" | "skipped"; findings: number; google: number; error?: string; }`
- **ProfileResearch** (type) `type ProfileResearch = ReturnType<typeof makeProfileResearch>;`

## packages/research/src/schema.ts

- **DOCUMENT_KINDS** (const) `readonly ["webpage", "pdf", "snippet", "profile", "video", "post", "audio"]`
- **DocumentKind** (type) `type DocumentKind = (typeof DOCUMENT_KINDS)[number];`
- **ENRICHMENT_KINDS** (const) `readonly ["people_extraction", "firmographics", "email_scan", "contact_scan", "email_pick", "opener", "video"]`
- **EnrichmentKind** (type) `type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];`
- **documents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "documents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "documents"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **fetchTiers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "fetch_tiers"; schema: undefined; columns: { domain: import("drizzle-orm/pg-core").PgColumn<{ name: "domain"; tableName: "fetch_tiers"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **enrichments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "enrichments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "enrichments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **Document** (type) `type Document = typeof documents.$inferSelect;`
- **NewDocument** (type) `type NewDocument = typeof documents.$inferInsert;`
- **Enrichment** (type) `type Enrichment = typeof enrichments.$inferSelect;`
- **NewEnrichment** (type) `type NewEnrichment = typeof enrichments.$inferInsert;`
- **DISCOVERY_KINDS** (const) `readonly ["discover", "verify"]`
- **DiscoveryKind** (type) `type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];`
- **DISCOVERY_OUTCOMES** (const) `readonly ["attached", "verified", "no_name", "no_candidate", "unreachable", "gate_rejected"]`
- **DiscoveryOutcome** (type) `type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];`
- **discoveryAttempts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "discovery_attempts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "discovery_attempts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **DiscoveryAttempt** (type) `type DiscoveryAttempt = typeof discoveryAttempts.$inferSelect;`
- **FINDING_KINDS** (const) `readonly ["job_change", "still_there", "left", "hiring", "post", "news", "profile", "stack", "site_change", "talk", "demand", "fact"]`
- **FindingKind** (type) `type FindingKind = (typeof FINDING_KINDS)[number];`
- **FINDING_BYS** (const) `readonly ["model", "code", "hand"]`
- **Proof** (type) `type Proof = | { t: number; len?: number } | { quote: string } | { frame: number } | { method: string };`
- **SIGNAL_KINDS** (const) `readonly ["news", "post", "hiring", "job_change", "stack", "site_change", "talk", "demand"]`
- **SignalKind** (type) `type SignalKind = (typeof SIGNAL_KINDS)[number];`
- **SIGNAL_DATED** (const) `readonly ["published", "approx", "seen"]`
- **SignalDated** (type) `type SignalDated = (typeof SIGNAL_DATED)[number];`
- **findings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "findings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "findings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **Finding** (type) `type Finding = typeof findings.$inferSelect;`
- **researchSignals** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"research_signals", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "research_signals"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryK…`
- **CONTACT_KINDS** (const) `readonly ["phone", "linkedin_company", "linkedin_person", "x", "instagram", "facebook", "youtube", "tiktok"]`
- **ContactKind** (type) `type ContactKind = (typeof CONTACT_KINDS)[number];`
- **CONTACT_SOURCES** (const) `readonly ["link", "text"]`
- **ContactSource** (type) `type ContactSource = (typeof CONTACT_SOURCES)[number];`
- **contactPoints** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contact_points"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "contact_points"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **ContactPoint** (type) `type ContactPoint = typeof contactPoints.$inferSelect;`
- **OWN_CONTACT_MAX_FIRMS** (const) `5`
- **ownContactPoints** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"own_contact_points", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "own_contact_points"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrim…`
- **LOOKUP_STATES** (const) `readonly ["matched", "unresolved", "capped"]`
- **LookupState** (type) `type LookupState = (typeof LOOKUP_STATES)[number];`
- **personLookups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "person_lookups"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "person_lookups"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`
- **PersonLookup** (type) `type PersonLookup = typeof personLookups.$inferSelect;`
- **companyLookups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_lookups"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_lookups"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`
- **CompanyLookup** (type) `type CompanyLookup = typeof companyLookups.$inferSelect;`
- **teamSearches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "team_searches"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "team_searches"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`
- **TeamSearch** (type) `type TeamSearch = typeof teamSearches.$inferSelect;`
- **COMPANY_CHECK_STATES** (const) `readonly ["hiring", "no_openings", "unresolved", "capped"]`
- **CompanyCheckState** (type) `type CompanyCheckState = (typeof COMPANY_CHECK_STATES)[number];`
- **companyChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_checks"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNu…`
- **CompanyCheck** (type) `type CompanyCheck = typeof companyChecks.$inferSelect;`
- **EVENT_CHECK_STATES** (const) `readonly ["found", "none", "unresolved", "capped"]`
- **companyEventChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "company_event_checks"; schema: undefined; columns: { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "company_event_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | n…`
- **SIGNAL_CHECK_STATES** (const) `readonly ["found", "none", "unresolved", "capped"]`
- **SignalCheckState** (type) `type SignalCheckState = (typeof SIGNAL_CHECK_STATES)[number];`
- **signalChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "signal_checks"; schema: undefined; columns: { collector: import("drizzle-orm/pg-core").PgColumn<{ name: "collector"; tableName: "signal_checks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **SignalCheck** (type) `type SignalCheck = typeof signalChecks.$inferSelect;`
- **studies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "studies"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "studies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **Study** (type) `type Study = typeof studies.$inferSelect;`
- **STUDY_STEPS** (const) `readonly ["plan", "search", "ask", "read", "claims", "draft"]`
- **StudyStep** (type) `type StudyStep = (typeof STUDY_STEPS)[number];`
- **STUDY_OUTCOMES** (const) `readonly ["ok", "empty", "refused", "failed"]`
- **StudyOutcome** (type) `type StudyOutcome = (typeof STUDY_OUTCOMES)[number];`
- **studySteps** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "study_steps"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "study_steps"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **StudyStepRow** (type) `type StudyStepRow = typeof studySteps.$inferSelect;`

## packages/research/src/signals/collectors.ts

- **signalSettings** (function) `(db: Queryable): Promise<SignalsSettings>`
- **COLLECTORS** (const) `readonly Collector[]`
- **collectorNamed** (function) `(name: string): Collector<z.ZodObject<z.core.$ZodLooseShape, z.core.$strip>> | null`
- **anyCollectorBuilt** (function) `(): boolean`
- **signalsSettingsSchema** (const) `z.ZodObject<{ [x: string]: z.ZodPrefault<z.ZodObject<{ [x: string]: any; on: z.ZodDefault<z.ZodBoolean>; }, z.core.$strip>>; }, z.core.$strict>`
- **signalSettingsOf** (function) `(block: unknown): SignalsSettings`

## packages/research/src/signals/index.ts

- **defineCollector** (function) `(c: Collector<S>): Collector<S>`
- **subjectOf** (function) `(key: string): { companyId: number } | { personId: number } | null`
- **firmOf** (function) `(db: Queryable, id: number): Promise<Firm | null>`
- **personOf** (function) `(db: Queryable, id: number): Promise<Person | null>`
- **queuedFirms** (function) `(db: Queryable, limit: number): Promise<number[]>`
- **passOf** (function) `(db: Queryable, niche: string | null, personIds: readonly number[], companyIds: readonly number[] = []): Promise<Pass>`
- **collectorRoom** (function) `(db: Queryable, c: Pick<Collector, "name" | "bucket">, now: Date, also: Queryable | null = null): Promise<{ room: number; nextInMs: number }>`
- **signalPlan** (function) `(db: Queryable, collectors: readonly Collector[], settings: SignalsSettings, pass: Pass, opts: { now: Date; limit?: number | undefined; only?: string | null | undefined; also?: Queryable | null; gate?: (vendor: string, units: number) => Promise<Gate>; }): Promise<CollectorPlan[]>`
- **signalUnit** (function) `(c: Collector, subject: string, s: CollectorSettings, base: BaseDeps, opts: { timezone: string; runId?: string | null; dry?: boolean; meter?: ((vendors: readonly string[]) => Promise<void>) | null; google?: { perDay: number; signals: number }; }): Promise<SignalUnit>`
- **planStats** (function) `(stats: SignalsStats, p: CollectorPlan): CollectorStats`
- **countSignalUnit** (function) `(stats: SignalsStats, c: CollectorStats, u: SignalUnit | { ok: false; reason: string }): string | null`
- **runSignals** (function) `(collectors: readonly Collector[], settings: SignalsSettings, base: BaseDeps, opts: { pass: Pass; timezone: string; limit?: number; only?: string | null; dry?: boolean; runId?: string | null; meter?: ((collector: string, vendors: readonly string[]) => Promise<void>) | null; google?: { perDay: number; signals: number }; onUnit?: (u: SignalUnit | { collector: string; subject: string; error: string }) => void; }): Promise<SignalsStats>`
- **signalsFor** (function) `(db: Queryable, q: { companyId?: number; personId?: number; since?: Date; kinds?: readonly SignalKind[]; limit?: number; }): Promise<Signal[]>`
- **SIGNALS_COMMAND** (const) `"enrich signals"`
- **SIGNALS_COMPONENT** (const) `"research.signals"`
- **SIGNALS_HELD** (const) `"research.signals"`
- **SIGNALS_GOOGLE_PER_DAY** (const) `100`
- **SIGNALS_LIMIT** (const) `20`
- **ONCE** (const) `36500`
- **Tried** (interface) `interface Tried { step: string; what: string; outcome: string; [more: string]: unknown; }`
- **Collected** (interface) `interface Collected { state: SignalCheckState; signals: SignalDraft[]; tried: Tried[]; answer?: unknown; retryAt?: Date | null; stop?: string; spent?: readonly string[]; }`
- **SignalDeps** (interface) `interface SignalDeps { db: Queryable; sites: SiteClient | null; desk: SiteClient | null; fetcher: Fetcher | null; pages: PageStore | null; youtube: YouTubeGet | null; llm: LlmClient | null; linkedin: string | null; linkedinReads?: string | null; linkedinRoom?: (() => Promise<number>) | null; also?: Queryable | null; googleLeft: number; now: Date; }`
- **Pass** (interface) `interface Pass { niche: string | null; personIds: number[]; companyIds: number[]; }`
- **Collector** (interface) `interface Collector<S extends z.ZodObject = z.ZodObject> { name: string; subject: SignalSubject; built: boolean; settings: S; bucket: Bucket; everyDays: number; metered: boolean; vendors?: readonly string[]; spends?(subject: string): readonly string[]; subjects?(db: Queryable, pass: Pass, s: z.infer<S>): Promise<string[]>; collect(deps: SignalDeps, subject: string, s: z.infer<S>): Promise<Collected>; }`
- **SignalsSettings** (type) `type SignalsSettings = Record<string, CollectorSettings>;`
- **firmKey** (function) `(id: number): string`
- **personKey** (function) `(id: number): string`
- **Firm** (interface) `interface Firm { id: number; name: string | null; domain: string | null; niche: string | null; country: string | null; linkedinUrl: string | null; }`
- **Person** (interface) `interface Person { id: number; fullName: string; firstName: string | null; lastName: string | null; title: string | null; linkedinUrl: string | null; firm: Firm; }`
- **readAccount** (function) `(pool: string | null | undefined): string | null`
- **BaseDeps** (type) `type BaseDeps = Omit<SignalDeps, "googleLeft" | "now">;`
- **SignalsStats** (interface) `interface SignalsStats { checked: number; kept: number; collectors: Record<string, CollectorStats>; }`
- **emptySignalsStats** (function) `(): SignalsStats`
- **Signal** (type) `type Signal = typeof researchSignals.$inferSelect;`

## packages/research/src/signals/linkedin.ts

- **clientLinkedin** (function) `(accounts: Readonly<Record<string, string>> | null): string | null`
- **WREN_LINKEDIN** (const) `ReadonlySet<string>`

## packages/research/src/social-schema.ts

- **SOCIAL_NETWORKS** (const) `readonly ["facebook"]`
- **SocialNetwork** (type) `type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];`
- **POST_MAPPINGS** (const) `readonly ["link", "author", "name"]`
- **PostMapping** (type) `type PostMapping = (typeof POST_MAPPINGS)[number];`
- **socialSearches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_searches"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_searches"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **socialGroups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_groups"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_groups"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **SocialGroup** (type) `type SocialGroup = typeof socialGroups.$inferSelect;`
- **socialPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_posts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_posts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **SocialPost** (type) `type SocialPost = typeof socialPosts.$inferSelect;`

## packages/research/src/sops/cites.ts

- **expandCites** (function) `(md: string): string`
- **numberCites** (function) `(dir: string, md: string): Promise<string>`

## packages/research/src/sops/index.ts

- **toSource** (function) `(read: VideoRead, priority = DEFAULT_PRIORITY): Source`
- **driveSources** (function) `(folderId: string, drive: DriveGet, priority = DEFAULT_PRIORITY, path = ""): Promise<Source[]>`
- **fileSource** (function) `(file: string, priority = DEFAULT_PRIORITY): Promise<Source>`
- **sopPrompt** (function) `(input: SopInput): string`
- **readSopDir** (function) `(dir: string): Promise<SopDir>`
- **addSource** (function) `(dir: string, source: Source): Promise<string>`
- **extractPoints** (function) `(dir: string, llm: LlmClient, only?: string): Promise<string[]>`
- **writeSkill** (function) `(dir: string): Promise<string>`
- **buildSop** (function) `(dir: string, llm: LlmClient): Promise<string>`
- **DEFAULT_PRIORITY** (const) `5`
- **Source** (interface) `interface Source { name: string; md: string; }`
- **youtubeSource** (function) `(url: string, ytDlp: string, priority = DEFAULT_PRIORITY, opts: { video?: Model | null; fetchFn?: typeof fetch } = {}): Promise<Source>`
- **youtubeByUrl** (function) `(url: string, opts: { model: Model; fetchFn?: typeof fetch; durationS?: number | null | undefined; priority?: number; }): Promise<Source>`
- **videoSource** (function) `(url: string, ytDlp: string, priority = DEFAULT_PRIORITY, opts: Omit<WatchOptions, "ytDlp">): Promise<Source>`
- **audioSource** (function) `(audioUrl: string, opts: { url: string; title?: string | null; creator?: string | null; model: Model; fetchFn?: typeof fetch; ffmpeg?: string; priority?: number; }): Promise<Source>`
- **DriveGet** (type) `type DriveGet = (path: string, body: Record<string, unknown>) => Promise<unknown>;`
- **STYLE** (const) `"Style: short plain sentences a person would say out loud. Lead with the action. Fewer words, more signal. No filler, no hedging, no hype, no jargon, no restating. No \"not X but Y\" contrasts, no one-line closers that repeat the point, no colon reveals, no dashes, no forced groups of three, no bold…`

## packages/research/src/studies/recipes.ts

- **questionStudy** (function) `(question: string, angles: readonly string[] = []): StudyInput`
- **verticalStudy** (function) `(b: VerticalBrief): StudyInput`
- **StudyInput** (interface) `interface StudyInput { question: string; angles: string[]; drafts: StudyDraftSpec[]; }`

## packages/research/src/studies/run.ts

- **openStudy** (function) `(db: Queryable, slug: string, input: StudyInput, niche: string | null = null): Promise<Study>`
- **addStudyPage** (function) `(db: Queryable, slug: string, page: HeldPage, now = new Date()): Promise<{ key: string; added: boolean }>`
- **runStudy** (function) `(db: Queryable, deps: StudyDeps, slug: string, opts: StudyRunOptions = {}): Promise<StudyStats>`
- **studyClaims** (function) `(db: Queryable, slug: string): Promise<StudyClaim[]>`
- **callStudyClaims** (function) `(db: Queryable, slug: string, numbers: readonly number[], call: ClaimCall, by: string, comment: string | null = null): Promise<StudyClaim[]>`
- **studyView** (function) `(db: Queryable, slug: string): Promise<StudyView>`
- **pageTitle** (function) `(title: string | null | undefined): string | null`
- **manualOf** (function) `(r: StudyStepRow): ManualPage | null`
- **claimKey** (function) `(document: number, slug: string, quote: string): string`
- **StudyClaim** (interface) `interface StudyClaim extends NumberedClaim { key: string; call: string | null; comment: string | null; }`
- **CLAIM_CALLS** (const) `readonly ["keep", "tune", "drop"]`
- **ClaimCall** (type) `type ClaimCall = (typeof CLAIM_CALLS)[number];`
- **StudyView** (interface) `interface StudyView { study: Study; angles: { angle: string; claims: StudyClaim[] }[]; drafts: { spec: StudyDraftSpec; kept: DraftItem[]; dropped: DroppedDraft[]; done: boolean; stale: boolean; }[]; titles: Map<string, string>; manual?: Map<string, ManualPage>; counts: { queries: number; pages: number; unread: number; gated: number; waiting: number; }; }`

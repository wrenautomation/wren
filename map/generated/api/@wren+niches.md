# @wren/niches: interface

Exports: 27. Files: 5.

## packages/niches/src/agencies.ts

- **agencies** (const) `import("./niche.js").Niche`

## packages/niches/src/index.ts

- **FACTS_VIEWS** (const) `ReadonlyMap<string, string>`
- **LANDERS_BY_NICHE** (const) `ReadonlyMap<string, string>`
- **LEAD_SOURCE_FORMATS** (const) `ReadonlyMap<string, SourceFormat>`
- **NICHES** (const) `readonly Niche[]`
- **NICHE_NAMES** (const) `ReadonlySet<string>`
- **NICHE_PLATFORM_DOMAINS** (const) `ReadonlySet<string>`
- **PERSON_SOURCE_FORMATS** (const) `ReadonlyMap<string, PersonSourceFormat>`
- **SEQUENCES_BY_NICHE** (const) `Map<string, ReadonlyMap<string, import("@wren/channel-email").Sequence>>`
- **SMS_SEQUENCES** (const) `ReadonlyMap<string, SmsSequence>`
- **adLibraryFor** (function) `(niche: string): { keywords: readonly string[]; platforms: ReadonlySet<string>; screen: import("@wren/core").CompanyScreen | null; }`
- **crawlHintsFor** (function) `(niche: string | null): ReadonlySet<string>`
- **datasetsFor** (function) `(dataDir: string): ReadonlyMap<string, { niche: string; dataset: Dataset }>`
- **discoveryWordsFor** (function) `(niche: string | null): ReadonlySet<string>`
- **exaSearchFor** (function) `(niche: string): { queries: readonly string[]; cities: readonly string[]; platforms: ReadonlySet<string>; screen: import("@wren/core").CompanyScreen | null; }`
- **fbGroupsFor** (function) `(niche: string): { keywords: readonly string[]; }`
- **nicheFor** (function) `(niche: string): Niche`
- **requireNiche** (function) `(niche: string | null): string | null`
- **triggersFor** (function) `(niche: string): { words: readonly string[]; screen: import("@wren/core").CompanyScreen | null; }`
- **youtubeSearchFor** (function) `(niche: string): { queries: readonly string[]; platforms: ReadonlySet<string>; screen: import("@wren/core").CompanyScreen | null; }`

## packages/niches/src/niche.ts

- **Niche** (interface) `interface Niche { readonly name: string; readonly label: string; readonly factsView: string | null; readonly lander: string; readonly crawlHints: ReadonlySet<string>; readonly discoveryGenericWords: ReadonlySet<string>; readonly sequences: ReadonlyMap<string, Sequence>; readonly smsSequences: ReadonlyMap<string, SmsSequence>; readonly offers: ReadonlyMap<string, string>; readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>; readonly plan: readonly EnrollmentRule[]; readonly mailsRoleInboxes: boolean; readonly recontact: RecontactPolicy; readonly companyLocation: (company: Company) => string | null; readonly leadSourceFormats: readonly SourceFormat[]; readonly personSourceFormats: readonly PersonSourceFormat[]; readonly platformDomains: ReadonlySet<string>; readonly datasets: (dataDir: string) => readonly Dataset[]; readonly screen: CompanyScreen | null; readonly adKeywords: readonly string[]; readonly groupKeywords: readonly string[]; readonly exaQueries: readonly string[]; readonly exaCities: readonly string[]; readonly youtubeQueries: readonly string[]; readonly triggerWords: readonly string[]; }`
- **NicheSpec** (interface) `interface NicheSpec { readonly name: string; readonly label: string; readonly factsView: string | null; readonly lander: string; readonly crawlHints: readonly string[]; readonly discoveryGenericWords: readonly string[]; readonly sequences: readonly Sequence[]; readonly smsSequences?: readonly SmsSequence[]; readonly offers: Readonly<Record<string, string>>; readonly plan: readonly EnrollmentRule[]; readonly mailsRoleInboxes: boolean; readonly recontact?: RecontactOverrides; readonly companyLocation: (company: Company) => string | null; readonly leadSourceFormats?: readonly SourceFormat[]; readonly personSourceFormats?: readonly PersonSourceFormat[]; readonly platformDomains?: Iterable<string>; readonly datasets?: (dataDir: string) => readonly Dataset[]; readonly screen?: CompanyScreen; readonly adKeywords?: readonly string[]; readonly groupKeywords?: readonly string[]; readonly exaQueries?: readonly string[]; readonly youtubeQueries?: readonly string[]; readonly exaCities?: readonly string[]; readonly triggerWords?: readonly string[]; }`
- **defineNiche** (function) `(spec: NicheSpec): Niche`
- **leadFormat** (function) `(niche: string, name: string, help: string, build: SourceFormat["build"], opts: { directory?: boolean } = {}): SourceFormat`
- **rawLocation** (function) `(company: Company, key: string): string | null`

## packages/niches/src/recruiting.ts

- **recruiting** (const) `import("./niche.js").Niche`

## packages/niches/src/sec-ria.ts

- **secRia** (const) `import("./niche.js").Niche`

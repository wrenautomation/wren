# @wren/sites: interface

Exports: 250. Files: 28.

## packages/sites/src/chat-widget.ts

- **chatJs** (function) `(): string`
- **CHAT_SCRIPT_PATH** (const) `"/o/__chat.js"`
- **CHAT_PATH** (const) `"/o/__chat"`
- **CHAT_MAX** (const) `2000`

## packages/sites/src/components.ts

- **SITES_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/sites/src/console-routes.ts

- **SITES_CONSOLE_ROUTES** (const) `{ readonly offers: "read"; readonly detail: "read"; readonly create: "act"; readonly save: "act"; readonly draft: "act"; readonly rewrite: "act"; readonly share: "act"; readonly ask: "act"; readonly approve: "act"; readonly decline: "act"; readonly retire: "act"; readonly retireAsk: "act"; readonly …`
- **SITES_CONSOLE_APPS** (const) `{ readonly "*": "sites"; }`
- **SITES_CONSOLE_WRITES** (const) `readonly (keyof typeof SITES_CONSOLE_ROUTES)[]`

## packages/sites/src/console.ts

- **makeSitesConsole** (function) `(deps: { db: Db; write?: Write | null; shareKey?: string | null }): restate.ServiceDefinition<"SitesConsole", { offers: (_: restate.Context, req: PortalRequest) => Promise<{ offers: { id: string; name: string; status: "retired" | "paused" | "draft" | "live"; audience: string; }[]; templates: { id: string; name: string; blurb: string; }[]; ai: boolean; }>; detail: (_…`
- **pageApprovalId** (function) `(id: string, number: number): string`
- **parsePageApprovalId** (function) `(id: string): { id: string; number: number } | null`
- **sitesApi** (function) `(deps: { db: Db; write?: Write | null; shareKey?: string | null }): { offers(req: PortalRequest): Promise<{ offers: { id: string; name: string; status: "retired" | "paused" | "draft" | "live"; audience: string; }[]; templates: { id: string; name: string; blurb: string; }[]; ai: boolean; }>; detail(req: IdRequest): Promise<PageDetail>; create(req: CreateRequest): Pro…`
- **retireApprovalId** (function) `(id: string): string`
- **CreateRequest** (interface) `interface CreateRequest extends PortalRequest { offer: string; template?: string | null; title?: string | null; slug?: string | null; angle?: string | null; audience?: string | null; owner?: string | null; ai?: boolean | null; }`
- **IdRequest** (interface) `interface IdRequest extends PortalRequest { id: string; }`
- **SaveRequest** (interface) `interface SaveRequest extends IdRequest { content: unknown; why?: string | null; expect?: number | null; }`
- **AskRequest** (interface) `interface AskRequest extends IdRequest { number?: number | null; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`

## packages/sites/src/detail.ts

- **pageDetail** (function) `(db: Queryable, id: string): Promise<PageDetail | null>`
- **AdIn** (interface) `interface AdIn { id: string; name: string; status: string; adId: string; link: string; currency: string | null; spend: number; impressions: number; clicks: number; leads: number; views: number; forms: number; books: number; hops: number; costPerVisit: number | null; costPerForm: number | null; costPerBook: number | null; }`
- **Variant** (interface) `interface Variant { id: string; title: string; angle: string | null; audience: string | null; status: string; views: number; forms: number; books: number; formRate: number | null; spend: number; }`
- **PageDetail** (interface) `interface PageDetail { source: "data" | "code"; template: { id: string; name: string; fields: readonly CopyField[] } | null; draft: { number: number; content: Content } | null; live: number | null; waiting: number | null; retiring: boolean; versions: { number: number; origin: string; why: string | null; by: string; at: string }[]; preview: string | null; repoPath: string | null; notes: string | null; kit: string | null; days: DayNumbers[]; sources: SourceNumbers[]; ads: AdIn[]; variants: Variant[]; split: SplitResult | null; splitWith: { id: string; title: string; slug: string; variant: boolean }[]; }`

## packages/sites/src/draft.ts

- **draftPrompt** (function) `(t: Template, o: Offer, a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content }, fix: string | null): string`
- **jsonIn** (function) `(text: string): unknown`
- **draftCopy** (function) `(write: Write, t: Template, o: Offer, a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content }): Promise<Guarded<Content>>`
- **rewritePart** (function) `(write: Write, t: Template, content: Content, a: { part: string; ask: string; facts: readonly string[]; offer: Offer | null }): Promise<Guarded<Content>>`
- **Write** (type) `type Write = (prompt: string) => Promise<string>;`

## packages/sites/src/form-store.ts

- **formById** (function) `(db: Queryable, id: string): Promise<SiteFormDef | null>`
- **formOf** (function) `(db: Queryable, client: string | null, key: string): Promise<SiteFormDef | null>`
- **formToServe** (function) `(db: Queryable, client: string | null, key: string): Promise<{ form: SiteFormDef } | { status: 404 | 410 }>`
- **createForm** (function) `(db: Db, f: { client: string | null; name: string; slug?: string | null; spec?: unknown; business: string; by: string; }): Promise<SiteFormDef>`
- **saveForm** (function) `(db: Db, f: { id: string; spec: unknown; name?: string | null; by: string; expect?: unknown }): Promise<SiteFormDef>`
- **setFormStatus** (function) `(db: Db, ids: readonly string[], status: PageStatus, by: string): Promise<string[]>`
- **formDetail** (function) `(db: Queryable, id: string): Promise<FormDetail | null>`
- **formsOf** (function) `(db: Queryable, client: string | null): Omit<import("drizzle-orm/pg-core").PgSelectBase<"site_form_defs", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_defs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **consentVersion** (function) `(text: string): string`
- **FormDetail** (interface) `interface FormDetail { id: string; name: string; slug: string; status: string; owner: string; spec: FormSpec; version: string; url: string; embed: ReturnType<typeof embedSnippets>; days: FormDayNumbers[]; sources: FormSourceNumbers[]; steps: FormStepNumbers[]; recent: { id: string; at: Date; fields: Record<string, string>; entered: boolean }[]; splits: FormSplitDetail[]; }`

## packages/sites/src/forms.ts

- **defaultSpec** (function) `(business: string): FormSpec`
- **parseSpec** (function) `(raw: unknown): FormSpec`
- **shows** (function) `(rule: ShowRule | undefined, got: readonly string[]): boolean`
- **keyOf** (function) `(label: string): string`
- **checkEntry** (function) `(spec: FormSpec, raw: Record<string, unknown>): Checked`
- **formHtml** (function) `(spec: FormSpec, ctx: FormContext): string`
- **FIELD_KINDS** (const) `readonly ["text", "long", "email", "phone", "select", "multi", "date", "consent", "hidden", "step"]`
- **FieldKind** (type) `type FieldKind = (typeof FIELD_KINDS)[number];`
- **FIELD_RULES** (const) `readonly ["digits", "letters", "zip", "url"]`
- **FieldRule** (type) `type FieldRule = (typeof FIELD_RULES)[number];`
- **FIELD_KIND_LABELS** (const) `Record<FieldKind, string>`
- **SHOW_OPS** (const) `readonly ["is", "not", "filled", "empty"]`
- **ShowOp** (type) `type ShowOp = (typeof SHOW_OPS)[number];`
- **SHOW_OP_LABELS** (const) `Record<ShowOp, string>`
- **ShowRule** (interface) `interface ShowRule { key: string; op: ShowOp; values?: string[]; }`
- **FIELD_RULE_LABELS** (const) `Record<FieldRule, string>`
- **FormField** (interface) `interface FormField { key: string; kind: FieldKind; label: string; hint?: string; required?: boolean; min?: number; max?: number; rule?: FieldRule; options?: string[]; show?: ShowRule; }`
- **FormSpec** (interface) `interface FormSpec { title: string; intro?: string; button: string; fields: FormField[]; after: FormAfter; booking?: { url: string; label?: string } | null; }`
- **CONSENT_KEY** (const) `"sms_consent"`
- **STEPS_MAX** (const) `9`
- **consentWords** (function) `(business: string): string`
- **FormProblem** (class) ``
- **Checked** (interface) `interface Checked { values: Record<string, string>; errors: Record<string, string>; }`
- **consentOf** (function) `(spec: FormSpec): string | null`
- **formIntro** (function) `(spec: FormSpec, h: "h1" | "h2"): string`

## packages/sites/src/hops.ts

- **hopOf** (function) `(path: string, search: URLSearchParams): Hop | null`
- **linkWord** (function) `(raw: string | null | undefined): string`
- **linkUtm** (function) `(link: string, wren = false): { source: string; medium: string }`
- **goLinkOf** (function) `(l: { host: string; link: string; campaign: string; content?: string | null; slug: string; }): string`
- **isBot** (function) `(ua: string | null | undefined): boolean`

## packages/sites/src/kit.ts

- **embedSnippets** (function) `(o: { origin: string; slug: string; title: string }): { iframe: string; script: string; url: string; }`
- **KIT_PATH** (const) `"/o/__kit.js"`
- **TRACK_PATH** (const) `"/o/__t"`
- **FORM_PATH** (const) `"/o/__form"`
- **PREVIEW_PATH** (const) `"/o/__preview/"`
- **kitJs** (function) `(turnstileSiteKey: string | null | undefined): string`
- **KIT_JS** (const) `string`
- **kitTag** (function) `(page: string, origin: string): string`

## packages/sites/src/links.ts

- **linkTargets** (function) `(db: Queryable, client: string | null): Promise<LinkTarget[]>`
- **linkHost** (function) `(db: Queryable, client: string | null): Promise<string | null>`
- **createLink** (function) `(db: Db, l: NewLink): Promise<MadeLink>`
- **LinkTarget** (interface) `interface LinkTarget { id: string; title: string; slug: string; status: string; }`
- **NewLink** (interface) `interface NewLink { client: string | null; page: string; link: string; campaign?: string | null; content?: string | null; name?: string | null; by: string; }`

## packages/sites/src/model.ts

- **slugOf** (function) `(words: string): string`
- **channelOf** (function) `(t: { source?: string | null; medium?: string | null; ref?: string | null; }): Channel`
- **PAGE_KINDS** (const) `readonly ["lander", "listicle", "pitch", "demo", "booking", "thank-you", "portal"]`
- **PageKind** (type) `type PageKind = (typeof PAGE_KINDS)[number];`
- **PAGE_SOURCES** (const) `readonly ["data", "code"]`
- **PageSource** (type) `type PageSource = (typeof PAGE_SOURCES)[number];`
- **PAGE_STATUSES** (const) `readonly ["draft", "live", "retired"]`
- **PageStatus** (type) `type PageStatus = (typeof PAGE_STATUSES)[number];`
- **PAGE_STAGES** (const) `readonly ["reach", "trust", "convert"]`
- **PageStage** (type) `type PageStage = (typeof PAGE_STAGES)[number];`
- **VERSION_ORIGINS** (const) `readonly ["offer", "edit", "ai", "copy", "restore"]`
- **VersionOrigin** (type) `type VersionOrigin = (typeof VERSION_ORIGINS)[number];`
- **EVENT_NAMES** (const) `readonly ["view", "cta", "form", "book", "start", "step"]`
- **EventName** (type) `type EventName = (typeof EVENT_NAMES)[number];`
- **CHANNELS** (const) `readonly ["ads", "organic", "outreach", "referral", "direct", "other"]`
- **Channel** (type) `type Channel = (typeof CHANNELS)[number];`
- **SPLIT_STATES** (const) `readonly ["running", "shipping", "shipped", "stopped"]`
- **SplitState** (type) `type SplitState = (typeof SPLIT_STATES)[number];`
- **SPLIT_GOALS** (const) `readonly ["forms", "books", "won"]`
- **SplitGoal** (type) `type SplitGoal = (typeof SPLIT_GOALS)[number];`
- **ARM_LABELS** (const) `readonly ["A", "B", "C", "D", "E"]`
- **ArmLabel** (type) `type ArmLabel = (typeof ARM_LABELS)[number];`
- **FORM_SPLIT_STATES** (const) `readonly ["running", "shipped", "stopped"]`
- **FormSplitState** (type) `type FormSplitState = (typeof FORM_SPLIT_STATES)[number];`
- **FORM_ARMS** (const) `readonly ["A", "B"]`
- **FormArm** (type) `type FormArm = (typeof FORM_ARMS)[number];`
- **formUrl** (function) `(host: string, slug: string): string`
- **WREN_SITE** (const) `"wrenautomation.com"`
- **SLUG** (const) `RegExp`
- **SLUG_MAX** (const) `80`
- **pageUrl** (function) `(host: string, slug: string): string`

## packages/sites/src/qr.ts

- **qrMatrix** (function) `(text: string): boolean[][] | null`
- **qrPath** (function) `(m: readonly (readonly boolean[])[]): string`

## packages/sites/src/records.ts

- **SITES_RECORDS** (const) `readonly RecordType[]`
- **pageRecordFor** (function) `(client: string): RecordType`
- **formRecordFor** (function) `(client: string): RecordType`
- **entryRecordFor** (function) `(client: string): RecordType`
- **linkRecordFor** (function) `(client: string): RecordType`
- **PAGE_RECORD** (const) `"sites.page"`
- **FUNNEL_RECORD** (const) `"sites.funnel"`
- **FORM_RECORD** (const) `"sites.form"`
- **ENTRY_RECORD** (const) `"sites.entry"`
- **LINK_RECORD** (const) `"sites.link"`
- **pageRecord** (const) `RecordType`
- **funnelRecord** (const) `RecordType`
- **formRecord** (const) `RecordType`
- **entryRecord** (const) `RecordType`

## packages/sites/src/render.ts

- **renderPage** (function) `(t: Template, c: Content, ctx: RenderContext): string`
- **renderFormPage** (function) `(spec: FormSpec, ctx: { form: string; base: string; embed?: boolean; track?: boolean; banner?: string; split?: { id: string; arm: string } | null; }): string`
- **goneHtml** (function) `(status: 404 | 410): string`
- **PAGE_CSP** (const) `string`
- **FORM_CSP** (const) `string`
- **PAGE_CSS** (const) `"\n:root{--ink:#16181d;--muted:#5b6170;--paper:#fbfaf7;--line:#e4e1d8;--accent:#24594b;--accent-ink:#fff;--card:#fff}\n@media (prefers-color-scheme:dark){:root{--ink:#eceae4;--muted:#a3a7b0;--paper:#121417;--line:#2a2e35;--accent:#7cc3a8;--accent-ink:#0d1512;--card:#191c20}}\n*{box-sizing:border-box…`

## packages/sites/src/scan.ts

- **landerPages** (function) `(files: RepoFile[], origin: string, repo = "lander"): Found[]`
- **sitemapUrls** (function) `(xml: string, from: string): Found[]`
- **addLine** (function) `(f: Found, client?: string): string`
- **unlisted** (function) `(known: Iterable<string | null>, found: Found[], clientOf: (host: string) => string | undefined = () => undefined): Unlisted[]`
- **Found** (interface) `interface Found { url: string; from: string; title?: string; offer?: string; kind?: string; repoPath?: string; }`
- **Unlisted** (interface) `interface Unlisted extends Found { add: string; }`
- **RepoFile** (interface) `interface RepoFile { path: string; text: string; }`

## packages/sites/src/schema.ts

- **sitePages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_pages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_pages"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **SitePage** (type) `type SitePage = typeof sitePages.$inferSelect;`
- **sitePageVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_page_versions"; schema: undefined; columns: { page: import("drizzle-orm/pg-core").PgColumn<{ name: "page"; tableName: "site_page_versions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDe…`
- **SitePageVersion** (type) `type SitePageVersion = typeof sitePageVersions.$inferSelect;`
- **siteSplits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_splits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_splits"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPri…`
- **SiteSplit** (type) `type SiteSplit = typeof siteSplits.$inferSelect;`
- **siteSplitArms** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_split_arms"; schema: undefined; columns: { split: import("drizzle-orm/pg-core").PgColumn<{ name: "split"; tableName: "site_split_arms"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefaul…`
- **SiteSplitArm** (type) `type SiteSplitArm = typeof siteSplitArms.$inferSelect;`
- **siteFormDefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_form_defs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_defs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true;…`
- **SiteFormDef** (type) `type SiteFormDef = typeof siteFormDefs.$inferSelect;`
- **siteFormSplits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_form_splits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_splits"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: t…`
- **SiteFormSplit** (type) `type SiteFormSplit = typeof siteFormSplits.$inferSelect;`
- **siteEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_events"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true…`
- **SiteEvent** (type) `type SiteEvent = typeof siteEvents.$inferSelect;`
- **FormConsent** (interface) `interface FormConsent { text: string; version: string; }`
- **FormTouch** (interface) `interface FormTouch { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; ref?: string | null; }`
- **siteForms** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_forms"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_forms"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **SiteForm** (type) `type SiteForm = typeof siteForms.$inferSelect;`
- **siteHops** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_hops"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_hops"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; is…`
- **SiteHop** (type) `type SiteHop = typeof siteHops.$inferSelect;`
- **siteLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **SiteLink** (type) `type SiteLink = typeof siteLinks.$inferSelect;`

## packages/sites/src/service.ts

- **makeSites** (function) `(deps: { main: Db; shareKey?: string | null; open?: OpenClient }): restate.ServiceDefinition<"Sites", { serve: (_: restate.Context, req: Parameters<(req: { client?: string | null; slug?: string; preview?: { id: string; token: string; } | null; arm?: string | null; bot?: boolean | null; roll?: number | null; }) => Promise<Served>>[0]) => Promise<Served>; serveForm: …`
- **SITES** (const) `{ readonly name: "Sites"; }`
- **sitesPublicApi** (function) `(main: Db, opts: { shareKey?: string | null; open?: OpenClient } = {}): { serve(req: { client?: string | null; slug?: string; preview?: { id: string; token: string; } | null; arm?: string | null; bot?: boolean | null; roll?: number | null; }): Promise<Served>; serveForm(req: { client?: string | null; slug?: string; embed?: boolean | null; arm?: string | null; bot?: bool…`
- **Served** (interface) `interface Served { status: 200 | 404 | 410; html: string; split?: { id: string; label: string; cookie: string; days: number } | null; }`
- **Answer** (interface) `interface Answer { status: number; error?: string; errors?: Record<string, string>; }`

## packages/sites/src/split-call.ts

- **posteriorsOf** (function) `(arms: readonly ArmCount[]): Beta[]`
- **splitCall** (function) `(arms: readonly ArmCount[]): SplitCall`
- **MIN_VISITS** (const) `100`
- **SURE** (const) `0.95`
- **ArmCount** (interface) `interface ArmCount { readonly label: string; readonly visits: number; readonly goals: number; }`
- **SplitCall** (interface) `interface SplitCall { readonly words: string; readonly kind: "too_early" | "no_goals" | "leading" | "settled"; readonly leader: string | null; readonly sure: readonly number[]; readonly more: number; }`

## packages/sites/src/split.ts

- **liveSplitOf** (function) `(db: Queryable, page: string): Promise<SplitWithArms | null>`
- **splitsOf** (function) `(db: Queryable, page: string): Promise<SplitWithArms[]>`
- **startSplit** (function) `(db: Db, s: { page: string; arms: readonly string[]; weights?: readonly number[] | null; goal?: SplitGoal | null; by: string; }): Promise<SplitWithArms>`
- **setSplitWeights** (function) `(db: Db, id: string, weights: readonly number[], expect?: unknown): Promise<SplitWithArms>`
- **stopSplit** (function) `(db: Db, id: string, by: string): Promise<boolean>`
- **shipSplit** (function) `(db: Db, id: string, label: string, by: string, sure?: number | null): Promise<{ split: SplitWithArms; page: SitePage; number: number }>`
- **armToServe** (function) `(db: Queryable, page: SitePage, cookie: string | null, roll: number): Promise<{ split: string; label: string; page: SitePage; content: Content } | null>`
- **splitResult** (function) `(db: Queryable, split: SplitWithArms): Promise<SplitResult>`
- **SPLIT_COOKIE_DAYS** (const) `30`
- **SPLIT_COOKIE** (const) `RegExp`
- **splitCookieValue** (function) `(split: string, label: string): string`
- **SplitWithArms** (interface) `interface SplitWithArms extends SiteSplit { arms: SplitArm[]; }`
- **SplitResult** (interface) `interface SplitResult { split: SplitWithArms; arms: ArmNumbers[]; call: SplitCall; }`

## packages/sites/src/store.ts

- **stillAt** (function) `(column: AnyColumn, expect: unknown): SQL[]`
- **pageById** (function) `(db: Queryable, id: string): Promise<SitePage | null>`
- **versionOf** (function) `(db: Queryable, page: string, number: number): Promise<SitePageVersion | null>`
- **versionsOf** (function) `(db: Queryable, page: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"site_page_versions", { number: import("drizzle-orm/pg-core").PgColumn<{ name: "number"; tableName: "site_page_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrima…`
- **createDataPage** (function) `(db: Db, p: NewDataPage): Promise<SitePage>`
- **saveVersion** (function) `(db: Db, id: string, v: { content: unknown; origin: VersionOrigin; by: string; why?: string | null; expect?: number | null; }): Promise<SitePage>`
- **askPublish** (function) `(db: Db, id: string, a: { by: string; number?: number | null }): Promise<SitePage>`
- **approvePage** (function) `(db: Db, id: string, number: number, by: string): Promise<SitePage>`
- **declinePage** (function) `(db: Db, id: string, number: number, by: string): Promise<boolean>`
- **retirePages** (function) `(db: Db, ids: readonly string[], by: string): Promise<string[]>`
- **askRetire** (function) `(db: Db, id: string, by: string): Promise<SitePage>`
- **approveRetire** (function) `(db: Db, id: string, by: string): Promise<SitePage>`
- **declineRetire** (function) `(db: Db, id: string, by: string): Promise<boolean>`
- **duplicatePage** (function) `(db: Db, id: string, d: { by: string; title?: string | null; angle?: string | null; audience?: string | null }): Promise<SitePage>`
- **cleanUrl** (function) `(raw: string): string`
- **registerCodePage** (function) `(db: Db, p: CodePage): Promise<{ page: SitePage; added: boolean }>`
- **pageToServe** (function) `(db: Queryable, client: string | null, slug: string): Promise<{ page: SitePage; content: Content } | { status: 404 | 410 }>`
- **draftToPreview** (function) `(db: Queryable, id: string, token: string): Promise<{ page: SitePage; content: Content; number: number } | null>`
- **touchOf** (function) `(raw: unknown): FormTouch & { channel: Channel }`
- **recordEvent** (function) `(db: Queryable, e: { page?: string | null; form?: string | null; view: string; name: EventName; touch: unknown; width?: number | null; split?: string | null; step?: number | null; formSplit?: string | null; arm?: string | null; }): Promise<boolean>`
- **formFieldsOf** (function) `(raw: unknown): Record<string, string>`
- **pagesOf** (function) `(raw: unknown): SeenPage[] | null`
- **keepForm** (function) `(db: Db, f: { page: SitePage | null; form?: string | null; view: string | null; fields: Record<string, string>; touch: unknown; split?: string | null; formSplit?: string | null; arm?: FormArm | null; } & EntryMeta, open?: OpenClient): Promise<{ page: string | null; why: string | null; split: string | null; at: Date; id: string; channel: string; pages: SeenPage[] | null; fields: Record<string, string>; arm: string | null; form: string | null; consent: FormConsent | null; entered: boolean; formSplit: string | null; touch: FormTouch…`
- **markForm** (function) `(db: Db, id: string, entered: boolean, why: string | null): Promise<void>`
- **doorFor** (function) `(db: Queryable, page: { hook: string | null; client: string | null }): Promise<string | null>`
- **waitingPages** (function) `(db: Queryable): Promise<{ id: string; title: string; slug: string; client: string | null; number: number | null; by: string | null; at: Date | null; offer: string | null; }[]>`
- **waitingRetires** (function) `(db: Queryable): Promise<{ id: string; title: string; slug: string; client: string | null; by: string | null; at: Date | null; offer: string | null; }[]>`
- **pageNumbers** (function) `(db: Queryable, id: string): Promise<{ days: DayNumbers[]; sources: SourceNumbers[]; }>`
- **recordHop** (function) `(db: Queryable, h: { client: string | null; link: string; source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; to: string; slug?: string | null; ref?: string | null; }): Promise<boolean>`
- **importLanderClicks** (function) `(db: Db, rows: readonly LanderClick[]): Promise<number>`
- **SitesRefusal** (class) ``
- **OpenClient** (type) `type OpenClient = (client: string) => Queryable;`
- **doorOf** (function) `(db: Queryable, page: Pick<SitePage, "hook" | "client">): Promise<string | null>`
- **DayNumbers** (interface) `interface DayNumbers { day: string; views: number; ctas: number; forms: number; books: number; }`
- **SourceNumbers** (interface) `interface SourceNumbers { channel: Channel; source: string; campaign: string; views: number; forms: number; books: number; }`

## packages/sites/src/templates/index.ts

- **templateOf** (function) `(id: string | null | undefined): Template`
- **checkContent** (function) `(t: Pick<Template, "fields">, raw: unknown): Content`
- **formKeyOf** (function) `(c: Content): string`
- **wordsOf** (function) `(t: Pick<Template, "fields">, c: Content): { label: string; text: string }[]`
- **partsOf** (function) `(t: Template, c: Content): Part[]`
- **TEMPLATES** (const) `Readonly<Record<string, Template>>`
- **TEMPLATE_IDS** (const) `readonly string[]`
- **ContentProblem** (class) ``
- **Part** (type) `type Part = { key: string; label: string; fields: CopyField[]; section?: string };`

## packages/sites/src/templates/lander.ts

- **priceLine** (function) `(p: Price): string`

## packages/sites/src/templates/page.ts

- **sectionsOf** (function) `(c: Content): SectionValue[]`

## packages/sites/src/templates/parts.ts

- **esc** (function) `(s: string): string`
- **safeHref** (function) `(raw: string): string | null`

## packages/sites/src/templates/sections.ts

- **SECTIONS** (const) `readonly SectionType[]`
- **SECTIONS_MAX** (const) `20`
- **SectionType** (interface) `interface SectionType { type: string; name: string; blurb: string; fields: readonly CopyField[]; sample: Content; render(c: Content, ctx: RenderContext): string; }`
- **sectionOf** (function) `(type: unknown): SectionType | undefined`

## packages/sites/src/templates/types.ts

- **FieldKind** (type) `type FieldKind = "text" | "long" | "lines" | "url" | "items" | "sections";`
- **CopyField** (interface) `interface CopyField { key: string; label: string; kind: FieldKind; max: number; hint?: string; optional?: true; group?: string; items?: readonly CopyField[]; }`
- **ItemValue** (type) `type ItemValue = Record<string, string>;`
- **SectionValue** (type) `type SectionValue = { id: string; type: string } & Record< string, string | string[] | ItemValue[] >;`
- **Content** (type) `type Content = Record<string, FieldValue>;`
- **RenderContext** (interface) `interface RenderContext { page: string; base: string; track: boolean; banner?: string; form?: { id: string; spec: FormSpec } | null; split?: string | null; }`
- **Template** (interface) `interface Template { id: string; name: string; blurb: string; fields: readonly CopyField[]; fill(offer: Offer, o: { angle?: string | null; audience?: string | null }): Content; body(c: Content, ctx: RenderContext): string; head(c: Content): { title: string; description: string }; }`

## packages/sites/src/views.ts

- **sitePageRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_page_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_page_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **siteFunnelRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_funnel_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_funnel_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **siteFormRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_form_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **siteEntryRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_entry_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_entry_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **siteLinkRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_link_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_link_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`

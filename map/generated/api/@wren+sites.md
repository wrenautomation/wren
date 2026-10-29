# @wren/sites: interface

Exports: 250. Files: 28.

## packages/sites/src/chat-widget.ts

- **CHAT_MAX** (const) `2000`
- **CHAT_PATH** (const) `"/o/__chat"`
- **CHAT_SCRIPT_PATH** (const) `"/o/__chat.js"`
- **chatJs** (function) `(): string`

## packages/sites/src/components.ts

- **SITES_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/sites/src/console-routes.ts

- **SITES_CONSOLE_APPS** (const) `{ readonly "*": "sites"; }`
- **SITES_CONSOLE_ROUTES** (const) `{ readonly offers: "read"; readonly detail: "read"; readonly create: "act"; readonly save: "act"; readonly draft: "act"; readonly rewrite: "act"; readonly share: "act"; readonly ask: "act"; readonly approve: "act"; readonly decline: "act"; readonly retire: "act"; readonly retireAsk: "act"; readonly …`
- **SITES_CONSOLE_WRITES** (const) `readonly (keyof typeof SITES_CONSOLE_ROUTES)[]`

## packages/sites/src/console.ts

- **AskRequest** (interface) `interface AskRequest extends IdRequest { number?: number | null; }`
- **CreateRequest** (interface) `interface CreateRequest extends PortalRequest { offer: string; template?: string | null; title?: string | null; slug?: string | null; angle?: string | null; audience?: string | null; owner?: string | null; ai?: boolean | null; }`
- **IdRequest** (interface) `interface IdRequest extends PortalRequest { id: string; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`
- **SaveRequest** (interface) `interface SaveRequest extends IdRequest { content: unknown; why?: string | null; expect?: number | null; }`
- **makeSitesConsole** (function) `(deps: { db: Db; write?: Write | null; shareKey?: string | null }): restate.ServiceDefinition<"SitesConsole", { offers: (_: restate.Context, req: PortalRequest) => Promise<{ offers: { id: string; name: string; status: "retired" | "paused" | "draft" | "live"; audience: string; }[]; templates: { id: string; name: string; blurb: string; }[]; ai: boolean; }>; detail: (_…`
- **pageApprovalId** (function) `(id: string, number: number): string`
- **parsePageApprovalId** (function) `(id: string): { id: string; number: number } | null`
- **retireApprovalId** (function) `(id: string): string`
- **sitesApi** (function) `(deps: { db: Db; write?: Write | null; shareKey?: string | null }): { offers(req: PortalRequest): Promise<{ offers: { id: string; name: string; status: "retired" | "paused" | "draft" | "live"; audience: string; }[]; templates: { id: string; name: string; blurb: string; }[]; ai: boolean; }>; detail(req: IdRequest): Promise<PageDetail>; create(req: CreateRequest): Pro…`

## packages/sites/src/detail.ts

- **AdIn** (interface) `interface AdIn { id: string; name: string; status: string; adId: string; link: string; currency: string | null; spend: number; impressions: number; clicks: number; leads: number; views: number; forms: number; books: number; hops: number; costPerVisit: number | null; costPerForm: number | null; costPerBook: number | null; }`
- **PageDetail** (interface) `interface PageDetail { source: "data" | "code"; template: { id: string; name: string; fields: readonly CopyField[] } | null; draft: { number: number; content: Content } | null; live: number | null; waiting: number | null; retiring: boolean; versions: { number: number; origin: string; why: string | null; by: string; at: string }[]; preview: string | null; repoPath: string | null; notes: string | null; kit: string | null; days: DayNumbers[]; sources: SourceNumbers[]; ads: AdIn[]; variants: Variant[]; split: SplitResult | null; splitWith: { id: string; title: string; slug: string; variant: boolean }[]; }`
- **Variant** (interface) `interface Variant { id: string; title: string; angle: string | null; audience: string | null; status: string; views: number; forms: number; books: number; formRate: number | null; spend: number; }`
- **pageDetail** (function) `(db: Queryable, id: string): Promise<PageDetail | null>`

## packages/sites/src/draft.ts

- **Write** (type) `type Write = (prompt: string) => Promise<string>;`
- **draftCopy** (function) `(write: Write, t: Template, o: Offer, a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content }): Promise<Guarded<Content>>`
- **draftPrompt** (function) `(t: Template, o: Offer, a: { angle?: string | null; audience?: string | null; facts: readonly string[]; start: Content }, fix: string | null): string`
- **jsonIn** (function) `(text: string): unknown`
- **rewritePart** (function) `(write: Write, t: Template, content: Content, a: { part: string; ask: string; facts: readonly string[]; offer: Offer | null }): Promise<Guarded<Content>>`

## packages/sites/src/form-store.ts

- **FormDetail** (interface) `interface FormDetail { id: string; name: string; slug: string; status: string; owner: string; spec: FormSpec; version: string; url: string; embed: ReturnType<typeof embedSnippets>; days: FormDayNumbers[]; sources: FormSourceNumbers[]; steps: FormStepNumbers[]; recent: { id: string; at: Date; fields: Record<string, string>; entered: boolean }[]; splits: FormSplitDetail[]; }`
- **consentVersion** (function) `(text: string): string`
- **createForm** (function) `(db: Db, f: { client: string | null; name: string; slug?: string | null; spec?: unknown; business: string; by: string; }): Promise<SiteFormDef>`
- **formById** (function) `(db: Queryable, id: string): Promise<SiteFormDef | null>`
- **formDetail** (function) `(db: Queryable, id: string): Promise<FormDetail | null>`
- **formOf** (function) `(db: Queryable, client: string | null, key: string): Promise<SiteFormDef | null>`
- **formToServe** (function) `(db: Queryable, client: string | null, key: string): Promise<{ form: SiteFormDef } | { status: 404 | 410 }>`
- **formsOf** (function) `(db: Queryable, client: string | null): Omit<import("drizzle-orm/pg-core").PgSelectBase<"site_form_defs", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_defs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **saveForm** (function) `(db: Db, f: { id: string; spec: unknown; name?: string | null; by: string; expect?: unknown }): Promise<SiteFormDef>`
- **setFormStatus** (function) `(db: Db, ids: readonly string[], status: PageStatus, by: string): Promise<string[]>`

## packages/sites/src/forms.ts

- **CONSENT_KEY** (const) `"sms_consent"`
- **Checked** (interface) `interface Checked { values: Record<string, string>; errors: Record<string, string>; }`
- **FIELD_KINDS** (const) `readonly ["text", "long", "email", "phone", "select", "multi", "date", "consent", "hidden", "step"]`
- **FIELD_KIND_LABELS** (const) `Record<FieldKind, string>`
- **FIELD_RULES** (const) `readonly ["digits", "letters", "zip", "url"]`
- **FIELD_RULE_LABELS** (const) `Record<FieldRule, string>`
- **FieldKind** (type) `type FieldKind = (typeof FIELD_KINDS)[number];`
- **FieldRule** (type) `type FieldRule = (typeof FIELD_RULES)[number];`
- **FormField** (interface) `interface FormField { key: string; kind: FieldKind; label: string; hint?: string; required?: boolean; min?: number; max?: number; rule?: FieldRule; options?: string[]; show?: ShowRule; }`
- **FormProblem** (class) ``
- **FormSpec** (interface) `interface FormSpec { title: string; intro?: string; button: string; fields: FormField[]; after: FormAfter; booking?: { url: string; label?: string } | null; }`
- **SHOW_OPS** (const) `readonly ["is", "not", "filled", "empty"]`
- **SHOW_OP_LABELS** (const) `Record<ShowOp, string>`
- **STEPS_MAX** (const) `9`
- **ShowOp** (type) `type ShowOp = (typeof SHOW_OPS)[number];`
- **ShowRule** (interface) `interface ShowRule { key: string; op: ShowOp; values?: string[]; }`
- **checkEntry** (function) `(spec: FormSpec, raw: Record<string, unknown>): Checked`
- **consentOf** (function) `(spec: FormSpec): string | null`
- **consentWords** (function) `(business: string): string`
- **defaultSpec** (function) `(business: string): FormSpec`
- **formHtml** (function) `(spec: FormSpec, ctx: FormContext): string`
- **formIntro** (function) `(spec: FormSpec, h: "h1" | "h2"): string`
- **keyOf** (function) `(label: string): string`
- **parseSpec** (function) `(raw: unknown): FormSpec`
- **shows** (function) `(rule: ShowRule | undefined, got: readonly string[]): boolean`

## packages/sites/src/hops.ts

- **goLinkOf** (function) `(l: { host: string; link: string; campaign: string; content?: string | null; slug: string; }): string`
- **hopOf** (function) `(path: string, search: URLSearchParams): Hop | null`
- **isBot** (function) `(ua: string | null | undefined): boolean`
- **linkUtm** (function) `(link: string, wren = false): { source: string; medium: string }`
- **linkWord** (function) `(raw: string | null | undefined): string`

## packages/sites/src/kit.ts

- **FORM_PATH** (const) `"/o/__form"`
- **KIT_JS** (const) `string`
- **KIT_PATH** (const) `"/o/__kit.js"`
- **PREVIEW_PATH** (const) `"/o/__preview/"`
- **TRACK_PATH** (const) `"/o/__t"`
- **embedSnippets** (function) `(o: { origin: string; slug: string; title: string }): { iframe: string; script: string; url: string; }`
- **kitJs** (function) `(turnstileSiteKey: string | null | undefined): string`
- **kitTag** (function) `(page: string, origin: string): string`

## packages/sites/src/links.ts

- **LinkTarget** (interface) `interface LinkTarget { id: string; title: string; slug: string; status: string; }`
- **NewLink** (interface) `interface NewLink { client: string | null; page: string; link: string; campaign?: string | null; content?: string | null; name?: string | null; by: string; }`
- **createLink** (function) `(db: Db, l: NewLink): Promise<MadeLink>`
- **linkHost** (function) `(db: Queryable, client: string | null): Promise<string | null>`
- **linkTargets** (function) `(db: Queryable, client: string | null): Promise<LinkTarget[]>`

## packages/sites/src/model.ts

- **ARM_LABELS** (const) `readonly ["A", "B", "C", "D", "E"]`
- **ArmLabel** (type) `type ArmLabel = (typeof ARM_LABELS)[number];`
- **CHANNELS** (const) `readonly ["ads", "organic", "outreach", "referral", "direct", "other"]`
- **Channel** (type) `type Channel = (typeof CHANNELS)[number];`
- **EVENT_NAMES** (const) `readonly ["view", "cta", "form", "book", "start", "step"]`
- **EventName** (type) `type EventName = (typeof EVENT_NAMES)[number];`
- **FORM_ARMS** (const) `readonly ["A", "B"]`
- **FORM_SPLIT_STATES** (const) `readonly ["running", "shipped", "stopped"]`
- **FormArm** (type) `type FormArm = (typeof FORM_ARMS)[number];`
- **FormSplitState** (type) `type FormSplitState = (typeof FORM_SPLIT_STATES)[number];`
- **PAGE_KINDS** (const) `readonly ["lander", "listicle", "pitch", "demo", "booking", "thank-you", "portal"]`
- **PAGE_SOURCES** (const) `readonly ["data", "code"]`
- **PAGE_STAGES** (const) `readonly ["reach", "trust", "convert"]`
- **PAGE_STATUSES** (const) `readonly ["draft", "live", "retired"]`
- **PageKind** (type) `type PageKind = (typeof PAGE_KINDS)[number];`
- **PageSource** (type) `type PageSource = (typeof PAGE_SOURCES)[number];`
- **PageStage** (type) `type PageStage = (typeof PAGE_STAGES)[number];`
- **PageStatus** (type) `type PageStatus = (typeof PAGE_STATUSES)[number];`
- **SLUG** (const) `RegExp`
- **SLUG_MAX** (const) `80`
- **SPLIT_GOALS** (const) `readonly ["forms", "books", "won"]`
- **SPLIT_STATES** (const) `readonly ["running", "shipping", "shipped", "stopped"]`
- **SplitGoal** (type) `type SplitGoal = (typeof SPLIT_GOALS)[number];`
- **SplitState** (type) `type SplitState = (typeof SPLIT_STATES)[number];`
- **VERSION_ORIGINS** (const) `readonly ["offer", "edit", "ai", "copy", "restore"]`
- **VersionOrigin** (type) `type VersionOrigin = (typeof VERSION_ORIGINS)[number];`
- **WREN_SITE** (const) `"wrenautomation.com"`
- **channelOf** (function) `(t: { source?: string | null; medium?: string | null; ref?: string | null; }): Channel`
- **formUrl** (function) `(host: string, slug: string): string`
- **pageUrl** (function) `(host: string, slug: string): string`
- **slugOf** (function) `(words: string): string`

## packages/sites/src/qr.ts

- **qrMatrix** (function) `(text: string): boolean[][] | null`
- **qrPath** (function) `(m: readonly (readonly boolean[])[]): string`

## packages/sites/src/records.ts

- **ENTRY_RECORD** (const) `"sites.entry"`
- **FORM_RECORD** (const) `"sites.form"`
- **FUNNEL_RECORD** (const) `"sites.funnel"`
- **LINK_RECORD** (const) `"sites.link"`
- **PAGE_RECORD** (const) `"sites.page"`
- **SITES_RECORDS** (const) `readonly RecordType[]`
- **entryRecord** (const) `RecordType`
- **entryRecordFor** (function) `(client: string): RecordType`
- **formRecord** (const) `RecordType`
- **formRecordFor** (function) `(client: string): RecordType`
- **funnelRecord** (const) `RecordType`
- **linkRecordFor** (function) `(client: string): RecordType`
- **pageRecord** (const) `RecordType`
- **pageRecordFor** (function) `(client: string): RecordType`

## packages/sites/src/render.ts

- **FORM_CSP** (const) `string`
- **PAGE_CSP** (const) `string`
- **PAGE_CSS** (const) `"\n:root{--ink:#16181d;--muted:#5b6170;--paper:#fbfaf7;--line:#e4e1d8;--accent:#24594b;--accent-ink:#fff;--card:#fff}\n@media (prefers-color-scheme:dark){:root{--ink:#eceae4;--muted:#a3a7b0;--paper:#121417;--line:#2a2e35;--accent:#7cc3a8;--accent-ink:#0d1512;--card:#191c20}}\n*{box-sizing:border-box…`
- **goneHtml** (function) `(status: 404 | 410): string`
- **renderFormPage** (function) `(spec: FormSpec, ctx: { form: string; base: string; embed?: boolean; track?: boolean; banner?: string; split?: { id: string; arm: string } | null; }): string`
- **renderPage** (function) `(t: Template, c: Content, ctx: RenderContext): string`

## packages/sites/src/scan.ts

- **Found** (interface) `interface Found { url: string; from: string; title?: string; offer?: string; kind?: string; repoPath?: string; }`
- **RepoFile** (interface) `interface RepoFile { path: string; text: string; }`
- **Unlisted** (interface) `interface Unlisted extends Found { add: string; }`
- **addLine** (function) `(f: Found, client?: string): string`
- **landerPages** (function) `(files: RepoFile[], origin: string, repo = "lander"): Found[]`
- **sitemapUrls** (function) `(xml: string, from: string): Found[]`
- **unlisted** (function) `(known: Iterable<string | null>, found: Found[], clientOf: (host: string) => string | undefined = () => undefined): Unlisted[]`

## packages/sites/src/schema.ts

- **FormConsent** (interface) `interface FormConsent { text: string; version: string; }`
- **FormTouch** (interface) `interface FormTouch { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; ref?: string | null; }`
- **SiteEvent** (type) `type SiteEvent = typeof siteEvents.$inferSelect;`
- **SiteForm** (type) `type SiteForm = typeof siteForms.$inferSelect;`
- **SiteFormDef** (type) `type SiteFormDef = typeof siteFormDefs.$inferSelect;`
- **SiteFormSplit** (type) `type SiteFormSplit = typeof siteFormSplits.$inferSelect;`
- **SiteHop** (type) `type SiteHop = typeof siteHops.$inferSelect;`
- **SiteLink** (type) `type SiteLink = typeof siteLinks.$inferSelect;`
- **SitePage** (type) `type SitePage = typeof sitePages.$inferSelect;`
- **SitePageVersion** (type) `type SitePageVersion = typeof sitePageVersions.$inferSelect;`
- **SiteSplit** (type) `type SiteSplit = typeof siteSplits.$inferSelect;`
- **SiteSplitArm** (type) `type SiteSplitArm = typeof siteSplitArms.$inferSelect;`
- **siteEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_events"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true…`
- **siteFormDefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_form_defs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_defs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true;…`
- **siteFormSplits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_form_splits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_splits"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: t…`
- **siteForms** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_forms"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_forms"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **siteHops** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_hops"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_hops"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; is…`
- **siteLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **sitePageVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_page_versions"; schema: undefined; columns: { page: import("drizzle-orm/pg-core").PgColumn<{ name: "page"; tableName: "site_page_versions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDe…`
- **sitePages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_pages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_pages"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrima…`
- **siteSplitArms** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_split_arms"; schema: undefined; columns: { split: import("drizzle-orm/pg-core").PgColumn<{ name: "split"; tableName: "site_split_arms"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefaul…`
- **siteSplits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "site_splits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_splits"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPri…`

## packages/sites/src/service.ts

- **Answer** (interface) `interface Answer { status: number; error?: string; errors?: Record<string, string>; }`
- **SITES** (const) `{ readonly name: "Sites"; }`
- **Served** (interface) `interface Served { status: 200 | 404 | 410; html: string; split?: { id: string; label: string; cookie: string; days: number } | null; }`
- **makeSites** (function) `(deps: { main: Db; shareKey?: string | null; open?: OpenClient }): restate.ServiceDefinition<"Sites", { serve: (_: restate.Context, req: Parameters<(req: { client?: string | null; slug?: string; preview?: { id: string; token: string; } | null; arm?: string | null; bot?: boolean | null; roll?: number | null; }) => Promise<Served>>[0]) => Promise<Served>; serveForm: …`
- **sitesPublicApi** (function) `(main: Db, opts: { shareKey?: string | null; open?: OpenClient } = {}): { serve(req: { client?: string | null; slug?: string; preview?: { id: string; token: string; } | null; arm?: string | null; bot?: boolean | null; roll?: number | null; }): Promise<Served>; serveForm(req: { client?: string | null; slug?: string; embed?: boolean | null; arm?: string | null; bot?: bool…`

## packages/sites/src/split-call.ts

- **ArmCount** (interface) `interface ArmCount { readonly label: string; readonly visits: number; readonly goals: number; }`
- **MIN_VISITS** (const) `100`
- **SURE** (const) `0.95`
- **SplitCall** (interface) `interface SplitCall { readonly words: string; readonly kind: "too_early" | "no_goals" | "leading" | "settled"; readonly leader: string | null; readonly sure: readonly number[]; readonly more: number; }`
- **posteriorsOf** (function) `(arms: readonly ArmCount[]): Beta[]`
- **splitCall** (function) `(arms: readonly ArmCount[]): SplitCall`

## packages/sites/src/split.ts

- **SPLIT_COOKIE** (const) `RegExp`
- **SPLIT_COOKIE_DAYS** (const) `30`
- **SplitResult** (interface) `interface SplitResult { split: SplitWithArms; arms: ArmNumbers[]; call: SplitCall; }`
- **SplitWithArms** (interface) `interface SplitWithArms extends SiteSplit { arms: SplitArm[]; }`
- **armToServe** (function) `(db: Queryable, page: SitePage, cookie: string | null, roll: number): Promise<{ split: string; label: string; page: SitePage; content: Content } | null>`
- **liveSplitOf** (function) `(db: Queryable, page: string): Promise<SplitWithArms | null>`
- **setSplitWeights** (function) `(db: Db, id: string, weights: readonly number[], expect?: unknown): Promise<SplitWithArms>`
- **shipSplit** (function) `(db: Db, id: string, label: string, by: string, sure?: number | null): Promise<{ split: SplitWithArms; page: SitePage; number: number }>`
- **splitCookieValue** (function) `(split: string, label: string): string`
- **splitResult** (function) `(db: Queryable, split: SplitWithArms): Promise<SplitResult>`
- **splitsOf** (function) `(db: Queryable, page: string): Promise<SplitWithArms[]>`
- **startSplit** (function) `(db: Db, s: { page: string; arms: readonly string[]; weights?: readonly number[] | null; goal?: SplitGoal | null; by: string; }): Promise<SplitWithArms>`
- **stopSplit** (function) `(db: Db, id: string, by: string): Promise<boolean>`

## packages/sites/src/store.ts

- **DayNumbers** (interface) `interface DayNumbers { day: string; views: number; ctas: number; forms: number; books: number; }`
- **OpenClient** (type) `type OpenClient = (client: string) => Queryable;`
- **SitesRefusal** (class) ``
- **SourceNumbers** (interface) `interface SourceNumbers { channel: Channel; source: string; campaign: string; views: number; forms: number; books: number; }`
- **approvePage** (function) `(db: Db, id: string, number: number, by: string): Promise<SitePage>`
- **approveRetire** (function) `(db: Db, id: string, by: string): Promise<SitePage>`
- **askPublish** (function) `(db: Db, id: string, a: { by: string; number?: number | null }): Promise<SitePage>`
- **askRetire** (function) `(db: Db, id: string, by: string): Promise<SitePage>`
- **cleanUrl** (function) `(raw: string): string`
- **createDataPage** (function) `(db: Db, p: NewDataPage): Promise<SitePage>`
- **declinePage** (function) `(db: Db, id: string, number: number, by: string): Promise<boolean>`
- **declineRetire** (function) `(db: Db, id: string, by: string): Promise<boolean>`
- **doorFor** (function) `(db: Queryable, page: { hook: string | null; client: string | null }): Promise<string | null>`
- **doorOf** (function) `(db: Queryable, page: Pick<SitePage, "hook" | "client">): Promise<string | null>`
- **draftToPreview** (function) `(db: Queryable, id: string, token: string): Promise<{ page: SitePage; content: Content; number: number } | null>`
- **duplicatePage** (function) `(db: Db, id: string, d: { by: string; title?: string | null; angle?: string | null; audience?: string | null }): Promise<SitePage>`
- **formFieldsOf** (function) `(raw: unknown): Record<string, string>`
- **importLanderClicks** (function) `(db: Db, rows: readonly LanderClick[]): Promise<number>`
- **keepForm** (function) `(db: Db, f: { page: SitePage | null; form?: string | null; view: string | null; fields: Record<string, string>; touch: unknown; split?: string | null; formSplit?: string | null; arm?: FormArm | null; } & EntryMeta, open?: OpenClient): Promise<{ page: string | null; why: string | null; split: string | null; at: Date; id: string; channel: string; pages: SeenPage[] | null; fields: Record<string, string>; arm: string | null; form: string | null; consent: FormConsent | null; entered: boolean; formSplit: string | null; touch: FormTouch…`
- **markForm** (function) `(db: Db, id: string, entered: boolean, why: string | null): Promise<void>`
- **pageById** (function) `(db: Queryable, id: string): Promise<SitePage | null>`
- **pageNumbers** (function) `(db: Queryable, id: string): Promise<{ days: DayNumbers[]; sources: SourceNumbers[]; }>`
- **pageToServe** (function) `(db: Queryable, client: string | null, slug: string): Promise<{ page: SitePage; content: Content } | { status: 404 | 410 }>`
- **pagesOf** (function) `(raw: unknown): SeenPage[] | null`
- **recordEvent** (function) `(db: Queryable, e: { page?: string | null; form?: string | null; view: string; name: EventName; touch: unknown; width?: number | null; split?: string | null; step?: number | null; formSplit?: string | null; arm?: string | null; }): Promise<boolean>`
- **recordHop** (function) `(db: Queryable, h: { client: string | null; link: string; source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; to: string; slug?: string | null; ref?: string | null; }): Promise<boolean>`
- **registerCodePage** (function) `(db: Db, p: CodePage): Promise<{ page: SitePage; added: boolean }>`
- **retirePages** (function) `(db: Db, ids: readonly string[], by: string): Promise<string[]>`
- **saveVersion** (function) `(db: Db, id: string, v: { content: unknown; origin: VersionOrigin; by: string; why?: string | null; expect?: number | null; }): Promise<SitePage>`
- **stillAt** (function) `(column: AnyColumn, expect: unknown): SQL[]`
- **touchOf** (function) `(raw: unknown): FormTouch & { channel: Channel }`
- **versionOf** (function) `(db: Queryable, page: string, number: number): Promise<SitePageVersion | null>`
- **versionsOf** (function) `(db: Queryable, page: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"site_page_versions", { number: import("drizzle-orm/pg-core").PgColumn<{ name: "number"; tableName: "site_page_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrima…`
- **waitingPages** (function) `(db: Queryable): Promise<{ id: string; title: string; slug: string; client: string | null; number: number | null; by: string | null; at: Date | null; offer: string | null; }[]>`
- **waitingRetires** (function) `(db: Queryable): Promise<{ id: string; title: string; slug: string; client: string | null; by: string | null; at: Date | null; offer: string | null; }[]>`

## packages/sites/src/templates/index.ts

- **ContentProblem** (class) ``
- **Part** (type) `type Part = { key: string; label: string; fields: CopyField[]; section?: string };`
- **TEMPLATES** (const) `Readonly<Record<string, Template>>`
- **TEMPLATE_IDS** (const) `readonly string[]`
- **checkContent** (function) `(t: Pick<Template, "fields">, raw: unknown): Content`
- **formKeyOf** (function) `(c: Content): string`
- **partsOf** (function) `(t: Template, c: Content): Part[]`
- **templateOf** (function) `(id: string | null | undefined): Template`
- **wordsOf** (function) `(t: Pick<Template, "fields">, c: Content): { label: string; text: string }[]`

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

- **Content** (type) `type Content = Record<string, FieldValue>;`
- **CopyField** (interface) `interface CopyField { key: string; label: string; kind: FieldKind; max: number; hint?: string; optional?: true; group?: string; items?: readonly CopyField[]; }`
- **ItemValue** (type) `type ItemValue = Record<string, string>;`
- **RenderContext** (interface) `interface RenderContext { page: string; base: string; track: boolean; banner?: string; form?: { id: string; spec: FormSpec } | null; split?: string | null; }`
- **SectionValue** (type) `type SectionValue = { id: string; type: string } & Record< string, string | string[] | ItemValue[] >;`
- **Template** (interface) `interface Template { id: string; name: string; blurb: string; fields: readonly CopyField[]; fill(offer: Offer, o: { angle?: string | null; audience?: string | null }): Content; body(c: Content, ctx: RenderContext): string; head(c: Content): { title: string; description: string }; }`
- **FieldKind** (type) `type FieldKind = "text" | "long" | "lines" | "url" | "items" | "sections";`

## packages/sites/src/views.ts

- **siteEntryRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_entry_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_entry_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **siteFormRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_form_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_form_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **siteFunnelRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_funnel_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_funnel_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **siteLinkRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_link_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_link_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **sitePageRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"site_page_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "site_page_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`

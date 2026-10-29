# @wren/watch: interface

Exports: 44. Files: 9.

## packages/watch/src/clients.ts

- **MAIL_FLOW** (const) `"mail"`
- **MAIL_FROM** (const) `"read.mail"`
- **makeMailReader** (function) `(deps: MailReaderDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ClientReadStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ClientReadStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> …`
- **readClients** (function) `(d: MailReaderDeps, now: Date): Promise<ClientReadStats>`

## packages/watch/src/components.ts

- **MAIL_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **WATCH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **WATCH_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/watch/src/console-routes.ts

- **WATCH_CONSOLE_APPS** (const) `{ readonly "*": "inbox"; }`
- **WATCH_CONSOLE_ROUTES** (const) `{ readonly done: "wren:team"; readonly undone: "wren:team"; readonly hide: "wren:team"; readonly show: "wren:team"; readonly sort: "wren:team"; readonly addRule: "wren:team"; readonly removeRule: "wren:team"; }`
- **WATCH_CONSOLE_WRITES** (const) `readonly (keyof typeof WATCH_CONSOLE_ROUTES)[]`

## packages/watch/src/console.ts

- **IDS** (const) `{ ids: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>; viewer: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>; client: z.ZodOptional<z.ZodString>; asClient: z.ZodOptional<z.ZodBoolean>; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: (string | number)[]; }`
- **makeWatchConsole** (function) `(db: Db, llm: LlmClient | null): restate.ServiceDefinition<"WatchConsole", { done: (_: restate.Context, req: IdsRequest) => Promise<{ done: string[]; }>; undone: (_: restate.Context, req: IdsRequest) => Promise<{ done: string[]; }>; hide: (_: restate.Context, req: LikeRequest) => Promise<{ done: string[]; rules: number; }>; show: (…`
- **watchConsoleApi** (function) `(db: Db, llm: LlmClient | null = null): { done: (req: IdsRequest) => Promise<{ done: string[]; }>; undone: (req: IdsRequest) => Promise<{ done: string[]; }>; hide: (req: LikeRequest) => Promise<{ done: string[]; rules: number; }>; show: (req: LikeRequest) => Promise<{ done: string[]; rules: number; }>; sort: (req: IdsRequest) => Promise<{…`

## packages/watch/src/read.ts

- **ReadStats** (interface) `interface ReadStats { kept: number[]; failed: Array<{ mailbox: string; error: string }>; }`
- **readMail** (function) `(db: Db, boxes: readonly Mailbox[], now: Date, reader: Reader = "monitor"): Promise<ReadStats>`
- **relinkMail** (function) `(db: Db, boxes: readonly Mailbox[], window: RelinkWindow): Promise<{ linked: number; tried: number; oldest: Date | null }>`

## packages/watch/src/records.ts

- **WATCH_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/watch/src/restate.ts

- **WATCH_EVERY_MS** (const) `number`
- **WATCH_KEY** (const) `"all"`
- **Watch** (type) `type Watch = ReturnType<typeof makeWatch>;`
- **WatchDeps** (interface) `interface WatchDeps { db: Db; mailboxes: readonly Mailbox[]; fetch?: FetchFn; notifier?: Notifier; zone?: string; portal?: string | null; send?: ((m: DigestMail) => Promise<void>) | null; watch?: (address: string) => Promise<number | null>; embed?: Embed | null; sites?: SiteClient | null; pictures?: PictureStore | null; }`
- **makeWatch** (function) `(deps: WatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<Stats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<Stats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => Promise<i…`

## packages/watch/src/schema.ts

- **MAIL_SENT_STATES** (const) `readonly ["sending", "sent", "failed"]`
- **MailSentState** (type) `type MailSentState = (typeof MAIL_SENT_STATES)[number];`
- **READERS** (const) `readonly ["monitor", "mail"]`
- **Reader** (type) `type Reader = (typeof READERS)[number];`
- **VERDICTS** (const) `readonly ["show", "hold", "drop"]`
- **Verdict** (type) `type Verdict = (typeof VERDICTS)[number];`
- **mail** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "mail"; schema: "watch"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "mail"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false…`
- **mailRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"mail_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "mail_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **mailSent** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "mail_sent"; schema: "watch"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "mail_sent"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **ruleRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"rule_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "rule_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **rules** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "rules"; schema: "watch"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "rules"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **watch** (const) `import("drizzle-orm/pg-core").PgSchema<"watch">`

## packages/watch/src/triage.ts

- **Rule** (type) `type Rule = typeof rules.$inferSelect;`
- **clientSystem** (function) `(business: string): string`
- **clientTriageStep** (function) `(of: (client: string) => Promise<{ db: Db; name: string; modelFor: (mailbox: string) => Promise<LlmClient | null>; }>): Step`
- **mailEvent** (function) `(id: number): ExecutorEvent`
- **promptFor** (function) `(all: readonly Rule[], m: Mail): string`
- **settle** (function) `(all: readonly Rule[], m: Pick<Mail, "fromAddress" | "subject">): Rule | null`
- **sortAgain** (function) `(db: Db, llm: LlmClient | null, ids: readonly number[]): Promise<Partial<Record<Verdict, number>>>`
- **triage** (function) `(db: Db, llm: LlmClient | null, id: number, system: string = SYSTEM): Promise<Verdict | null>`
- **triageStep** (function) `(db: Db, llm: LlmClient | null): Step`

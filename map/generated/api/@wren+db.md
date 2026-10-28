# @wren/db: interface

Exports: 57. Files: 11.

## packages/db/src/audit/acting.ts

- **actingAs** (function) `(who: Acting, fn: () => T): T`
- **actingNow** (function) `(): Acting | null`

## packages/db/src/audit/index.ts

- **installAudit** (function) `(db: Db): Promise<{ added: number; removed: number }>`
- **sealAudit** (function) `(db: Db, opts: { lockWaitMs?: number } = {}): Promise<AuditSeal | null>`
- **verifyAudit** (function) `(db: Queryable): Promise<AuditCheck>`
- **setAuditActor** (function) `(tx: Queryable, actor: string): Promise<void>`
- **recentAuditEvents** (function) `(db: Queryable, opts: { table?: string; limit?: number } = {}): Promise<AuditEvent[]>`
- **formatAuditEvent** (function) `(e: AuditEvent, values = false): string`
- **AUDIT_SKIPPED** (const) `Readonly<Record<string, string>>`
- **AUDIT_SKIPPED_SCHEMAS** (const) `Readonly<Record<string, string>>`
- **auditName** (function) `(schema: string, table: string): string`
- **AUDIT_TABLES** (const) `readonly ["audit_events", "audit_seals", "audit_eras"]`
- **AuditCheck** (interface) `interface AuditCheck { seals: number; sealed: number; unsealed: number; broken: { seal: number; problem: string } | null; lastHash: string | null; }`

## packages/db/src/audit/schema.ts

- **auditEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "audit_events"; dataType: "number"; columnType: "PgBigInt53"; data: number; driverParam: string | number; notNull: true; hasDefau…`
- **auditSeals** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_seals"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "audit_seals"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault:…`
- **auditEras** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_eras"; schema: undefined; columns: { era: import("drizzle-orm/pg-core").PgColumn<{ name: "era"; tableName: "audit_eras"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault:…`
- **AuditEvent** (type) `type AuditEvent = typeof auditEvents.$inferSelect;`
- **AuditSealRow** (type) `type AuditSealRow = typeof auditSeals.$inferSelect;`

## packages/db/src/clients.ts

- **clientDatabaseName** (function) `(id: string): string`
- **clientLoginPassword** (function) `(mainUrl: string, database: string): string`
- **clientDatabaseUrl** (function) `(mainUrl: string, database: string): string`
- **clientAdminUrl** (function) `(mainUrl: string, database: string): string`
- **scramVerifier** (function) `(password: string, salt = randomBytes(16), iterations = 4096): string`
- **createDatabase** (function) `(main: Db, database: string): Promise<boolean>`
- **dropDatabase** (function) `(main: Db, database: string): Promise<void>`
- **clientDatabases** (function) `(main: Db): Promise<string[]>`
- **migrateClient** (function) `(mainUrl: string, database: string): Promise<void>`
- **migrateClients** (function) `(mainUrl: string, databases: string[], done?: (database: string) => void): Promise<void>`
- **CLIENT_ID** (const) `RegExp`

## packages/db/src/columns.ts

- **nonNegative** (function) `(table: string, cols: Record<string, { name: string }>): import("drizzle-orm/pg-core").CheckBuilder[]`
- **oneOf** (function) `(name: string, col: { name: string }, values: readonly string[]): import("drizzle-orm/pg-core").CheckBuilder`
- **baseColumns** (const) `{ id: import("drizzle-orm").NotNull<import("drizzle-orm").HasDefault<import("drizzle-orm/pg-core").PgUUIDBuilderInitial<"id">>>; createdAt: import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgTimestampBuilderInitial<"created_at">>>; }`
- **pgSafe** (function) `(v: T): T`

## packages/db/src/index.ts

- **createDb** (function) `(databaseUrl: string, opts: DbOptions = {}): DbHandle`
- **cachedDb** (function) `(databaseUrl: string, opts: Pick<DbOptions, "app"> = {}): Db`
- **migrate** (function) `(db: Db): Promise<void>`
- **Db** (type) `type Db = ReturnType<typeof drizzle>;`
- **Tx** (type) `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];`
- **Queryable** (type) `type Queryable = Db | Tx;`
- **DbHandle** (interface) `interface DbHandle { db: Db; close(): Promise<void>; }`

## packages/db/src/isolation.ts

- **atomic** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`
- **snapshot** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`
- **sqlState** (function) `(err: unknown): string | undefined`
- **serializable** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`

## packages/db/src/listen.ts

- **listen** (function) `(databaseUrl: string, channel: string, onPayload: (payload: string) => void, opts: { app?: string } = {}): Promise<Listening>`
- **Listening** (interface) `interface Listening { close(): Promise<void>; }`

## packages/db/src/testing-global-setup.ts

- **default** (function) `(project: TestProject): Promise<(() => Promise<void>) | void>`

## packages/db/src/testing-vitest.ts

- **default** (CallExpression) ``

## packages/db/src/testing.ts

- **selfRemoving** (function) `(container: C, entrypoint: string[], command: string[] = [], lifetime = "30m"): C`
- **startPostgresContainer** (function) `(maxConnections?: number, lifetime?: string): Promise<StartedPostgreSqlContainer>`
- **migrateTemplate** (function) `(adminUrl: string): Promise<void>`
- **startTestPostgres** (function) `(options: TestPostgresOptions = {}): Promise<TestPostgres>`
- **truncate** (function) `(db: DbHandle["db"], tables: string[]): Promise<void>`
- **seedObjects** (function) `(db: DbHandle["db"], objects: readonly SeedObject[]): Promise<void>`
- **commentObjects** (function) `(rows: ReadonlyArray<{ platform: string; ref: string; post: string; parent?: string | null | undefined; answerRef?: string | null | undefined; }>): SeedObject[]`
- **TestPostgres** (interface) `interface TestPostgres extends DbHandle { url: string; stop(): Promise<void>; }`
- **TEMPLATE_DATABASE** (const) `"wren_template"`

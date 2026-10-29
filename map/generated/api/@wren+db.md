# @wren/db: interface

Exports: 57. Files: 11.

## packages/db/src/audit/acting.ts

- **actingAs** (function) `(who: Acting, fn: () => T): T`
- **actingNow** (function) `(): Acting | null`

## packages/db/src/audit/index.ts

- **AUDIT_SKIPPED** (const) `Readonly<Record<string, string>>`
- **AUDIT_SKIPPED_SCHEMAS** (const) `Readonly<Record<string, string>>`
- **AUDIT_TABLES** (const) `readonly ["audit_events", "audit_seals", "audit_eras"]`
- **AuditCheck** (interface) `interface AuditCheck { seals: number; sealed: number; unsealed: number; broken: { seal: number; problem: string } | null; lastHash: string | null; }`
- **auditName** (function) `(schema: string, table: string): string`
- **formatAuditEvent** (function) `(e: AuditEvent, values = false): string`
- **installAudit** (function) `(db: Db): Promise<{ added: number; removed: number }>`
- **recentAuditEvents** (function) `(db: Queryable, opts: { table?: string; limit?: number } = {}): Promise<AuditEvent[]>`
- **sealAudit** (function) `(db: Db, opts: { lockWaitMs?: number } = {}): Promise<AuditSeal | null>`
- **setAuditActor** (function) `(tx: Queryable, actor: string): Promise<void>`
- **verifyAudit** (function) `(db: Queryable): Promise<AuditCheck>`

## packages/db/src/audit/schema.ts

- **AuditEvent** (type) `type AuditEvent = typeof auditEvents.$inferSelect;`
- **AuditSealRow** (type) `type AuditSealRow = typeof auditSeals.$inferSelect;`
- **auditEras** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_eras"; schema: undefined; columns: { era: import("drizzle-orm/pg-core").PgColumn<{ name: "era"; tableName: "audit_eras"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault:…`
- **auditEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "audit_events"; dataType: "number"; columnType: "PgBigInt53"; data: number; driverParam: string | number; notNull: true; hasDefau…`
- **auditSeals** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_seals"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "audit_seals"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault:…`

## packages/db/src/clients.ts

- **CLIENT_ID** (const) `RegExp`
- **clientAdminUrl** (function) `(mainUrl: string, database: string): string`
- **clientDatabaseName** (function) `(id: string): string`
- **clientDatabaseUrl** (function) `(mainUrl: string, database: string): string`
- **clientDatabases** (function) `(main: Db): Promise<string[]>`
- **clientLoginPassword** (function) `(mainUrl: string, database: string): string`
- **createDatabase** (function) `(main: Db, database: string): Promise<boolean>`
- **dropDatabase** (function) `(main: Db, database: string): Promise<void>`
- **migrateClient** (function) `(mainUrl: string, database: string): Promise<void>`
- **migrateClients** (function) `(mainUrl: string, databases: string[], done?: (database: string) => void): Promise<void>`
- **scramVerifier** (function) `(password: string, salt = randomBytes(16), iterations = 4096): string`

## packages/db/src/columns.ts

- **baseColumns** (const) `{ id: import("drizzle-orm").NotNull<import("drizzle-orm").HasDefault<import("drizzle-orm/pg-core").PgUUIDBuilderInitial<"id">>>; createdAt: import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgTimestampBuilderInitial<"created_at">>>; }`
- **nonNegative** (function) `(table: string, cols: Record<string, { name: string }>): import("drizzle-orm/pg-core").CheckBuilder[]`
- **oneOf** (function) `(name: string, col: { name: string }, values: readonly string[]): import("drizzle-orm/pg-core").CheckBuilder`
- **pgSafe** (function) `(v: T): T`

## packages/db/src/index.ts

- **Db** (type) `type Db = ReturnType<typeof drizzle>;`
- **DbHandle** (interface) `interface DbHandle { db: Db; close(): Promise<void>; }`
- **Queryable** (type) `type Queryable = Db | Tx;`
- **Tx** (type) `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];`
- **cachedDb** (function) `(databaseUrl: string, opts: Pick<DbOptions, "app"> = {}): Db`
- **createDb** (function) `(databaseUrl: string, opts: DbOptions = {}): DbHandle`
- **migrate** (function) `(db: Db): Promise<void>`

## packages/db/src/isolation.ts

- **atomic** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`
- **serializable** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`
- **snapshot** (function) `(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T>`
- **sqlState** (function) `(err: unknown): string | undefined`

## packages/db/src/listen.ts

- **Listening** (interface) `interface Listening { close(): Promise<void>; }`
- **listen** (function) `(databaseUrl: string, channel: string, onPayload: (payload: string) => void, opts: { app?: string } = {}): Promise<Listening>`

## packages/db/src/testing-global-setup.ts

- **default** (function) `(project: TestProject): Promise<(() => Promise<void>) | void>`

## packages/db/src/testing-vitest.ts

- **default** (CallExpression) ``

## packages/db/src/testing.ts

- **TEMPLATE_DATABASE** (const) `"wren_template"`
- **TestPostgres** (interface) `interface TestPostgres extends DbHandle { url: string; stop(): Promise<void>; }`
- **commentObjects** (function) `(rows: ReadonlyArray<{ platform: string; ref: string; post: string; parent?: string | null | undefined; answerRef?: string | null | undefined; }>): SeedObject[]`
- **migrateTemplate** (function) `(adminUrl: string): Promise<void>`
- **seedObjects** (function) `(db: DbHandle["db"], objects: readonly SeedObject[]): Promise<void>`
- **selfRemoving** (function) `(container: C, entrypoint: string[], command: string[] = [], lifetime = "30m"): C`
- **startPostgresContainer** (function) `(maxConnections?: number, lifetime?: string): Promise<StartedPostgreSqlContainer>`
- **startTestPostgres** (function) `(options: TestPostgresOptions = {}): Promise<TestPostgres>`
- **truncate** (function) `(db: DbHandle["db"], tables: string[]): Promise<void>`

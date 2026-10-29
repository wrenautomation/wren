# @wren/auth: interface

Exports: 20. Files: 4.

## packages/auth/src/handoff.ts

- **BACK_PATH** (const) `"/__auth/back"`
- **handoff** (function) `(o: HandoffOptions): { id: "wren-handoff"; endpoints: { handoff: import("better-auth").StrictEndpoint<"/handoff", { method: "GET"; query: z.ZodObject<{ to: z.ZodString; }, z.core.$strip>; use: import("better-auth").Middleware<import("better-auth").MiddlewareOptions, (inputContext: import("better-auth").MiddlewareInputCo…`
- **handoffTarget** (function) `(to: string): URL | null`

## packages/auth/src/index.ts

- **Auth** (type) `type Auth = ReturnType<typeof makeAuth>;`
- **AuthMail** (interface) `interface AuthMail { to: string; subject: string; text: string; }`
- **makeAuth** (function) `(o: AuthOptions): import("better-auth").Auth<{ appName: string; baseURL: string; secret: string; trustedOrigins: string[]; database: (options: import("better-auth").BetterAuthOptions) => import("better-auth").DBAdapter<import("better-auth").BetterAuthOptions>; telemetry: { enabled: false; }; session: { expiresIn: num…`

## packages/auth/src/schema.ts

- **account** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "account"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "account"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: t…`
- **auth** (const) `import("drizzle-orm/pg-core").PgSchema<"auth">`
- **jwks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "jwks"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "jwks"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; i…`
- **passkey** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "passkey"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "passkey"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: t…`
- **rateLimit** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "rate_limit"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "rate_limit"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimary…`
- **schema** (SourceFile) ``
- **session** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "session"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "session"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: t…`
- **user** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "user"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "user"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; i…`
- **verification** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "verification"; schema: "auth"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "verification"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPri…`

## packages/auth/src/verify.ts

- **AUDIENCE** (const) `"wren"`
- **Signed** (interface) `interface Signed { email: string; name?: string; operator: boolean; sub: string; }`
- **bearer** (function) `(req: Request): string | null`
- **forgetKeys** (function) `(): void`
- **verifyToken** (function) `(token: string | null, check: TokenCheck, opts: { fetcher?: typeof fetch; now?: number } = {}): Promise<Signed | null>`

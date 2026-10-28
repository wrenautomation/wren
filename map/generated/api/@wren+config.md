# @wren/config: interface

Exports: 14. Files: 3.

## packages/config/src/env-file.ts

- **loadEnvFile** (function) `(startDir: string = process.cwd(), rootDir?: string): string`

## packages/config/src/index.ts

- **ingressOf** (function) `(s: Pick<Settings, "restateIngressUrl" | "restateAuthToken">): { url: string; headers?: Record<string, string>; serde: typeof INGRESS_JSON; }`
- **loadSettings** (function) `(env: NodeJS.ProcessEnv = process.env, opts: LoadOptions = {}): Settings`
- **CONTENT_CHANNELS** (const) `readonly ["linkedin", "reddit", "youtube", "x", "instagram", "threads", "facebook", "tiktok"]`
- **settingsSchema** (const) `z.ZodObject<{ databaseUrl: z.ZodString; databasePoolPort: z.ZodOptional<z.ZodCoercedNumber<unknown>>; restateIngressUrl: z.ZodDefault<z.ZodString>; restateAuthToken: z.ZodOptional<z.ZodString>; restateAdminUrl: z.ZodOptional<z.ZodString>; cacheUrl: z.ZodOptional<z.ZodString>; lakePath: z.ZodOptional…`
- **Settings** (type) `type Settings = z.infer<typeof settingsSchema>;`
- **INGRESS_JSON** (const) `{ readonly contentType: string; serialize(value: unknown): Uint8Array; deserialize(bytes: Uint8Array): unknown; }`
- **ENV_KEYS** (const) `{ readonly databaseUrl: "WREN_DATABASE_URL"; readonly databasePoolPort: "WREN_DATABASE_POOL_PORT"; readonly restateIngressUrl: "WREN_RESTATE_INGRESS_URL"; readonly restateAuthToken: "RESTATE_AUTH_TOKEN"; readonly restateAdminUrl: "WREN_RESTATE_ADMIN_URL"; readonly cacheUrl: "WREN_CACHE_URL"; readonl…`
- **LoadOptions** (interface) `interface LoadOptions { rootDir?: string; }`

## packages/config/src/ssm.ts

- **applyEnv** (function) `(json: string, env: NodeJS.ProcessEnv = process.env): string[]`
- **loadSsmEnv** (function) `(list: string | undefined, o: LoadOptions = {}): Promise<string[]>`
- **loadSsmFile** (function) `(name: string | undefined, path: string): Promise<string | null>`
- **SsmReader** (interface) `interface SsmReader { send(cmd: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }>; }`
- **paramNames** (function) `(list: string | undefined): string[]`

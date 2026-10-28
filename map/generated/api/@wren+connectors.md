# @wren/connectors: interface

Exports: 31. Files: 6.

## packages/connectors/src/apps.ts

- **CONNECTOR_APPS** (const) `readonly ["hubspot", "quickbooks", "jobber"]`
- **ConnectorApp** (type) `type ConnectorApp = (typeof CONNECTOR_APPS)[number];`
- **APPS** (const) `Record<ConnectorApp, AppSpec>`
- **appKeyName** (function) `(app: ConnectorApp, part: "ID" | "SECRET"): string`

## packages/connectors/src/connectors.ts

- **connectorAccess** (function) `(deps: ConnectorDeps): { link: (id: number) => Promise<{ id: number; client: string; app: "hubspot" | "quickbooks" | "jobber"; externalId: string; name: string | null; scopes: string; tokenRef: string; extra: LinkExtra; state: "connected" | "broken"; why: string | null; cursor: import("./schema.js").LinkCursor; people: nu…`
- **connectorAppsFrom** (function) `(keys: KeyStore | null, env: Record<string, string | undefined> = {}): () => Promise<ConnectorApps>`
- **WHO** (const) `Record<ConnectorApp, WhoAmI>`
- **AppView** (interface) `interface AppView { app: ConnectorApp; label: string; reads: string; fires: string; state: ConnectorState; links: LinkView[]; }`
- **Landing** (interface) `interface Landing { ok: boolean; said: string; link: number | null; }`
- **ConnectorAccess** (type) `type ConnectorAccess = ReturnType<typeof connectorAccess>;`

## packages/connectors/src/console-routes.ts

- **CONNECTORS_ROUTES** (const) `{ readonly connectors: "read"; readonly connect: "act"; readonly syncNow: "act"; readonly disconnect: "act"; }`
- **CONNECTORS_APPS** (const) `{ readonly "*": "account"; }`
- **CONNECTORS_WRITES** (const) `readonly (keyof typeof CONNECTORS_ROUTES)[]`

## packages/connectors/src/restate.ts

- **connectorsConsoleApi** (function) `(deps: ConnectorsDeps): { connectors(req: PortalRequest): Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; } | { apps: import("./connectors.js").AppView[]; ready: boolean; owner: { id: string; name: string; }; wren: false; mayAct: boolean; }>; connect(req: PortalRequest & { app: ConnectorApp; }): …`
- **makeConnectors** (function) `(deps: ConnectorsDeps): restate.ServiceDefinition<"Connectors", { connectors: (_: restate.Context, req: PortalRequest) => Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; } | { apps: import("./connectors.js").AppView[]; ready: boolean; owner: { id: string; name: string; }; wren: false; mayAct: boo…`
- **makeConnectorCallback** (function) `(deps: ConnectorsDeps): restate.ServiceDefinition<"ConnectorCallback", { land: (ctx: restate.Context, q: z.infer<typeof CONNECTOR_LANDING>) => Promise<{ ok: boolean; said: string; }>; }>`
- **makeConnectorSync** (function) `(deps: ConnectorSyncDeps): restate.VirtualObjectDefinition<"ConnectorSync", { run: (ctx: restate.ObjectContext<restate.UntypedState>, input: { chain?: string; }) => Promise<{ state: string; people: number; fired: number; }>; }>`
- **SYNC_EVERY_MS** (const) `number`
- **ConnectorsPageView** (type) `type ConnectorsPageView = Awaited< ReturnType<ReturnType<typeof connectorsConsoleApi>["connectors"]> >;`

## packages/connectors/src/schema.ts

- **LINK_STATES** (const) `readonly ["connected", "broken"]`
- **LinkState** (type) `type LinkState = (typeof LINK_STATES)[number];`
- **connectorGrants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "connector_grants"; schema: undefined; columns: { state: import("drizzle-orm/pg-core").PgColumn<{ name: "state"; tableName: "connector_grants"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasD…`
- **LinkExtra** (interface) `interface LinkExtra { realm?: string; }`
- **LinkCursor** (type) `type LinkCursor = Record<string, string>;`
- **connectorLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "connector_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "connector_links"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **ConnectorLink** (type) `type ConnectorLink = typeof connectorLinks.$inferSelect;`
- **connectorFired** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "connector_fired"; schema: undefined; columns: { linkId: import("drizzle-orm/pg-core").PgColumn<{ name: "link_id"; tableName: "connector_fired"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: …`

## packages/connectors/src/sync.ts

- **peopleCsv** (function) `(people: readonly PulledPerson[]): string`
- **syncLink** (function) `(deps: SyncDeps, id: number): Promise<SyncResult>`
- **CrmLanding** (interface) `interface CrmLanding { land(db: Queryable, o: { format: ConnectorApp; ref: string; csv: Uint8Array }): Promise<void>; contacts( db: Queryable, format: ConnectorApp, ids: readonly string[], ): Promise<{ id: string; email: string | null; phone: string | null }[]>; }`
- **SyncDeps** (interface) `interface SyncDeps { main: Db; clientDb: (client: string) => Queryable; crm: CrmLanding; access: ConnectorAccess; fetch: FetchLike; pullers?: Partial<Record<ConnectorApp, Puller>>; cap?: number; now?: () => Date; }`

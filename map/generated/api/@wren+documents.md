# @wren/documents: interface

Exports: 120. Files: 12.

## packages/core/src/clients/schema.ts

- **Client** (type) `type Client = typeof clients.$inferSelect;`

## packages/documents/src/components.ts

- **DOCUMENTS** (const) `"documents.docs"`
- **DOCUMENTS_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/documents/src/console-routes.ts

- **DOCUMENTS_CONSOLE_APPS** (const) `{ readonly "*": "documents"; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; }`
- **DOCUMENTS_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly templates: "read"; readonly pdf: "read"; readonly create: "act"; readonly update: "act"; readonly send: "act"; readonly approve: "act"; …`
- **DOCUMENTS_CONSOLE_WRITES** (const) `readonly DocumentsConsoleRoute[]`

## packages/documents/src/console.ts

- **CreateRequest** (interface) `interface CreateRequest extends PortalRequest, DocFields {}`
- **IdRequest** (interface) `interface IdRequest extends PortalRequest { id: string; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`
- **TemplateRequest** (interface) `interface TemplateRequest extends PortalRequest { id?: string | null; kind?: string | null; name?: string | null; body?: string | null; lines?: unknown; depositPct?: number | string | null; expiresDays?: number | string | null; expect?: unknown; }`
- **documentsConsoleApi** (function) `(deps: DocumentsConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`
- **factsOf** (function) `(main: Db, client: Pick<Client, "id" | "name">): Promise<{ "biz.name": string; }>`
- **makeDocumentsConsole** (function) `(deps: DocumentsConsoleDeps): restate.ServiceDefinition<"DocumentsConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: re…`

## packages/documents/src/documenso.ts

- **Documenso** (type) `type Documenso = ReturnType<typeof documenso>;`
- **DocumensoError** (class) `constructor(readonly status: number, message: string); get transient()`
- **documenso** (function) `(cfg: DocumensoConfig): { create(o: { title: string; externalId: string; signer: { name: string; email: string; }; pdf: Uint8Array; }): Promise<string>; distribute(envelopeId: string): Promise<string>; look: (envelopeId: string) => Promise<{ status: string; url: string | null; }>; sealed(envelopeId: string): Promise<Sealed…`
- **eventOf** (function) `(body: unknown): DocumensoEvent | null`

## packages/documents/src/lines.ts

- **DOC_KINDS** (const) `readonly ["contract", "proposal", "estimate"]`
- **DocKind** (type) `type DocKind = (typeof DOC_KINDS)[number];`
- **DocLine** (interface) `interface DocLine { name: string; detail?: string | null; qty: number; unit_cents: number; tax_pct?: number | null; }`
- **KIND_NAME** (const) `Record<DocKind, string>`
- **KIND_PREFIX** (const) `Record<DocKind, string>`
- **SIGN_LABEL** (const) `Record<DocKind, string>`
- **SLOT_NAMES** (const) `{ readonly "contact.name": "Their full name"; readonly "contact.first_name": "Their first name"; readonly "contact.email": "Their email"; readonly "biz.name": "Your business name"; readonly "biz.phone": "Your phone (a business fact)"; readonly "biz.email": "Your email (a business fact)"; readonly "d…`
- **depositOf** (function) `(total: number, pct: number | null | undefined): number | null`
- **fillSlots** (function) `(text: string, values: Readonly<Record<string, string>>): string`
- **lineAmount** (function) `(l: DocLine): number`
- **lineTax** (function) `(l: DocLine): number`
- **money** (function) `(cents: number, currency = "usd"): string`
- **slotsLeft** (function) `(...texts: string[]): string[]`
- **totalsOf** (function) `(lines: readonly DocLine[]): { subtotalCents: number; taxCents: number; totalCents: number; }`

## packages/documents/src/pdf.ts

- **ansi** (function) `(s: string): string`
- **docPdf** (function) `(d: Doc, events: readonly DocEvent[], business: string): Promise<Uint8Array>`
- **invoicePdf** (function) `(i: InvoicePdf): Promise<Uint8Array>`
- **sealedPdf** (function) `(d: Doc, business: string): Promise<Uint8Array>`

## packages/documents/src/records.ts

- **DOCUMENTS_RECORDS** (const) `readonly RecordType[]`
- **DOC_RECORD** (const) `"documents.document"`
- **TEMPLATE_RECORD** (const) `"documents.template"`
- **documentRecordFor** (function) `(client: string): RecordType`
- **templateRecordFor** (function) `(client: string): RecordType`

## packages/documents/src/render.ts

- **PageCtx** (interface) `interface PageCtx { business: string; look: PageLook; token: string; siteKey: string | null; reach: { phone: string | null; email: string | null }; error?: string | null; typed?: { name?: string; email?: string } | null; deposit?: "pay" | "paid" | "clearing" | "refunded" | null | undefined; }`
- **docPage** (function) `(d: Doc, ctx: PageCtx): string`
- **esc** (function) `(s: unknown): string`
- **lookOf** (function) `(raw: unknown): PageLook`
- **shutPage** (function) `(why: "expired" | "void" | "missing", ctx: Pick<PageCtx, "business" | "look" | "reach">): string`

## packages/documents/src/schema.ts

- **DOC_CHANNELS** (const) `readonly ["email", "sms"]`
- **DOC_EVENTS** (const) `readonly ["made", "asked", "sent", "viewed", "signed", "declined", "paid", "voided", "expired", "reminded"]`
- **DOC_SIGNINGS** (const) `readonly ["own", "sealed"]`
- **DOC_STATUSES** (const) `readonly ["draft", "waiting", "sending", "sent", "viewed", "signed", "declined", "expired", "void", "failed"]`
- **Doc** (type) `type Doc = typeof docs.$inferSelect;`
- **DocChannel** (type) `type DocChannel = (typeof DOC_CHANNELS)[number];`
- **DocEvent** (type) `type DocEvent = typeof docEvents.$inferSelect;`
- **DocEventType** (type) `type DocEventType = (typeof DOC_EVENTS)[number];`
- **DocSigning** (type) `type DocSigning = (typeof DOC_SIGNINGS)[number];`
- **DocStatus** (type) `type DocStatus = (typeof DOC_STATUSES)[number];`
- **DocTemplate** (type) `type DocTemplate = typeof docTemplates.$inferSelect;`
- **SealedFiles** (interface) `interface SealedFiles { pdf: string; certificate: string; audit: string; sha256: string; at: string; }`
- **docCounters** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "doc_counters"; schema: undefined; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "doc_counters"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **docEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "doc_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "doc_events"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: true; …`
- **docTemplates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "doc_templates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "doc_templates"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **docs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "docs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "docs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false…`

## packages/documents/src/service.ts

- **Answer** (interface) `interface Answer { status: number; html?: string; pdf?: string; filename?: string; location?: string; }`
- **DOCUMENTS_SERVICE** (const) `{ readonly name: "Documents"; }`
- **DocumentsDeps** (interface) `interface DocumentsDeps extends Pick< PaymentsDeps, "main" | "open" | "keys" | "fetch" | "portal" | "stripeBase" | "stripeRetry" > { mailer: ((from: string) => SendMail) | null; fire?: FireTriggers; documenso?: Documenso | null; files?: SealedStore | null; esignRetry?: PaymentsDeps["stripeRetry"]; }`
- **DocumentsService** (type) `type DocumentsService = ReturnType<typeof makeDocuments>;`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;`
- **WREN_CLIENT** (const) `"wren"`
- **hostOf** (function) `(main: Db, client: string, portal: string): Promise<string>`
- **makeDocuments** (function) `(deps: DocumentsDeps): restate.ServiceDefinition<"Documents", { send: (ctx: restate.Context, req: { id: string; remind?: boolean | null; by?: string | null; }) => Promise<{ sent: boolean; url: null; why?: never; } | { sent: boolean; why: string; url: null; } | { sent: boolean; url: string; why?: never; }>; serve: (ctx: re…`

## packages/documents/src/store.ts

- **CONSENT_WORDS** (const) `"I agree to sign electronically. Typing my name is my signature."`
- **DocRefusal** (class) ``
- **OPEN** (const) `readonly DocStatus[]`
- **SEALED_CONSENT_VERSION** (const) `"2026-10-21"`
- **SEALED_CONSENT_WORDS** (const) `"By signing I agree to use electronic records and an electronic signature. My signature here has the same effect as a handwritten one. I can keep a copy and ask for a paper one."`
- **Signing** (interface) `interface Signing extends Visit { name: unknown; email: unknown; consent: unknown; sha: unknown; }`
- **TOKEN** (const) `RegExp`
- **Visit** (interface) `interface Visit { ip?: string | null | undefined; agent?: string | null | undefined; now: Date; }`
- **approveDocs** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<Doc[]>`
- **archiveTemplates** (function) `(main: Queryable, client: string, ids: readonly string[], now: Date): Promise<number>`
- **askSend** (function) `(main: Db, client: string, id: string, a: { facts: Readonly<Record<string, string>>; by: string; approved: boolean; sealedOn?: boolean; now: Date; }): Promise<Doc>`
- **centsOf** (function) `(amount: unknown): number`
- **declineDoc** (function) `(main: Db, d: Doc, v: Visit & { why?: unknown }): Promise<Doc>`
- **declineDocs** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<number>`
- **docApprovalId** (function) `(id: string): string`
- **docByEnvelope** (function) `(main: Queryable, envelopeId: string): Promise<Doc | null>`
- **docById** (function) `(main: Queryable, id: string): Promise<Doc | null>`
- **docByToken** (function) `(main: Db, token: string, client: string | null, now: Date): Promise<Doc | null>`
- **docEventsOf** (function) `(main: Queryable, id: string): Promise<{ id: number; document: string; type: string; at: Date; by: string; ip: string | null; agent: string | null; note: string | null; }[]>`
- **docIdOf** (function) `(id: string): string`
- **docOf** (function) `(main: Queryable, client: string, id: string): Promise<Doc>`
- **docPath** (function) `(token: string): string`
- **duplicateDoc** (function) `(main: Db, client: string, id: string, by: string, now: Date): Promise<Doc>`
- **editDoc** (function) `(main: Queryable, client: string, id: string, p: DocPatch, now: Date): Promise<Doc>`
- **ensureStarters** (function) `(main: Queryable, client: string, by: string): Promise<void>`
- **factsFor** (function) `(d: Pick< Doc, "name" | "email" | "number" | "totalCents" | "depositCents" | "currency" | "expiresAt" >, facts: Readonly<Record<string, string>> = {}): Record<string, string>`
- **freezeDoc** (function) `(main: Db, id: string, now: Date): Promise<Doc>`
- **isKind** (function) `(v: unknown): v is DocKind`
- **isSigning** (function) `(v: unknown): v is DocSigning`
- **issueLink** (function) `(main: Db, id: string, now: Date): Promise<string>`
- **keepEnvelope** (function) `(main: Db, id: string, envelopeId: string, now: Date, was: string | null = null): Promise<string>`
- **keepPayLink** (function) `(main: Db, id: string, link: string, now: Date, replacing: string | null = null): Promise<void>`
- **linesOf** (function) `(input: unknown): DocLine[]`
- **makeDoc** (function) `(main: Db, n: NewDoc): Promise<Doc>`
- **markFailed** (function) `(main: Db, id: string, why: string, now: Date): Promise<void>`
- **markSent** (function) `(main: Db, id: string, s: { message: number | null; by: string; now: Date; remind?: boolean }): Promise<void>`
- **newToken** (function) `(): { token: string; hash: string }`
- **remindable** (function) `(d: Doc, now: Date): string | null`
- **saveTemplate** (function) `(main: Queryable, client: string, input: TemplateInput, by: string, now: Date): Promise<DocTemplate>`
- **sealSigned** (function) `(main: Db, d: Doc, s: { signer: SealedSigner; files: SealedFiles; now: Date }): Promise<Doc | null>`
- **sealedCancelled** (function) `(main: Db, d: Doc, now: Date): Promise<Doc | null>`
- **sealedRejected** (function) `(main: Db, d: Doc, s: { why: string | null; now: Date }): Promise<Doc | null>`
- **seeDoc** (function) `(main: Db, d: Doc, v: Visit): Promise<"first" | "again" | null>`
- **sendBlocker** (function) `(d: Doc): string | null`
- **sha256** (function) `(s: string): string`
- **shaOf** (function) `(d: Shown): string`
- **signDoc** (function) `(main: Db, d: Doc, s: Signing): Promise<Doc>`
- **versionAt** (function) `(at: Date): string`
- **voidDocs** (function) `(main: Db, client: string, ids: readonly string[], by: string, now: Date): Promise<Array<{ id: string; envelopeId: string | null }>>`
- **waitingDocs** (function) `(main: Queryable): Promise<{ id: string; client: string; clientName: string | null; kind: string; number: string; title: string; name: string | null; email: string | null; channel: string; total: number; currency: string; by: string; at: Date; }[]>`
- **depositOf** (function) `(total: number, pct: number | null | undefined): number | null`

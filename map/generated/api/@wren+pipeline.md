# @wren/pipeline: interface

Exports: 404. Files: 46.

## packages/core/src/logic.ts

- **SOP_NAME** (const) `RegExp`
- **STUDY_SLUG** (const) `RegExp`

## packages/pipeline/src/blame.ts

- **historyOf** (function) `(versions: readonly BlameVersion[], id: string, on: "node" | "edge" = "node"): BlameLine[]`
- **isoOf** (function) `(at: Date | string): string`
- **BlameVersion** (interface) `interface BlameVersion { number: number; body: ShapeBody; note: string; createdBy: string; createdAt: Date | string; }`

## packages/pipeline/src/carry.ts

- **carryJourneys** (function) `(db: Queryable, toVersion: number, moves: Moves = {}): Promise<number>`
- **remapDeals** (function) `(db: Queryable, moves: Moves): Promise<number>`
- **Moves** (type) `type Moves = Record<string, string>;`

## packages/pipeline/src/collect.ts

- **collectedDelta** (function) `(data: Record<string, unknown>): number`
- **collectSteps** (function) `(d: CollectDeps): Record<string, Step>`
- **COLLECT_STEP** (const) `"pipeline.collect"`
- **MONEY_WORKFLOW** (const) `Workflow`

## packages/pipeline/src/components.ts

- **PIPELINE_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/pipeline/src/console-routes.ts

- **PIPELINE_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly mapRead: "read"; readonly offersSync: "act"; readonly shapeVersion: "act"; readonly shapeDiff: "read"; readonly shapeImport: "act"; read…`
- **PIPELINE_CONSOLE_APPS** (const) `{ readonly "*": "deals"; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; }`
- **PIPELINE_CONSOLE_WRITES** (const) `readonly PipelineConsoleRoute[]`

## packages/pipeline/src/console.ts

- **pipelineConsoleApi** (function) `({ db, open, records = PIPELINE_RECORDS, shapes = null, }: PipelineConsoleDeps): { workspace: (req: PortalRequest, p: "read" | "act") => Promise<{ client: string | null; db: Db; }>; by: (req: PortalRequest) => string; recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core…`
- **saveThenMirror** (function) `(ctx: Pick<restate.Context, "run">, api: { mirror: (req: PortalRequest) => Promise<unknown> }, name: string, req: Q, save: (req: Q) => Promise<T>): Promise<T>`
- **makePipelineConsole** (function) `(deps: PipelineConsoleDeps): restate.ServiceDefinition<"PipelineConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: res…`
- **UndoRequest** (type) `type UndoRequest = PortalRequest & UndoAsk;`
- **TagRequest** (type) `type TagRequest = PortalRequest & TagAsk;`
- **AttachRequest** (type) `type AttachRequest = PortalRequest & AttachAsk;`

## packages/pipeline/src/convert-shape.ts

- **dealRulesOf** (function) `(metro: MetroBody, open: ReadonlyMap<string, number>): DealRule[]`
- **refusalsOf** (function) `(r: ConvertReport): string[]`
- **reportLines** (function) `(r: ConvertReport): string[]`
- **planConvert** (function) `(stored: StoredBody, number: number, ctx: ShapeCheckContext, open: ReadonlyMap<string, number>): ConvertPlan`
- **convertShape** (function) `(db: Queryable, o: { note: string; by: string; triggers: ReadonlySet<string> }): Promise<{ version: ShapeVersion; report: ConvertReport }>`
- **ConvertReport** (interface) `interface ConvertReport { notes: string[]; checks: string[]; graphEqual: boolean; workflowEqual: boolean; deals: DealRule[]; }`
- **ConvertPlan** (type) `type ConvertPlan = | { already: true; body: MetroBody } | { already: false; body: MetroBody; report: ConvertReport };`

## packages/pipeline/src/convert.ts

- **strayFieldsOf** (function) `(graph: ShapeBody): StrayField[]`
- **withoutStrayFields** (function) `(graph: ShapeBody): ShapeBody`
- **metroOf** (function) `(graph: ShapeBody): MetroResult`
- **graphOf** (function) `(metro: MetroBody): ShapeBody`
- **lowerable** (function) `(metro: MetroBody): string[]`
- **strayNote** (function) `(s: StrayField): string`
- **isStrayNote** (function) `(note: string): boolean`

## packages/pipeline/src/diff.ts

- **canonicalJson** (function) `(v: unknown): string`
- **diffShapes** (function) `(a: ShapeBody, b: ShapeBody): ShapeDiff`
- **changesOf** (function) `(d: ShapeDiff): ShapeChange[]`
- **parseChangeKey** (function) `(key: string): ShapeChange | null`
- **changeLine** (function) `(a: ShapeBody, b: ShapeBody, c: ShapeChange): string`
- **ShapeDiff** (interface) `interface ShapeDiff { nodes: { added: string[]; removed: string[]; renamed: Array<{ id: string; from: string; to: string }>; changed: string[]; }; edges: { added: string[]; removed: string[]; changed: string[] }; name: { from: string; to: string } | null; }`
- **ShapeChange** (type) `type ShapeChange = | { on: "name" } | { on: "node"; id: string; how: "added" | "removed" | "renamed" | "changed" } | { on: "edge"; id: string; how: "added" | "removed" | "changed" };`
- **changeKey** (function) `(c: ShapeChange): string`
- **changeLines** (function) `(a: ShapeBody, b: ShapeBody, diff: ShapeDiff): string[]`

## packages/pipeline/src/drafts.ts

- **draftIdOf** (function) `(name: string): string`
- **draftOf** (function) `(db: Queryable, id: string): Promise<ShapeDraft | null>`
- **draftsOf** (function) `(db: Queryable, o: { states?: readonly DraftState[] } = {}): Promise<ShapeDraft[]>`
- **newDraft** (function) `(db: Queryable, input: NewDraft): Promise<ShapeDraft>`
- **updateDraft** (function) `(db: Queryable, input: DraftUpdate): Promise<ShapeDraft>`
- **editDraft** (function) `(db: Queryable, input: DraftEdit): Promise<{ draft: ShapeDraft; lines: string[]; warnings: string[] }>`
- **proposeDraft** (function) `(db: Queryable, input: { id: string; by: string }): Promise<ShapeDraft>`
- **planApply** (function) `(db: Queryable, id: string): Promise<ApplyPlan>`
- **applyDraft** (function) `(db: Queryable, input: { id: string; by: string; triggers: ReadonlySet<string> }): Promise<{ draft: ShapeDraft; version: ShapeVersion }>`
- **dropDraft** (function) `(db: Queryable, input: { id: string; by: string; reason: string }): Promise<ShapeDraft>`
- **parseRef** (function) `(v: unknown): ShapeRef`
- **bodyOfRef** (function) `(db: Queryable, ref: ShapeRef): Promise<StoredBody>`
- **DraftEdit** (interface) `interface DraftEdit { id: string; ops: unknown; by: string; triggers: ReadonlySet<string>; }`

## packages/pipeline/src/edit.ts

- **withNode** (function) `(body: ShapeBody, node: ShapeNode, edges: ShapeEdge[] = []): ShapeBody`
- **edgeOf** (function) `(from: string, to: string, o: { loop?: boolean; label?: string; id?: string } = {}): ShapeEdge`
- **withEdge** (function) `(body: ShapeBody, edge: ShapeEdge): ShapeBody`
- **withoutNode** (function) `(body: ShapeBody, id: string): ShapeBody`
- **withoutEdge** (function) `(body: ShapeBody, id: string): ShapeBody`
- **openOn** (function) `(db: Queryable, id: string): Promise<number>`
- **editShape** (function) `(db: Queryable, o: { change: (body: ShapeBody) => ShapeBody; note: string; by: string; triggers: ReadonlySet<string>; moves?: Moves; }): Promise<{ number: number; run: ShapeBody; createdAt: Date; body: StoredBody; draft: string | null; note: string; createdBy: string; parent: number | null; depths: Record<string, number>; }>`
- **undoChange** (function) `(newest: ShapeBody, a: ShapeBody, b: ShapeBody, change: ShapeChange): ShapeBody`
- **undoStoredChange** (function) `(newest: StoredBody, a: StoredBody, b: StoredBody, change: StoredChange): StoredBody`
- **ON_GRAPH** (const) `"The shape is on the graph model. Undo by node or edge."`
- **ON_METRO** (const) `"The shape is on the metro model. Export, edit the YAML, import."`

## packages/pipeline/src/entry.ts

- **opensAt** (function) `(body: ShapeBody, to: string, byHand: boolean, c: CauseFacts): boolean`
- **entryNodes** (function) `(body: ShapeBody): string[]`
- **entryOf** (function) `(body: ShapeBody, cause: CauseFacts, firstTouch?: CauseFacts | null, to?: string): SourceNode | null`
- **CauseFacts** (interface) `interface CauseFacts { entry?: string; channel?: string; platform?: string; campaign?: string; adCampaign?: string; source?: string; group?: string; sop?: string; study?: string; }`
- **MANUAL** (const) `"manual"`
- **foundBy** (function) `(s: SourceNode, c: CauseFacts): boolean`
- **liveSources** (function) `(body: ShapeBody): SourceNode[]`
- **sourceEdge** (function) `(body: ShapeBody, source: string, to: string): ShapeEdge | undefined`

## packages/pipeline/src/history.ts

- **DRAFT_STATES** (const) `readonly ["draft", "proposed", "applied", "dropped"]`
- **DraftState** (type) `type DraftState = (typeof DRAFT_STATES)[number];`
- **OPEN_DRAFT_STATES** (const) `readonly ["draft", "proposed"]`
- **ShapeRef** (type) `type ShapeRef = number | 'draft:${string}';`
- **DraftRow** (interface) `interface DraftRow { id: string; name: string; state: DraftState; base: number; note: string; createdBy: string; createdAt: string; updatedAt: string; appliedVersion: number | null; decidedBy: string | null; decidedAt: string | null; dropReason: string | null; }`
- **DraftDetail** (interface) `interface DraftDetail { body: ShapeBody; moves: Moves; metro: MetroBody | null; drawErrors: string[]; }`
- **MirrorRef** (interface) `interface MirrorRef { sha: string; url: string; }`
- **VersionLine** (interface) `interface VersionLine { number: number; parent: number | null; note: string; at: string; by: string; nodes: number; edges: number; draft: string | null; tags: TagRef[]; mirror: MirrorRef | null; }`
- **BlameLine** (interface) `interface BlameLine { version: number; how: "added" | "removed" | "renamed" | "changed"; from?: string; to?: string; note: string; by: string; at: string; }`
- **DraftNewAsk** (interface) `interface DraftNewAsk { name: string; body?: StoredBody; moves?: Moves; base?: number; note?: string; }`
- **DraftNewAnswer** (interface) `interface DraftNewAnswer { id: string; base: number; }`
- **DraftEditAsk** (interface) `interface DraftEditAsk { id: string; ops: unknown; }`
- **DraftEditAnswer** (interface) `interface DraftEditAnswer { id: string; lines: string[]; warnings: string[]; }`
- **DraftPlanAnswer** (interface) `interface DraftPlanAnswer { id: string; base: number; live: number; moved: boolean; conflicts: string[]; lines: string[]; }`
- **DraftUpdateAsk** (interface) `interface DraftUpdateAsk { id: string; body: StoredBody; moves?: Moves; note?: string; }`
- **DraftUpdateAnswer** (interface) `interface DraftUpdateAnswer { id: string; updatedAt: string; }`
- **DraftIdAsk** (interface) `interface DraftIdAsk { id: string; }`
- **DraftDropAsk** (interface) `interface DraftDropAsk { id: string; reason: string; }`
- **DraftStateAnswer** (interface) `interface DraftStateAnswer { id: string; state: DraftState; }`
- **DraftApplyAnswer** (interface) `interface DraftApplyAnswer { id: string; version: number; }`
- **DiffAsk** (interface) `interface DiffAsk { a: ShapeRef; b: ShapeRef; }`
- **ChangeLine** (interface) `interface ChangeLine { key: string; line: string; }`
- **DiffAnswer** (interface) `interface DiffAnswer { a: ShapeRef; b: ShapeRef; diff: StoredDiff; changes: ChangeLine[]; views: [MetroBody, MetroBody] | null; marks: MetroDiff | null; }`
- **PreviewAnswer** (interface) `interface PreviewAnswer { a: number | null; diff: StoredDiff; changes: ChangeLine[]; views: [MetroBody, MetroBody] | null; marks: MetroDiff | null; note: string | null; moves: Moves | null; }`
- **BlameAsk** (interface) `interface BlameAsk { node?: string; edge?: string; station?: string; track?: string; line?: string; group?: string; }`
- **BlameAnswer** (interface) `interface BlameAnswer { lines: BlameLine[]; }`
- **UndoAsk** (interface) `interface UndoAsk { a: number; b: number; change: string; }`
- **UndoPreviewAnswer** (interface) `interface UndoPreviewAnswer { line: string; note: string; newest: number; diff: StoredDiff; changes: ChangeLine[]; views: [MetroBody, MetroBody] | null; marks: MetroDiff | null; }`
- **UndoAnswer** (interface) `interface UndoAnswer { version: number; }`
- **AttachAsk** (interface) `interface AttachAsk { on: "line" | "station" | "group"; id: string; add?: Attach; remove?: string; }`
- **AttachAnswer** (interface) `interface AttachAnswer { version: number; }`
- **TagAsk** (interface) `interface TagAsk { name: string; version: number; note?: string; }`
- **TagAnswer** (interface) `interface TagAnswer { name: string; version: number; }`

## packages/pipeline/src/icp.ts

- **Fit** (interface) `interface Fit { score: number; reasons: string[]; unknown: string[]; }`
- **FitModel** (interface) `interface FitModel { complete( prompt: string, opts?: { system?: string; maxTokens?: number }, ): Promise<{ text: string }>; }`
- **FitTraits** (interface) `interface FitTraits { roles?: readonly string[]; industries?: readonly string[]; size?: number | string | null; regions?: readonly string[]; about?: readonly string[]; }`

## packages/pipeline/src/journeys.ts

- **instanceSubject** (function) `(j: Pick<Instance, "id" | "subjectKind" | "profileId" | "documentId">): Subject`
- **personOf** (function) `(db: Queryable, data: Record<string, unknown>): Promise<number | null>`
- **versionOf** (function) `(db: Queryable, version: number): Promise<{ body: ShapeBody; depths: Record<string, number>; newest: number; } | null>`
- **shapeWorkflowsOf** (function) `(db: Queryable, scope: Scope, log: (msg: string) => void = console.warn): Promise<Workflow[]>`
- **soundShapes** (function) `(shapes: readonly Workflow[], base: readonly Workflow[], components: readonly Component[], log: (msg: string) => void = console.warn): Workflow[]`
- **dropJourney** (function) `(db: Queryable, p: { journey: string; reason: string; by?: string }): Promise<DropEmit | null>`
- **openJourney** (function) `(tx: Queryable, profile: number): Promise<Instance | null>`
- **openDocument** (function) `(tx: Queryable, document: number, version: number): Promise<Instance[]>`
- **bodyOf** (function) `(db: Queryable, version: number): Promise<ShapeBody | null>`
- **Subject** (type) `type Subject = { kind: "person"; profile: number } | { kind: "document"; document: number };`
- **textOf** (function) `(v: unknown): string | undefined`
- **ownerOf** (function) `(v: unknown): string | null`

## packages/pipeline/src/lines.ts

- **linePass** (function) `(db: Db, now: Date, limit = 200): Promise<LinePass>`

## packages/pipeline/src/map-read.ts

- **mapAnswerOf** (function) `(db: Queryable, window: MapWindow): Promise<MapAnswer>`
- **MAP_WINDOWS** (const) `readonly ["all", "7", "30", "90"]`
- **MapWindow** (type) `type MapWindow = (typeof MAP_WINDOWS)[number];`
- **MapPerson** (interface) `interface MapPerson { id: string; name: string; node: string; nodeName: string; movedAt: string | null; daysAtNode: number; }`
- **MapAnswer** (interface) `interface MapAnswer { shape: { body: ShapeBody; depths: Record<string, number>; metro: MetroBody | null; drawErrors: string[]; versions: VersionLine[]; } | null; numbers: NumberRow[]; people: MapPerson[]; ghosts: MapPerson[]; }`

## packages/pipeline/src/metro-blame.ts

- **historyOfMetro** (function) `(versions: readonly MetroBlameVersion[], id: string, on: MetroOn): BlameLine[]`
- **MetroBlameVersion** (interface) `interface MetroBlameVersion { number: number; body: MetroBody; note: string; createdBy: string; createdAt: Date | string; }`

## packages/pipeline/src/metro-diff.ts

- **howOf** (function) `(on: MetroOn, was: Item | undefined, now: Item | undefined): How[]`
- **diffMetro** (function) `(a: MetroBody, b: MetroBody): MetroDiff`
- **metroChangesOf** (function) `(d: MetroDiff): MetroChange[]`
- **parseMetroChangeKey** (function) `(key: string): MetroChange | null`
- **metroNameOf** (function) `(bodies: readonly MetroBody[], on: MetroOn, id: string): string`
- **metroChangeLine** (function) `(a: MetroBody, b: MetroBody, c: MetroChange): string`
- **METRO_ONS** (const) `readonly ["line", "station", "track", "group", "frame", "flow"]`
- **MetroOn** (type) `type MetroOn = (typeof METRO_ONS)[number];`
- **METRO_LISTS** (const) `{ readonly line: "lines"; readonly station: "stations"; readonly track: "tracks"; readonly group: "groups"; readonly frame: "frames"; readonly flow: "flows"; }`
- **isNamed** (function) `(on: MetroOn): on is (typeof NAMED_ONS)[number]`
- **itemsOf** (function) `(body: MetroBody, on: MetroOn): Item[]`
- **MetroPart** (interface) `interface MetroPart { added: string[]; removed: string[]; renamed: Array<{ id: string; from: string; to: string }>; changed: string[]; }`
- **MetroDiff** (interface) `interface MetroDiff { lines: MetroPart; stations: MetroPart; tracks: MetroPart; groups: MetroPart; frames: MetroPart; flows: MetroPart; name: { from: string; to: string } | null; }`
- **How** (interface) `interface How { how: "added" | "removed" | "renamed" | "changed"; from?: string; to?: string; }`
- **MetroChange** (type) `type MetroChange = | { on: "name" } | { on: "line" | "station" | "group" | "flow"; id: string; how: "added" | "removed" | "renamed" | "changed"; } | { on: "track" | "frame"; id: string; how: "added" | "removed" | "changed" };`
- **metroChangeKey** (function) `(c: MetroChange): string`
- **METRO_WORD** (const) `Record<MetroOn, string>`
- **metroChangeLines** (function) `(a: MetroBody, b: MetroBody, diff: MetroDiff): string[]`

## packages/pipeline/src/metro-edit.ts

- **withoutStation** (function) `(body: MetroBody, id: string): MetroBody`
- **undoMetroChange** (function) `(newest: MetroBody, a: MetroBody, b: MetroBody, change: MetroChange): MetroBody`

## packages/pipeline/src/metro-file.ts

- **exportMetro** (function) `(body: MetroBody): string`
- **parseMetroBody** (function) `(doc: unknown): MetroBody`
- **FIRST** (const) `string[]`
- **ordered** (function) `(o: Record<string, unknown>): Record<string, unknown>`

## packages/pipeline/src/metro-merge.ts

- **mergeMetro** (function) `(base: MetroBody, live: MetroBody, draft: MetroBody): { body: MetroBody; conflicts: Conflict[] }`
- **conflictLine** (function) `(c: Conflict, names: readonly MetroBody[]): string`
- **Conflict** (interface) `interface Conflict { key: string; field?: string; base: unknown; live: unknown; draft: unknown; }`

## packages/pipeline/src/metro-ops.ts

- **opsJsonSchema** (function) `(): Record<string, unknown>`
- **parseOps** (function) `(v: unknown): MetroOp[]`
- **applyOp** (function) `(body: MetroBody, op: MetroOp): MetroBody`
- **applyOps** (function) `(body: MetroBody, ops: readonly MetroOp[]): MetroBody`
- **editMetro** (function) `(body: StoredBody, ops: unknown, ctx?: ShapeCheckContext): { body: MetroBody; lines: string[]; warnings: string[] }`
- **MetroOp** (type) `type MetroOp = | { op: "add"; on: "line"; item: MetroLine } | { op: "add"; on: "station"; item: MetroStation } | { op: "add"; on: "track"; item: MetroTrack } | { op: "add"; on: "group"; item: MetroGroup } | { op: "rename"; on: "line" | "station" | "group"; id: string; label: string } | { op: "rename"; on: "shape"; name: string } | { op: "move"; on: "station"; id: string; line?: string; column?: Column; group?: string | null } | { op: "move"; on: "track"; id: string; from?: string; to?: string } | { op: "move"; on: "group"; id: string; line: string } | { op: "move"; on: "line"; id: string; before: string | null } | { op: "remove"; on: OpOn; id: string } | { op: "set"; on: OpOn; id: string; field: string; value: unknown } | { op: "attach"; on: "line" | "station" | "group"; id: string; ref: Attach } | { op: "detach"; on: "line" | "station" | "group"; id: string; ref: string };`
- **MetroOpSchema** (const) `z.ZodDiscriminatedUnion<[z.ZodObject<{ op: z.ZodLiteral<"add">; on: z.ZodEnum<{ group: "group"; line: "line"; station: "station"; track: "track"; }>; item: z.ZodRecord<z.ZodString, z.ZodUnknown>; }, z.core.$strict>, z.ZodObject<{ op: z.ZodLiteral<"rename">; on: z.ZodEnum<{ group: "group"; line: "lin…`

## packages/pipeline/src/metro-parts.ts

- **readPart** (function) `(body: MetroBody, part: Part): PartRead | null`
- **partsOf** (function) `(text: string | null | undefined): Part[]`
- **PART_KINDS** (const) `readonly ["line", "group", "station", "flow"]`
- **Part** (interface) `interface Part { kind: PartKind; id: string; }`
- **partsParam** (function) `(parts: readonly Part[]): string`
- **MAP_VIEW_RECORD** (const) `"map"`

## packages/pipeline/src/metro.ts

- **checkMetro** (function) `(body: MetroBody, ctx: ShapeCheckContext): string[]`
- **placesOf** (function) `(body: MetroBody): Record<string, number>`
- **HUB** (const) `"hub"`
- **COLUMNS** (const) `readonly ["marketing", "sales", "delivery", "money"]`
- **Column** (type) `type Column = (typeof COLUMNS)[number];`
- **STATION_KINDS** (const) `readonly ["att", "time", "cash", "exit", "hub", "condition", "race", "split", "join", "ab", "approval", "link", "find", "read", "extract", "call", "measure"]`
- **StationKind** (type) `type StationKind = (typeof STATION_KINDS)[number];`
- **ContentKind** (type) `type ContentKind = (typeof CONTENT_KINDS)[number];`
- **isContentKind** (function) `(k: string): k is ContentKind`
- **LOGIC_KINDS** (const) `readonly ["condition", "race", "split", "join", "ab", "approval", "link"]`
- **TRACK_KINDS** (const) `readonly ["exit", "xfer", "back"]`
- **DURATION** (const) `RegExp`
- **ATTACH_KINDS** (const) `readonly ["sop", "link", "page", "funnel", "doc", "template", "note"]`
- **ATTACH_REF_MAX** (const) `500`
- **ATTACH_LABEL_MAX** (const) `80`
- **Attach** (interface) `interface Attach { kind: AttachKind; ref: string; label?: string; }`
- **MetroLine** (interface) `interface MetroLine { id: string; label: string; tier: Tier; offer?: string; colour?: number; entry?: LineEntry; planned?: true; attach?: Attach[]; }`
- **MetroStation** (interface) `interface MetroStation { id: string; label: string; kind: StationKind; line?: string; column: Column; action?: Action; advance?: Advance[]; research?: Research; idleDays?: number; deal?: true; terms?: string; offer?: string; failure?: true; rule?: string; flow?: string; sop?: string; study?: string; retries?: number; template?: string; platform?: string; planned?: true; attach?: Attach[]; }`
- **MetroTrack** (interface) `interface MetroTrack { id: string; from: string; to: string; line?: string; kind?: TrackKind; by: TrackBy; owner?: string; promise?: string; entries?: string[]; cond?: string; else?: true; wait?: string; weight?: number; label?: string; planned?: true; }`
- **MetroGroup** (interface) `interface MetroGroup { id: string; label: string; line?: string; stations: string[]; parent?: string; attach?: Attach[]; }`
- **MetroBody** (interface) `interface MetroBody { model: "metro"; name: string; lines: MetroLine[]; stations: MetroStation[]; tracks: MetroTrack[]; groups: MetroGroup[]; frames: MetroFrame[]; flows?: MetroFlow[]; }`
- **MetroFlow** (interface) `interface MetroFlow { id: string; label: string; stations: MetroStation[]; tracks: MetroTrack[]; }`
- **isMetro** (function) `(body: unknown): body is MetroBody`
- **kindOfAction** (function) `(action: Action): "att" | "time"`

## packages/pipeline/src/mirror.ts

- **mirrorShapes** (function) `(db: Queryable, o: { files: GithubFiles | null; repo: string; workspace: string; log?: (line: string) => void; }): Promise<MirrorResult>`
- **mirrorsOf** (function) `(db: Queryable): Promise<ShapeMirror[]>`
- **WREN_WORKSPACE** (const) `"wren"`
- **MirrorResult** (type) `type MirrorResult = | { off: true } | { off?: undefined; committed: MirrorCommit[]; failed?: string };`

## packages/pipeline/src/model.ts

- **checkShape** (function) `(next: ShapeBody, ctx: ShapeCheckContext): string[]`
- **checkEntry** (function) `(who: string, e: EntryFields, ctx: ShapeCheckContext, errors: string[], vias: readonly Via[] = VIAS): void`
- **cycleOf** (function) `(ids: readonly string[], pairs: readonly (readonly [string, string])[]): string[] | null`
- **depthOf** (function) `(body: ShapeBody): Record<string, number>`
- **pathOf** (function) `(body: ShapeBody, from: string, to: string, opts: { loops?: boolean } = {}): string[] | null`
- **passedThrough** (function) `(body: ShapeBody, edges: readonly string[]): string[]`
- **Advance** (interface) `interface Advance { trigger: string; with?: Record<string, string | number>; }`
- **IDLE_DAYS_MAX** (const) `365`
- **RESEARCH_LEVELS** (const) `readonly ["none", "light", "full"]`
- **Research** (type) `type Research = (typeof RESEARCH_LEVELS)[number];`
- **ACTIONS** (const) `readonly ["comment", "reply", "dm", "email", "text", "call", "cta", "visit", "form", "book", "held", "proposal", "signed", "other"]`
- **Action** (type) `type Action = (typeof ACTIONS)[number];`
- **VIAS** (const) `readonly ["organic", "outbound", "ads", "referral", "sourced", "group", "manual", "found"]`
- **Via** (type) `type Via = (typeof VIAS)[number];`
- **PEOPLE_VIAS** (const) `readonly Via[]`
- **SUBJECT_KINDS** (const) `readonly ["person", "document"]`
- **SubjectKind** (type) `type SubjectKind = (typeof SUBJECT_KINDS)[number];`
- **JOBS** (const) `readonly ["read", "extract", "call", "measure"]`
- **Job** (type) `type Job = (typeof JOBS)[number];`
- **NodeKind** (type) `type NodeKind = (typeof NODE_KINDS)[number];`
- **SourceNode** (interface) `interface SourceNode extends NodeBase { kind: "source"; via: Via; channel?: string; campaign?: string; source?: string; group?: string; sop?: string; study?: string; parked?: true; }`
- **StepNode** (interface) `interface StepNode extends NodeBase { kind: "step"; action: Action; advance: Advance[]; research?: Research; idleDays?: number; }`
- **OfferNode** (interface) `interface OfferNode extends NodeBase { kind: "offer"; offer: string; advance: Advance[]; research?: Research; idleDays?: number; }`
- **PlanNode** (interface) `interface PlanNode extends NodeBase { kind: "plan"; terms: string; advance: Advance[]; idleDays?: number; }`
- **JobNode** (interface) `interface JobNode extends NodeBase { kind: "job"; job: Job; advance: Advance[]; idleDays?: number; }`
- **ShapeNode** (type) `type ShapeNode = SourceNode | StepNode | OfferNode | PlanNode | JobNode;`
- **HoldNode** (type) `type HoldNode = StepNode | OfferNode | PlanNode | JobNode;`
- **ShapeEdge** (interface) `interface ShapeEdge { id: string; from: string; to: string; kind: EdgeKind; label?: string; }`
- **ShapeBody** (interface) `interface ShapeBody { name: string; nodes: ShapeNode[]; edges: ShapeEdge[]; }`
- **Crossing** (interface) `interface Crossing { edge: string | null; from: string | null; to: string; at: string; }`
- **STAGE_KEY** (const) `RegExp`
- **NODE_ID_MAX** (const) `40`
- **EDGE_ID_MAX** (const) `number`
- **DROPPED** (const) `"dropped"`
- **ShapeCheckContext** (interface) `interface ShapeCheckContext { triggers: ReadonlySet<string>; group(id: string): { active: boolean } | undefined; source(id: string): { exists: true } | undefined; }`
- **edgeIdOf** (function) `(from: string, to: string): string`
- **isSource** (function) `(n: ShapeNode): n is SourceNode`
- **subjectKindOf** (function) `(n: ShapeNode): SubjectKind`
- **holds** (function) `(n: ShapeNode): n is HoldNode`
- **nodeOf** (function) `(body: ShapeBody, id: string): ShapeNode | undefined`
- **flowEdgesFrom** (function) `(body: ShapeBody, id: string): ShapeEdge[]`
- **isEnd** (function) `(body: ShapeBody, id: string): boolean`
- **edgesOf** (function) `(body: ShapeBody, ids: readonly string[]): ShapeEdge[]`

## packages/pipeline/src/moves.ts

- **idOf** (function) `(id: string, what: "journey" | "deal"): string`
- **personByKey** (function) `(db: Queryable, key: string): Promise<number | null>`
- **openEmit** (function) `(db: Queryable, p: { person: string; at?: string; entry?: string; by: string; now?: Date }): Promise<Emit>`
- **moveEmit** (function) `(db: Queryable, p: { journey: string; to: string; by: string; reason?: string; now?: Date }): Promise<Emit & { journey: Instance }>`
- **assignJourney** (function) `(db: Queryable, main: Queryable, p: { client?: string | null; journey: string; to: string | null }): Promise<{ journey: string; owner: string | null }>`
- **rebuildJourney** (function) `(db: Queryable, id: string): Promise<Rebuilt>`
- **signDeal** (function) `(db: Queryable, p: { deal: string; plan: string; force?: boolean; now?: Date }): Promise<{ deal: string; termsVersion: number; changed: boolean }>`
- **Emit** (interface) `interface Emit { workflow: string; from: string; events: ExecutorEvent[]; }`
- **isRowId** (function) `(id: string): boolean`
- **subjectOf** (function) `(journey: string): string`
- **Rebuilt** (interface) `interface Rebuilt { before: RebuiltFields; after: RebuiltFields; changed: boolean; }`

## packages/pipeline/src/numbers.ts

- **rangeOf** (function) `(f: NumbersFilter): { from?: string; to?: string }`
- **nodeCountsOf** (function) `(db: Queryable, f: NumbersFilter = {}): Promise<{ version: number | null; node: string | null; day: string | null; arrived: number | null; skipped: number | null; left: number | null; }[]>`
- **edgeFlowOf** (function) `(db: Queryable, f: NumbersFilter = {}): Promise<{ version: number | null; edge: string | null; fromNode: string | null; toNode: string | null; day: string | null; crossings: number | null; }[]>`
- **moveFlowOf** (function) `(db: Queryable, f: NumbersFilter = {}): Promise<{ version: number | null; fromNode: string | null; toNode: string | null; day: string | null; moves: number | null; skips: number | null; loops: number | null; }[]>`
- **sourceNumbersOf** (function) `(db: Queryable, f: NumbersFilter = {}): Promise<{ source: string | null; day: string | null; opened: number | null; deals: number | null; collectedCents: number | null; cost: number | null; replied: number | null; booked: number | null; }[]>`
- **openNowOf** (function) `(db: Queryable): Promise<Map<string, number>>`
- **leadsOf** (function) `(db: Queryable): Promise<number>`
- **planNumbersOf** (function) `(db: Queryable, body: ShapeBody, f: NumbersFilter = {}): Promise<PlanNumber[]>`
- **metroRowsOf** (function) `(metro: MetroBody, graph: readonly NumberRow[], offers: readonly OfferNumber[], f: NumbersFilter = {}, leads: number | null = null): NumberRow[]`
- **numberRows** (function) `(db: Queryable, f: NumbersFilter = {}): Promise<NumberRow[]>`
- **dealScheduleOf** (function) `(db: Queryable, id: string): Promise<{ signed: boolean; lines: ({ kind: "setup"; on: string; cents: number; currency: string; part?: { n: number; of: number; }; } | { kind: "monthly"; on: string; cents: number; currency: string; } | { kind: "unit"; on: null; centsEach: number; unit: string | null; capCents: number | null; curre…`
- **NumberWindow** (type) `type NumberWindow = 7 | 30 | 90 | "all";`
- **OfferNumber** (interface) `interface OfferNumber { offer: string; currency: string; deals: number; signed: number; collectedCents: number; scheduledCents: number; }`
- **NumberRow** (interface) `interface NumberRow { id: string; kind: NumberKind; label: string; name: string; position: number; nodeKind: string | null; arrived: number | null; skipped: number | null; left: number | null; now: number | null; medianDays: number | null; reach: number | null; steps: number | null; mark: "optional" | "express" | null; crossings: number | null; from: string | null; to: string | null; opened: number | null; replied: number | null; booked: number | null; deals: number | null; collected: number | null; scheduled: number | null; cost: number | null; currency: string | null; last: string | null; }`

## packages/pipeline/src/records.ts

- **offerRows** (function) `(db: Queryable, o: { now?: Date } = {}): Promise<{ id: string; name: string; status: "retired" | "paused" | "draft" | "live"; version: number; audience: string; promise: string; live_plans: number; open_journeys: number; hash: string; synced_at: Date; synced_by: string; why: string; }[]>`
- **readTerms** (function) `(t: Terms): string`
- **shapeRows** (function) `(db: Queryable): Promise<{ id: string; name: string; version: number; nodes: number; edges: number; open_journeys: number; why: string; changed_at: Date; changed_by: string; }[]>`
- **draftRows** (function) `(db: Queryable): Promise<{ id: string; name: string; state: "proposed" | "dropped" | "applied" | "draft"; base: number; note: string; created_by: string; created_at: Date; updated_at: Date; applied_version: number | null; decided_by: string | null; decided_at: Date | null; drop_reason: string | null; }[]>`
- **trailOf** (function) `(db: Queryable, id: string): Promise<{ at: Date; workflow: string; node: string; cause: string | null; ref: string | null; }[]>`
- **shapeDetail** (function) `(db: Queryable): Promise<{ body: ShapeBody; depths: Record<string, number>; metro: import("./metro.js").MetroBody | null; drawErrors: string[]; places: Record<string, number> | null; versions: VersionLine[]; } | null>`
- **journeyRows** (function) `(db: Queryable, o: { id?: string; now?: Date } = {}): Promise<{ id: string; name: string; profile: number; email: string; version: number; node: string; node_name: string; trail: string; status: "open" | "dropped" | "done"; flag: string | null; ghost: string | null; entry: string; owner: string | null; days_at_node: number; reason: string | null; opene…`
- **dealRows** (function) `(db: Queryable, o: { id?: string } = {}): Promise<{ id: string; journey: string; name: string; profile: number; node: string | null; entry: string; offer: string; offer_version: number; plan: string | null; terms_number: number | null; status: "open" | "won" | "ended" | "lost"; collected: number; scheduled: number | null; currency: string; …`
- **entryRows** (function) `(db: Queryable): Promise<{ id: string; name: string; via: "ads" | "group" | "manual" | "referral" | "outbound" | "found" | "organic" | "sourced"; channel: string | null; campaign: string | null; parked: string | null; open_journeys: number; journeys: number; last_arrival: Date | null; }[]>`
- **OFFER_RECORD** (const) `"pipeline.offer"`
- **SHAPE_RECORD** (const) `"pipeline.shape"`
- **SHAPE_DRAFT_RECORD** (const) `"pipeline.shape_draft"`
- **JOURNEY_RECORD** (const) `"pipeline.journey"`
- **DEAL_RECORD** (const) `"pipeline.deal"`
- **NUMBER_RECORD** (const) `"pipeline.number"`
- **TERMS_RECORD** (const) `"pipeline.terms"`
- **ENTRY_RECORD** (const) `"pipeline.entry"`
- **STALE_DAYS** (const) `14`
- **shapeRecord** (function) `(): RecordType`
- **journeyRecord** (function) `(): RecordType`
- **entryRecord** (function) `(): RecordType`
- **PIPELINE_RECORDS** (const) `readonly RecordType[]`

## packages/pipeline/src/refused.ts

- **Refused** (class) `constructor(readonly errors: string[])`

## packages/pipeline/src/research.ts

- **icpOf** (function) `(db: Queryable, offer: string): Promise<Icp | null>`
- **requestResearch** (function) `(db: Db, researcher: Researcher, ask: ResearchAsk, now: Date): Promise<"light" | "full" | "none">`
- **refineFit** (function) `(db: Db, model: FitModel, ask: Pick<ResearchAsk, "journey" | "stage">, icp: Icp, traits: FitTraits): Promise<Fit | null>`
- **ResearchAsk** (interface) `interface ResearchAsk { client: string | null; profile: number; journey: string; stage: string; level: ResearchLevel; offer: string; icp: Icp | null; }`
- **Started** (interface) `interface Started { state: "started" | "skipped"; lookupId?: number; note?: string; }`
- **Researcher** (interface) `interface Researcher { light(db: Queryable, ask: ResearchAsk): Promise<LightRead>; full(ask: ResearchAsk): Promise<Started>; model?: FitModel | null; }`

## packages/pipeline/src/restate.ts

- **makeJourneys** (function) `(deps: JourneysDeps): restate.ServiceDefinition<"Journeys", { open: (ctx: restate.Context, req: OpenRequest) => Promise<{ journey: string; node: string; }>; move: (ctx: restate.Context, req: MoveRequest) => Promise<{ journey: string; from: string; to: string; status: "open" | "dropped" | "done"; }>; drop: (ctx: restate.C…`
- **JOURNEYS** (const) `{ readonly name: "Journeys"; }`
- **OpenRequest** (interface) `interface OpenRequest { client?: string | null; person: string; at?: string; entry?: string; by: string; }`
- **MoveRequest** (interface) `interface MoveRequest { client?: string | null; journey: string; to: string; by: string; reason?: string; }`
- **DropRequest** (interface) `interface DropRequest { client?: string | null; journey: string; reason: string; by: string; }`
- **AssignRequest** (interface) `interface AssignRequest { client?: string | null; journey: string; to?: string | null; by: string; }`
- **RebuildRequest** (interface) `interface RebuildRequest { client?: string | null; journey: string; }`
- **JourneysApi** (type) `type JourneysApi = { open: (ctx: restate.Context, req: OpenRequest) => Promise<{ journey: string; node: string }>; move: ( ctx: restate.Context, req: MoveRequest, ) => Promise<{ journey: string; from: string; to: string; status: string }>; drop: (ctx: restate.Context, req: DropRequest) => Promise<{ journey: string; node: string }>; assign: ( ctx: restate.Context, req: AssignRequest, ) => Promise<{ journey: string; owner: string | null }>; rebuild: (ctx: restate.Context, req: RebuildRequest) => Promise<unknown>; };`
- **JourneysService** (type) `type JourneysService = ReturnType<typeof makeJourneys>;`

## packages/pipeline/src/schedule.ts

- **scheduleOf** (function) `(terms: Terms, signedAt: Date | string, until?: Date | string): ScheduleLine[]`

## packages/pipeline/src/schema.ts

- **pipeline** (const) `import("drizzle-orm/pg-core").PgSchema<"pipeline">`
- **FUNNEL_STATUSES** (const) `readonly ["live", "off"]`
- **FunnelStatus** (type) `type FunnelStatus = (typeof FUNNEL_STATUSES)[number];`
- **JOURNEY_STATUSES** (const) `readonly ["open", "done", "dropped"]`
- **JourneyStatus** (type) `type JourneyStatus = (typeof JOURNEY_STATUSES)[number];`
- **DEAL_STATUSES** (const) `readonly ["open", "won", "lost", "ended"]`
- **DealStatus** (type) `type DealStatus = (typeof DEAL_STATUSES)[number];`
- **offerVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "offer_versions"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "offer_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tr…`
- **OfferVersion** (type) `type OfferVersion = typeof offerVersions.$inferSelect;`
- **termsVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "terms_versions"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "terms_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tr…`
- **TermsVersion** (type) `type TermsVersion = typeof termsVersions.$inferSelect;`
- **funnels** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "funnels"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "funnels"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimar…`
- **Funnel** (type) `type Funnel = typeof funnels.$inferSelect;`
- **funnelVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "funnel_versions"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "funnel_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: …`
- **FunnelVersion** (type) `type FunnelVersion = typeof funnelVersions.$inferSelect;`
- **shapeVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "shape_versions"; schema: "pipeline"; columns: { number: import("drizzle-orm/pg-core").PgColumn<{ name: "number"; tableName: "shape_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: tr…`
- **ShapeVersion** (type) `type ShapeVersion = typeof shapeVersions.$inferSelect;`
- **shapeDrafts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "shape_drafts"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "shape_drafts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false…`
- **ShapeDraft** (type) `type ShapeDraft = typeof shapeDrafts.$inferSelect;`
- **shapeTags** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "shape_tags"; schema: "pipeline"; columns: { name: import("drizzle-orm/pg-core").PgColumn<{ name: "name"; tableName: "shape_tags"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; i…`
- **ShapeTag** (type) `type ShapeTag = typeof shapeTags.$inferSelect;`
- **shapeMirrors** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "shape_mirrors"; schema: "pipeline"; columns: { version: import("drizzle-orm/pg-core").PgColumn<{ name: "version"; tableName: "shape_mirrors"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: tr…`
- **ShapeMirror** (type) `type ShapeMirror = typeof shapeMirrors.$inferSelect;`
- **instances** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "instances"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "instances"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimar…`
- **Instance** (type) `type Instance = typeof instances.$inferSelect;`
- **isPerson** (const) `import("drizzle-orm").SQL<unknown>`
- **pipelineDeals** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "deals"; schema: "pipeline"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "deals"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: fa…`
- **PipelineDeal** (type) `type PipelineDeal = typeof pipelineDeals.$inferSelect;`
- **RESEARCH_STATES** (const) `readonly ["queued", "started", "read", "skipped"]`
- **ResearchState** (type) `type ResearchState = (typeof RESEARCH_STATES)[number];`
- **journeyResearch** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "journey_research"; schema: "pipeline"; columns: { journey: import("drizzle-orm/pg-core").PgColumn<{ name: "journey"; tableName: "journey_research"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; ha…`
- **JourneyResearch** (type) `type JourneyResearch = typeof journeyResearch.$inferSelect;`

## packages/pipeline/src/shape-file.ts

- **exportShape** (function) `(body: StoredBody): string`
- **parseShape** (function) `(text: string): ShapeFile`
- **importShape** (function) `(db: Queryable, text: string, o: { by: string; triggers: ReadonlySet<string>; note?: string }): Promise<Imported>`
- **ShapeFile** (interface) `interface ShapeFile { body: MetroBody; note?: string; moves?: Moves; terms?: TermsEntry[]; }`
- **Imported** (interface) `interface Imported { shape: ShapeVersion | null; terms: TermsVersion[]; }`

## packages/pipeline/src/sourced.ts

- **liveSources** (function) `(db: Db): Promise<string[]>`
- **sourcedPass** (function) `(db: Db, client: string | null, cursors: SourceCursors, now: Date, limit = 200): Promise<SourcedPass>`
- **SourceCursors** (type) `type SourceCursors = Record<string, number>;`

## packages/pipeline/src/starter.ts

- **startShape** (function) `(db: Queryable, o: { by: string; triggers: ReadonlySet<string> }): Promise<ShapeVersion | null>`
- **STARTER_NOTE** (const) `"Starter"`
- **starterShape** (function) `(): ShapeFile`

## packages/pipeline/src/steps.ts

- **causeOf** (function) `(e: ExecutorEvent, now: Date): Cause`
- **factsOf** (function) `(data: Record<string, unknown>): CauseFacts`
- **journeySteps** (function) `(d: JourneyStepDeps): Record<string, Step>`

## packages/pipeline/src/store.ts

- **syncOffers** (function) `(db: Queryable, offers: readonly Offer[], by: string): Promise<OfferSync>`
- **offerVersionsOf** (function) `(db: Queryable, offer: string): Promise<OfferVersion[]>`
- **newestOffers** (function) `(db: Queryable): Promise<OfferVersion[]>`
- **addTerms** (function) `(db: Queryable, input: NewTerms): Promise<TermsVersion>`
- **liveTerms** (function) `(db: Queryable, offer: string, plan: string, at: string | Date): Promise<TermsVersion | null>`
- **termsHistory** (function) `(db: Queryable, offer: string, plan?: string): Promise<TermsVersion[]>`
- **shapeContext** (function) `(db: Queryable, triggers: ReadonlySet<string>): Promise<ShapeCheckContext>`
- **newestShape** (function) `(db: Queryable): Promise<ShapeVersion | null>`
- **shapeVersionsOf** (function) `(db: Queryable): Promise<ShapeVersion[]>`
- **saveShape** (function) `(db: Queryable, input: NewShape): Promise<ShapeVersion>`
- **lock** (function) `(tx: Tx, key: string): import("drizzle-orm/pg-core/query-builders/raw").PgRaw<import(".pnpm/postgres@3.4.9/node_modules/postgres").RowList<Record<string, unknown>[]>>`
- **hashOf** (function) `(v: unknown): string`
- **OfferSync** (interface) `interface OfferSync { added: { offer: string; number: number }[]; unchanged: number; }`
- **NewTerms** (interface) `interface NewTerms { offer: string; plan: string; from: string; body: Terms; why: string; by: string; }`
- **CONVERT_FIRST** (const) `"Convert first: wren shape convert."`

## packages/pipeline/src/stored.ts

- **metroView** (function) `(stored: StoredBody): MetroBody`
- **drawnOf** (function) `(stored: StoredBody): { ok: true; metro: MetroBody } | { ok: false; errors: string[] }`
- **checkStored** (function) `(stored: StoredBody, ctx: ShapeCheckContext): string[]`
- **diffStored** (function) `(a: StoredBody, b: StoredBody): StoredDiff`
- **storedChangeLine** (function) `(a: StoredBody, b: StoredBody, c: StoredChange): string`
- **diffAnswerOf** (function) `(a: StoredBody, b: StoredBody, onMetro = false): DiffParts`
- **historyOfStored** (function) `(versions: readonly StoredBlameVersion[], id: string, on: BlameOn = "node"): BlameLine[]`
- **StoredBody** (type) `type StoredBody = ShapeBody | MetroBody;`
- **runOf** (function) `(stored: StoredBody): ShapeBody`
- **sameStored** (function) `(a: StoredBody, b: StoredBody): boolean`
- **StoredDiff** (type) `type StoredDiff = { model: "graph"; diff: ShapeDiff } | { model: "metro"; diff: MetroDiff };`
- **StoredChange** (type) `type StoredChange = ShapeChange | MetroChange;`
- **storedChangesOf** (function) `(d: StoredDiff): StoredChange[]`
- **storedChangeKey** (function) `(c: StoredChange): string`
- **parseStoredChangeKey** (function) `(key: string): StoredChange | null`
- **storedChangeLines** (function) `(a: StoredBody, b: StoredBody, d: StoredDiff): string[]`
- **BlameOn** (type) `type BlameOn = "node" | "edge" | MetroOn;`

## packages/pipeline/src/tags.ts

- **addTag** (function) `(db: Queryable, input: { name: string; version: number; note?: string; by: string }): Promise<ShapeTag>`
- **tagsOf** (function) `(db: Queryable): Promise<ShapeTag[]>`

## packages/pipeline/src/undo.ts

- **planUndo** (function) `(db: Queryable, o: { a: number; b: number; change: string; triggers: ReadonlySet<string> }): Promise<UndoPlan>`
- **undoShape** (function) `(db: Queryable, o: { a: number; b: number; change: string; by: string; triggers: ReadonlySet<string> }): Promise<ShapeVersion>`

## packages/pipeline/src/views.ts

- **nodeCounts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"node_counts", false, { version: import("drizzle-orm/pg-core").PgColumn<{ name: "version"; tableName: "node_counts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimary…`
- **moveFlow** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"move_flow", false, { version: import("drizzle-orm/pg-core").PgColumn<{ name: "version"; tableName: "move_flow"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey:…`
- **edgeFlow** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"edge_flow", false, { version: import("drizzle-orm/pg-core").PgColumn<{ name: "version"; tableName: "edge_flow"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey:…`
- **sourceNumbers** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"source_numbers", false, { source: import("drizzle-orm/pg-core").PgColumn<{ name: "source"; tableName: "source_numbers"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **stageCounts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"stage_counts", false, { funnel: import("drizzle-orm/pg-core").PgColumn<{ name: "funnel"; tableName: "stage_counts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fals…`
- **stageFlow** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"stage_flow", false, { funnel: import("drizzle-orm/pg-core").PgColumn<{ name: "funnel"; tableName: "stage_flow"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; i…`
- **entryNumbers** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"entry_numbers", false, { funnel: import("drizzle-orm/pg-core").PgColumn<{ name: "funnel"; tableName: "entry_numbers"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fa…`

## packages/pipeline/src/workflow.ts

- **parseShapeFlow** (function) `(id: string): { version: number } | null`
- **shapeWorkflow** (function) `(versionNumber: number, body: ShapeBody, scope: Scope): Workflow`
- **MOVE_STEP** (const) `"journey.move"`
- **STAGE_STEP** (const) `"journey.stage"`
- **JOURNEY_PORT** (const) `"journey"`
- **Scope** (type) `type Scope = "wren" | "client";`
- **shapeFlowId** (function) `(version: number): string`

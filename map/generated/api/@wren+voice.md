# @wren/voice: interface

Exports: 137. Files: 26.

## packages/voice/src/agent.ts

- **AgentSettings** (type) `type AgentSettings = z.infer<typeof agentSettingsSchema>;`
- **TOOL_NAMES** (const) `readonly ["lookUpLead", "offerTimes", "book", "transfer", "takeMessage", "endCall"]`
- **ToolName** (type) `type ToolName = (typeof TOOL_NAMES)[number];`
- **VOICE_AGENT** (const) `"voice.agent"`
- **agentOf** (function) `(settings: unknown): AgentSettings`
- **agentSettingsSchema** (const) `z.ZodObject<{ name: z.ZodDefault<z.ZodString>; firstLine: z.ZodDefault<z.ZodString>; prompt: z.ZodDefault<z.ZodString>; voice: z.ZodDefault<z.ZodString>; tools: z.ZodDefault<z.ZodArray<z.ZodEnum<{ book: "book"; transfer: "transfer"; lookUpLead: "lookUpLead"; offerTimes: "offerTimes"; takeMessage: "t…`
- **inHours** (function) `(agent: AgentSettings, at: Date): boolean`
- **openingLine** (function) `(agent: AgentSettings, callerState: string | null = null): string`
- **stretchesOf** (function) `(text: string): [number, number][] | null`
- **systemOf** (function) `(agent: AgentSettings): string`

## packages/voice/src/brain.ts

- **promptOf** (function) `(input: BrainInput): { system: string; prompt: string }`
- **thoughtsOf** (function) `(text: string): Thought[]`

## packages/voice/src/call-now.ts

- **CallNowDeps** (interface) `interface CallNowDeps { db: Db; bookings: Pick<Bookings, "name" | "booked"> | null; dialer: Dialer | null; }`
- **Dialer** (interface) `interface Dialer { control: TelnyxControl; agent: AgentSettings; whose: string; from: string; streamUrl: string; connectionId: string; }`
- **callNow** (function) `(d: CallNowDeps, id: number, now: Date): Promise<CallNow>`
- **callNowStep** (function) `(depsFor: (client: string | null) => CallNowDeps | Promise<CallNowDeps>): Step`

## packages/voice/src/call.ts

- **CallResult** (interface) `interface CallResult { call: CallStart; pipeline: string; outcome: Outcome; lead: LeadContext | null; transcript: Line[]; turns: Turn[]; booking: { id: number; start: Date } | null; message: string | null; startedAt: Date; endedAt: Date; }`
- **Pipeline** (interface) `interface Pipeline { transport: Transport; ears?: Ears | null; brain: Brain; mouth?: Mouth | null; }`
- **STAGES** (const) `{ readonly final: "Words final"; readonly end: "Turn over"; readonly token: "First token"; readonly audio: "First audio out"; readonly heard: "Heard"; }`
- **Stage** (type) `type Stage = keyof typeof STAGES;`
- **Turn** (interface) `interface Turn { n: number; caller: string; agent: string; tools: string[]; speculative: boolean; barged: boolean; ms: Record<Stage, number | null>; }`
- **runCall** (function) `(o: CallOptions): Promise<CallResult>`

## packages/voice/src/components.ts

- **CALL_NOW** (const) `"voice.call_now"`
- **VOICE_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/voice/src/consent.ts

- **DialRefused** (class) `constructor(readonly verdict: Extract<DialVerdict, { ok: false }>)`
- **consentFor** (function) `(db: Queryable, e164: string, whose: string): Promise<PhoneConsent | null>`
- **mayDial** (function) `(db: Queryable, o: { to: string; agent: AgentSettings; whose: string; zone: string | null; now: Date }): Promise<DialVerdict>`
- **placeCall** (function) `(db: Db, control: TelnyxControl, o: { agent: AgentSettings; whose: string; from: string; to: string; zone: string | null; streamUrl: string; connectionId: string; now: Date; }): Promise<string>`

## packages/voice/src/console-routes.ts

- **VOICE_CONSOLE_APPS** (const) `{ readonly "*": { readonly app: "voice"; readonly channel: "phone"; }; }`
- **VOICE_CONSOLE_ROUTES** (const) `{ readonly saveTest: "wren:act"; readonly dictated: "wren:read"; readonly dictation: "wren:read"; }`
- **VOICE_CONSOLE_WRITES** (const) `readonly (keyof typeof VOICE_CONSOLE_ROUTES)[]`

## packages/voice/src/console.ts

- **TestCall** (type) `type TestCall = z.infer<typeof testCallSchema>;`
- **dictationApi** (function) `(deps: { db: Db }): { dictated: (req: DictatedRequest) => Promise<{ id: string; }>; dictation: (_req: PortalRequest) => Promise<{ rows: import("./dictation-store.js").DictationStat[]; }>; }`
- **makeVoiceConsole** (function) `(deps: { db: Db }): restate.ServiceDefinition<"VoiceConsole", { saveTest: (ctx: restate.Context, req: SaveTestRequest) => Promise<{ id: number; }>; dictated: (ctx: restate.Context, req: DictatedRequest) => Promise<{ id: string; }>; dictation: (ctx: restate.Context, req: PortalRequest) => Promise<{ rows: import("./dicta…`

## packages/voice/src/dictation-store.ts

- **Dictated** (type) `type Dictated = z.infer<typeof dictatedSchema>;`
- **DictationStat** (interface) `interface DictationStat { adapter: string; stage: DictationStage; p50: number | null; p95: number | null; n: number; }`

## packages/voice/src/dictation/commands.ts

- **applyCommands** (function) `(text: string): string`

## packages/voice/src/dictation/ears.ts

- **TranscriberEars** (class) `readonly name: string;; constructor(private readonly model: Transcriber, private readonly o: TranscriberEarsOptions = {}); open(on: (h: Heard) => void): EarStream`

## packages/voice/src/dictation/route.ts

- **ADAPTERS** (const) `readonly ["browser", "server", "speech"]`
- **Adapter** (type) `type Adapter = (typeof ADAPTERS)[number];`
- **CHOICES** (const) `readonly ["auto", "browser", "server", "off"]`
- **Can** (interface) `interface Can { webgpu: boolean; server: boolean; speech: boolean; fallback: boolean; failed?: readonly Adapter[]; }`
- **Choice** (type) `type Choice = (typeof CHOICES)[number];`
- **Route** (type) `type Route = { adapter: Adapter; why: null } | { adapter: null; why: string };`
- **pickAdapter** (function) `(choice: Choice, can: Can): Route`

## packages/voice/src/dictation/session.ts

- **DICTATION_STAGES** (const) `{ readonly load: "Model load"; readonly mic: "Mic open"; readonly first: "Talk to first words"; readonly final: "Release to last words"; }`
- **DictationRun** (interface) `interface DictationRun { micMs: number | null; firstMs: number | null; finalMs: number | null; words: number; audioMs: number; }`
- **DictationStage** (type) `type DictationStage = keyof typeof DICTATION_STAGES;`
- **startDictation** (function) `(o: { ears: Ears; on: DictationEvents; now?: () => number; }): DictationSession`

## packages/voice/src/dictation/transcriber.ts

- **DICTATION_RATE** (const) `16000`
- **FakeTranscriber** (class) `readonly name; readonly model; readonly runs:; constructor(private readonly script: readonly string[], private readonly o: { ms?: number } = {}); transcribe(audio: Float32Array, o: { final: boolean }): Promise<string>`
- **Transcriber** (interface) `interface Transcriber { readonly name: string; readonly model: string; transcribe(audio: Float32Array, o: { final: boolean; signal?: AbortSignal }): Promise<string>; }`
- **levelOf** (function) `(samples: Float32Array): number`
- **openAiTranscriber** (function) `(o: { url: string; model: string; key?: string | undefined; fetch?: typeof fetch; language?: string; }): Transcriber`
- **pcmFrame** (function) `(samples: Float32Array, rate = DICTATION_RATE): Frame`
- **resample** (function) `(samples: Float32Array, from: number, to = DICTATION_RATE): Float32Array`
- **samplesOf** (function) `(frame: Frame): Float32Array`
- **samplesOfWav** (function) `(bytes: Uint8Array): Float32Array | null`
- **wavOf** (function) `(samples: Float32Array, rate = DICTATION_RATE): Uint8Array`

## packages/voice/src/fakes.ts

- **CallerLine** (interface) `interface CallerLine { say: string; over?: number; }`
- **FakeCalendar** (class) `readonly booked:; open({ now, max }: { now: Date; max: number }): Promise<Date[]>; book(o: { start: Date; name: string; email: string }): Promise<{ id: number; start: Date; }>`
- **FakeEars** (class) `readonly name; constructor(private readonly o: { finalMs?: number } = {}); open(on: (h: Heard) => void): { push: (frame: Frame) => void; close: () => void; }`
- **FakeLeads** (class) `constructor(private readonly leads: Readonly<Record<string, LeadContext>> = SAMPLE_LEADS); byPhone(e164: string): Promise<LeadContext | null>`
- **FakeMessages** (class) `readonly taken:; take(o: { call: CallStart; text: string; callback: string | null }): Promise<void>`
- **FakeMouth** (class) `readonly name; constructor(private readonly o: { firstMs?: number; wordMs?: number } = {}); speak(text: string, signal: AbortSignal): AsyncIterable<Frame>`
- **FakeTransport** (class) `readonly name; readonly carries; readonly endpointing; readonly heard: string[]; cleared; transferredTo: string | null; hungUp; constructor(private readonly script: readonly CallerLine[], private readonly o: { call?: Partial<CallStart>; playMs?: number; gapMs?: number; wordMs?: number; } = {}); open(on: (e: Incoming) => void): Promise<void>; send(out: Outgoing): void; clear(): void; transfer(to: string): Promise<void>; hangup(): Promise<void>; get talking(): boolean`
- **SAMPLE_LEADS** (const) `Readonly<Record<string, LeadContext>>`
- **ScriptedBrain** (class) `readonly name: string; constructor(private readonly o: { tokenMs?: number; firstMs?: number } = {}); think(input: BrainInput, signal: AbortSignal): AsyncIterable<Thought>; decide(input: BrainInput): { say: string; tool?: { name: string; args: Record<string, unknown> }; }`
- **fakePorts** (function) `(): { leads: FakeLeads; calendar: FakeCalendar; messages: FakeMessages; }`
- **transcriptText** (function) `(lines: readonly Line[]): string`
- **wordsOf** (function) `(f: Frame): string`

## packages/voice/src/ports.ts

- **CalendarDeps** (interface) `interface CalendarDeps { calendar: string; settings: () => Promise<unknown>; busy: (account: string, from: Date, to: Date) => Promise<Span[]>; }`
- **calendarIn** (function) `(db: Db, deps: CalendarDeps): VoiceCalendar`
- **leadsIn** (function) `(db: Db): LeadPort`
- **messagesOnCall** (const) `MessagePort`

## packages/voice/src/reading.ts

- **Speakers** (interface) `interface Speakers { play(frames: Frame[], signal: AbortSignal): Promise<void>; }`
- **pcm16** (function) `(audio: Float32Array, rate: number): Frame`
- **readAloud** (function) `(mouth: Mouth, speakers: Speakers, text: string, signal: AbortSignal, on: ReadOn = {}): Promise<void>`
- **readable** (function) `(text: string): string`
- **samples** (function) `(f: Frame): Float32Array`
- **sentencesOf** (function) `(text: string, max = 300): string[]`

## packages/voice/src/records.ts

- **CallDetail** (interface) `interface CallDetail { transcript: { who: string; text: string; tool?: string }[]; turns: { n: number; caller: string; agent: string; tools: string[]; speculative: boolean; barged: boolean; ms: Record<keyof typeof STAGES, number | null>; }[]; }`
- **VOICE_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **callRecord** (const) `import("@wren/core/records").RecordType`

## packages/voice/src/schema.ts

- **CONSENT_SOURCES** (const) `readonly ["form", "manual", "import"]`
- **ConsentSource** (type) `type ConsentSource = (typeof CONSENT_SOURCES)[number];`
- **PhoneConsent** (type) `type PhoneConsent = typeof phoneConsents.$inferSelect;`
- **VoiceCall** (type) `type VoiceCall = typeof voiceCalls.$inferSelect;`
- **phoneConsents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "phone_consents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "phone_consents"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **voiceCallRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"voice_call_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "voice_call_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPri…`
- **voiceCalls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "voice_calls"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "voice_calls"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **voiceLatency** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"voice_latency", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "voice_latency"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAuto…`
- **voiceTurns** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "voice_turns"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "voice_turns"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`

## packages/voice/src/sentences.ts

- **SentenceCutter** (class) `push(chunk: string): string[]; flush(): string | null`

## packages/voice/src/store.ts

- **saveCall** (function) `(db: Queryable, r: CallResult, o: { whose: string; by: string | null }): Promise<number>`

## packages/voice/src/tools.ts

- **Effect** (type) `type Effect = | { kind: "booked"; id: number; start: Date } | { kind: "transfer"; to: string } | { kind: "message"; text: string } | { kind: "lead"; lead: LeadContext } | { kind: "end" };`
- **LeadPort** (interface) `interface LeadPort { byPhone(e164: string): Promise<LeadContext | null>; }`
- **MessagePort** (interface) `interface MessagePort { take(o: { call: CallStart; lead: LeadContext | null; text: string; callback: string | null; }): Promise<void>; }`
- **TOOL_SPECS** (const) `Readonly<Record<ToolName, ToolSpec>>`
- **TimeTaken** (class) `constructor()`
- **ToolPorts** (interface) `interface ToolPorts { leads: LeadPort; calendar: VoiceCalendar; messages: MessagePort; }`
- **VoiceCalendar** (interface) `interface VoiceCalendar { open(o: { now: Date; max: number }): Promise<Date[]>; book(o: { start: Date; name: string; email: string; zone: string; now: Date }): Promise<{ id: number; start: Date; }>; }`
- **runTool** (function) `(name: string, args: Record<string, unknown>, ports: ToolPorts, ctx: ToolContext): Promise<ToolResult>`
- **spoken** (function) `(at: Date, zone: string): string`
- **toolsOf** (function) `(agent: AgentSettings): ToolSpec[]`

## packages/voice/src/transports/browser.ts

- **BrowserTransport** (class) `readonly name: string; readonly carries; readonly endpointing; constructor(private readonly call: CallStart, private readonly api: SpeechApi, private readonly callee: { said?(text: string, turn: number): void; ended(how: { transferredTo: string | null }): void; error?(why: string): void; }); open(on: (e: Incoming) => void): Promise<void>; send(out: Outgoing): void; clear(): void; leave(): void; transfer(to: string): Promise<void>; hangup(): Promise<void>`
- **SpeechApi** (interface) `interface SpeechApi { listen(on: { partial(text: string): void; final(text: string): void; stopped(): void; error(why: string): void; }): { stop(): void }; speak(text: string, on: { start(): void; end(): void }): void; cancel(): void; }`

## packages/voice/src/transports/telnyx.ts

- **MediaSocket** (interface) `interface MediaSocket { send(text: string): void; close(): void; onMessage(fn: (text: string) => void): void; onClose(fn: () => void): void; }`
- **TelnyxControl** (interface) `interface TelnyxControl { transfer(callControlId: string, to: string): Promise<void>; hangup(callControlId: string): Promise<void>; dial(o: { from: string; to: string; streamUrl: string; clientState: string; connectionId: string; }): Promise<string>; }`
- **TelnyxHttp** (class) `constructor(private readonly apiKey: string); transfer(id: string, to: string): Promise<void>; hangup(id: string): Promise<void>; dial(o: { from: string; to: string; streamUrl: string; clientState: string; connectionId: string; }): Promise<string>`
- **TelnyxTransport** (class) `readonly name: string; readonly carries; readonly endpointing; constructor(private readonly socket: MediaSocket, private readonly control: TelnyxControl, private readonly clock: () => number = () => performance.now()); open(on: (e: Incoming) => void): Promise<void>; send(out: Outgoing): void; clear(): void; transfer(to: string): Promise<void>; hangup(): Promise<void>`
- **clientStateOf** (function) `(o: { from: string; to: string; direction: Direction }): string`
- **incomingOf** (function) `(raw: string): Incoming[]`
- **muLaw** (function) `(sample: number): number`
- **muLawDecode** (function) `(byte: number): number`
- **toPcmu** (function) `(f: Frame): Uint8Array`

## packages/voice/src/transports/text.ts

- **TextTransport** (class) `readonly name: string; readonly carries; readonly endpointing; constructor(private readonly call: CallStart, private readonly callee: TextCallee); open(on: (e: Incoming) => void): Promise<void>; type(text: string): void; typing(): void; leave(): void; send(out: Outgoing): void; clear(): void; transfer(to: string): Promise<void>; hangup(): Promise<void>`

## packages/voice/src/types.ts

- **Brain** (interface) `interface Brain { readonly name: string; think(input: BrainInput, signal: AbortSignal): AsyncIterable<Thought>; }`
- **BrainInput** (interface) `interface BrainInput { system: string; lead: LeadContext | null; transcript: readonly Line[]; tools: readonly ToolSpec[]; }`
- **CallStart** (interface) `interface CallStart { id: string; from: string; to: string; direction: Direction; }`
- **DIRECTIONS** (const) `readonly ["inbound", "outbound", "test"]`
- **Direction** (type) `type Direction = (typeof DIRECTIONS)[number];`
- **EarStream** (interface) `interface EarStream { push(frame: Frame): void; close(): void; finish?(): Promise<void>; }`
- **Ears** (interface) `interface Ears { readonly name: string; open(on: (h: Heard) => void): EarStream; }`
- **Frame** (interface) `interface Frame { encoding: "pcmu" | "pcm16" | "fake"; rate: number; data: Uint8Array; }`
- **Heard** (type) `type Heard = | { kind: "speech" } | { kind: "partial"; text: string } | { kind: "final"; text: string } | { kind: "silence" };`
- **Hosted** (interface) `interface Hosted { readonly name: string; run(o: { agent: unknown; call: CallStart; signal: AbortSignal; }): Promise<{ transcript: Line[]; outcome: string; turnsMs: { heard: number | null }[] }>; }`
- **Incoming** (type) `type Incoming = | { kind: "start"; call: CallStart } | { kind: "audio"; frame: Frame } | { kind: "words"; text: string; final: boolean } | { kind: "key"; digit: string } | { kind: "played"; turn: number } | { kind: "idle" } | { kind: "hangup" };`
- **LeadContext** (interface) `interface LeadContext { name: string | null; company: string | null; email: string | null; zone: string | null; notes: string | null; }`
- **Line** (interface) `interface Line { who: "caller" | "agent" | "tool"; text: string; tool?: string; }`
- **Mouth** (interface) `interface Mouth { readonly name: string; speak(text: string, signal: AbortSignal): AsyncIterable<Frame>; }`
- **OUTCOMES** (const) `readonly ["booked", "transferred", "message", "ended", "hung_up", "timed_out", "failed"]`
- **Outcome** (type) `type Outcome = (typeof OUTCOMES)[number];`
- **Outgoing** (type) `type Outgoing = | { kind: "audio"; frame: Frame; turn: number } | { kind: "text"; text: string; turn: number };`
- **Thought** (type) `type Thought = | { kind: "text"; text: string } | { kind: "tool"; name: string; args: Record<string, unknown> };`
- **ToolSpec** (interface) `interface ToolSpec { name: string; says: string; args: Readonly<Record<string, string>>; }`
- **Transport** (interface) `interface Transport { readonly name: string; readonly carries: "audio" | "text"; readonly endpointing: "ours" | "theirs"; open(on: (e: Incoming) => void): Promise<void>; send(out: Outgoing): void; clear(): void; transfer(to: string): Promise<void>; hangup(): Promise<void>; }`

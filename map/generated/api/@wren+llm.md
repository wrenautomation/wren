# @wren/llm: interface

Exports: 44. Files: 11.

## node_modules/.pnpm/@wrenautomation+models@0.8.2/node_modules/@wrenautomation/models/dist/keys.d.ts

- **EnvMap** (type) `type EnvMap = Readonly<Record<string, string | undefined>>;`
- **fleetKeys** (function) `(env: EnvMap, vendor: string): string[]`

## node_modules/.pnpm/@wrenautomation+models@0.8.2/node_modules/@wrenautomation/models/dist/types.d.ts

- **Effort** (type) `type Effort = "low" | "medium" | "high" | "xhigh" | "max";`

## packages/llm/src/audit.ts

- **usageFromRaw** (function) `(raw: Raw): Usage | null`
- **finishReasonFromRaw** (function) `(raw: Raw): string | null`
- **providerFromModel** (function) `(model: string, raw: Raw): string`
- **callRecord** (function) `(raw: Raw, input: CallRecordInput): CallRecord`
- **recordFor** (function) `(llm: LlmClient, response: LlmResponse | null, opts: { runId: string | null; latencyMs?: number | null; rejected?: boolean }): CallRecord`
- **Usage** (interface) `interface Usage { input: number | null; output: number | null; total: number | null; reasoning: number | null; cache_read: number | null; cache_write: number | null; }`
- **CallRecord** (interface) `interface CallRecord { model: string; provider: string; usage: Usage | null; finish_reason: string | null; latency_ms: number | null; run_id: string | null; rejected: boolean; }`

## packages/llm/src/client.ts

- **modelLlm** (function) `(model: Model): LlmClient`
- **makeLlm** (function) `(name: string, env: EnvMap = process.env, opts: MakeLlmOptions = {}): LlmClient`
- **keyProvider** (function) `(raw: string): { provider: KeyProvider; key: string } | null`
- **llmForKey** (function) `(raw: string): LlmClient`
- **LlmResponse** (interface) `interface LlmResponse { text: string; raw: Record<string, unknown>; latencyMs: number | null; }`
- **CompleteOptions** (interface) `interface CompleteOptions { maxTokens?: number; effort?: Effort; system?: string; part?: string; }`
- **LlmClient** (interface) `interface LlmClient { readonly name: string; readonly provider: string; complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse>; }`
- **LlmError** (class) `override name; readonly status: number | null;; constructor(message: string, opts: { status?: number | null; cause?: unknown } = {})`
- **LlmInputRejected** (class) `override name`
- **FakeLlm** (class) `readonly name: string; readonly provider: string; constructor(opts: { respond?: FakeResponder; default?: string } = {}); complete(prompt: string, opts: CompleteOptions = {}): Promise<LlmResponse>`

## packages/llm/src/embed.ts

- **gatewayEmbed** (function) `(env: EnvMap, fetchFn: typeof fetch = fetch): Embed | null`
- **EMBED_DIMS** (const) `256`
- **Embed** (type) `type Embed = (texts: string[], task: EmbedTask) => Promise<number[][]>;`
- **cosine** (function) `(a: readonly number[], b: readonly number[]): number`

## packages/llm/src/env.ts

- **loadLlmEnv** (function) `(path = "llm.env", rootDir: string = process.cwd()): boolean`

## packages/llm/src/gateway.ts

- **gatewayGemini** (function) `(gateway: string, token: string, fetchFn: typeof fetch = fetch): typeof fetch`

## packages/llm/src/parsing.ts

- **firstJsonObject** (function) `(text: string): Record<string, unknown> | string`
- **parseModel** (function) `(text: string, schema: ZodType<T>): T | string`
- **NO_JSON_OBJECT** (const) `"no JSON object in response"`
- **wellFormed** (function) `(s: string): string`

## packages/llm/src/stage.ts

- **completeAndParse** (function) `(llm: LlmClient, prompt: string, schema: ZodType<T>, opts: StageOptions): Promise<Outcome<T>>`
- **Envelope** (interface) `interface Envelope { raw_text: string | null; parse_error: string | null; provider_rejected: string | null; api: Record<string, unknown> | null; call: CallRecord | null; [key: string]: unknown; }`
- **Outcome** (class) `constructor(readonly parsed: T | null, readonly parseError: string | null, readonly providerRejected: string | null, readonly rawText: string | null, readonly api: Record<string, unknown> | null, readonly call: CallRecord, readonly request: StageRequest | null = null); get ok(): boolean; envelope(payload: Record<string, unknown> = {}): Envelope`

## packages/llm/src/tracing.ts

- **bestEffortSpan** (function) `(tracer: Tracer, name: string, opts: SpanStart): Span`
- **makeTracer** (function) `(name: string): Tracer`
- **Span** (interface) `interface Span { end(outcome: Outcome<unknown>): void; fail(err: unknown): void; }`
- **SpanStart** (interface) `interface SpanStart { prompt: string; llm: LlmClient; metadata?: Record<string, unknown> | undefined; }`
- **Tracer** (interface) `interface Tracer { start(name: string, opts: SpanStart): Span; flush(): void | Promise<void>; }`
- **NULL_TRACER** (const) `NullTracer`
- **tracingLog** (const) `{ warn: (message: string) => void; }`
- **RecordingTracer** (class) `readonly spans: RecordedSpan[]; flushed; start(name: string, opts: SpanStart): RecordedSpan; flush(): void`

## packages/llm/src/usage.ts

- **observeUsage** (function) `(llm: L, o: { part: string; record: (r: UsageReport) => Promise<unknown> | unknown; warn?: (line: string) => void; }): L`
- **withPart** (function) `(llm: L, part: string): L`
- **UsageReport** (interface) `interface UsageReport { model: string; provider: string; part: string; usage: Usage; }`

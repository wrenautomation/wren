/**
 * LlmClient seam: completion behind an interface so the paid provider is swappable
 * and tests run on the fake. Every response returns WITH the provider body (`raw`,
 * persisted by the caller: a paid token is bought once) and the wall-clock latency,
 * which no provider body reports.
 *
 * Real providers ride the Vercel AI SDK: Anthropic natively, everything else through
 * the OpenAI-compatible provider. `name` records provider AND model
 * ("groq:openai/gpt-oss-120b") so enrichment provenance survives a provider swap;
 * `provider` names the vendor alone so usage can be summed per vendor.
 *
 * Keys travel in headers and never into error text.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, type LanguageModel, RetryError } from "ai";
import { ClaudeCodeLlm, DEFAULT_CLAUDE_CODE_MODEL } from "./claude-code.js";
import { wellFormed } from "./parsing.js";

export interface LlmResponse {
  text: string;
  /** The provider body (or our normalized summary of it), persisted by the caller. */
  raw: Record<string, unknown>;
  /** Wall-clock milliseconds for the round trip, measured by the adapter. */
  latencyMs: number | null;
}

export interface CompleteOptions {
  maxTokens?: number;
  /** The system prompt: the standing instructions, apart from this call's input. */
  system?: string;
}

export interface LlmClient {
  /** Recorded in enrichments.model ("groq:openai/gpt-oss-120b", "claude-haiku-4-5-20251001", "fake"). */
  readonly name: string;
  /** The vendor alone ("groq"), for per-vendor usage sums. */
  readonly provider: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse>;
}

const DEFAULT_MAX_TOKENS = 2048;

/**
 * API-level failure (bad key, quota, malformed response): the caller should stop
 * the run, not burn through the remaining list. `status` is the HTTP status when
 * the provider answered.
 */
export class LlmError extends Error {
  override name = "LlmError";
  readonly status: number | null;
  constructor(message: string, opts: { status?: number | null; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.status = opts.status ?? null;
  }
}

/**
 * The provider refused THIS input (HTTP 400/422: too long, filtered). A fact about
 * the document, not the provider: callers record it against the unit and continue.
 * Deliberately NOT a subclass of LlmError so a `catch LlmError` cannot swallow it.
 */
export class LlmInputRejected extends Error {
  override name = "LlmInputRejected";
}

const INPUT_REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 422]);

export type FakeResponder = (prompt: string, system?: string) => string | Promise<string>;

/**
 * Fixture-driven stub: answers from a callable or a fixed string. Outputs flow
 * through the same persistence path, marked model="fake".
 */
export class FakeLlm implements LlmClient {
  readonly name: string = "fake";
  readonly provider: string = "fake";
  private readonly respond: FakeResponder | undefined;
  private readonly fallback: string;
  constructor(opts: { respond?: FakeResponder; default?: string } = {}) {
    this.respond = opts.respond;
    this.fallback = opts.default ?? '{"people": []}';
  }
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<LlmResponse> {
    const text = this.respond ? await this.respond(prompt, opts.system) : this.fallback;
    return { text, raw: { fake: true }, latencyMs: 0 };
  }
}

/** Unwrap the AI SDK's retry wrapper so the status of the last attempt is visible. */
function rootCause(err: unknown): unknown {
  return RetryError.isInstance(err) ? err.lastError : err;
}

/**
 * One AI SDK language model as an LlmClient. `raw` is a normalized summary in
 * Anthropic's vocabulary (input_tokens/output_tokens/stop_reason) plus the response
 * ids, so audit reads it with the same code path as legacy rows.
 */
export class AiSdkLlm implements LlmClient {
  readonly name: string;
  constructor(
    readonly provider: string,
    readonly modelId: string,
    private readonly model: LanguageModel,
  ) {
    this.name = provider === "anthropic" ? modelId : `${provider}:${modelId}`;
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<LlmResponse> {
    const started = performance.now();
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: this.model,
        ...(opts.system ? { system: wellFormed(opts.system) } : {}),
        prompt: wellFormed(prompt),
        maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
    } catch (err) {
      const cause = rootCause(err);
      const status = APICallError.isInstance(cause) ? (cause.statusCode ?? null) : null;
      if (status !== null && INPUT_REJECTED_STATUSES.has(status))
        throw new LlmInputRejected(`HTTP ${status}`);
      const label = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      throw new LlmError(label, { status, cause });
    }
    const latencyMs = Math.round(performance.now() - started);
    const usage = result.usage;
    const raw: Record<string, unknown> = {
      provider: this.provider,
      model: this.modelId,
      stop_reason: result.rawFinishReason ?? result.finishReason,
      finish_reason_unified: result.finishReason,
      usage: {
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        reasoning_tokens: usage.outputTokenDetails?.reasoningTokens ?? null,
        cache_read_tokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
      },
      response: {
        id: result.response.id,
        model_id: result.response.modelId,
        timestamp: result.response.timestamp.toISOString(),
      },
      provider_metadata: result.providerMetadata ?? null,
      warnings: result.warnings ?? [],
    };
    if (!result.text) {
      throw new LlmError(`no text content in response (stop_reason=${result.finishReason})`);
    }
    return { text: result.text, raw, latencyMs };
  }
}

const ROTATE_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 429]);

/**
 * Round-robin over one client per API key (the llm.env key fleets). A key that
 * answers 401/402/403/429 hands the same prompt to the next key; only when every
 * key has failed does the error surface.
 */
export class RotatingLlm implements LlmClient {
  readonly name: string;
  readonly provider: string;
  private next = 0;
  constructor(private readonly clients: readonly LlmClient[]) {
    const first = clients[0];
    if (!first) throw new Error("RotatingLlm needs at least one client");
    this.name = first.name;
    this.provider = first.provider;
  }
  async complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse> {
    let lastError: LlmError | null = null;
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const client = this.clients[this.next % this.clients.length] as LlmClient;
      this.next = (this.next + 1) % this.clients.length;
      try {
        return await client.complete(prompt, opts);
      } catch (err) {
        if (err instanceof LlmError && err.status !== null && ROTATE_STATUSES.has(err.status)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError ?? new LlmError("no clients");
  }
}

/** OpenAI-compatible providers: base URL and the default model per vendor. */
export const COMPATIBLE_PROVIDERS = {
  groq: { baseURL: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemma-4-31b-it:free",
  },
  cohere: { baseURL: "https://api.cohere.ai/compatibility/v1", defaultModel: "command-a-03-2025" },
  mistral: { baseURL: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest" },
  cerebras: { baseURL: "https://api.cerebras.ai/v1", defaultModel: "gpt-oss-120b" },
} as const;
export type CompatibleProvider = keyof typeof COMPATIBLE_PROVIDERS;

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export type EnvMap = Readonly<Record<string, string | undefined>>;

/**
 * The provider's API keys from the environment, llm.env style: `NUM_<P>` plus
 * `<P>_API_KEY_1..N` (gaps tolerated), else a single `<P>_API_KEY`.
 */
export function fleetKeys(env: EnvMap, provider: string): string[] {
  const upper = provider.toUpperCase();
  const count = Number.parseInt(env[`NUM_${upper}`] ?? "0", 10);
  const keys: string[] = [];
  for (let n = 1; n <= count; n++) {
    const key = env[`${upper}_API_KEY_${n}`];
    if (key) keys.push(key);
  }
  const single = env[`${upper}_API_KEY`];
  if (!keys.length && single) keys.push(single);
  return keys;
}

export interface MakeLlmOptions {
  /** Anthropic model id; falls back to WREN_LLM_MODEL, then DEFAULT_ANTHROPIC_MODEL. */
  anthropicModel?: string | null;
}

/**
 * "fake" | "claude-code[:model]" | "anthropic[:model-id]" | "<provider>[:model-id]" for
 * provider in COMPATIBLE_PROVIDERS. The optional :model suffix picks a specific model
 * per run without touching config. claude-code needs no key: the Claude Code login pays.
 */
export function makeLlm(
  name: string,
  env: EnvMap = process.env,
  opts: MakeLlmOptions = {},
): LlmClient {
  if (name === "fake") return new FakeLlm();
  if (name === "claude-code" || name.startsWith("claude-code:"))
    return new ClaudeCodeLlm(name.slice("claude-code:".length) || DEFAULT_CLAUDE_CODE_MODEL);
  if (name === "anthropic" || name.startsWith("anthropic:")) {
    const apiKey = env.WREN_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("anthropic needs WREN_ANTHROPIC_API_KEY in the environment");
    const modelId =
      name.slice("anthropic:".length) ||
      (opts.anthropicModel ?? env.WREN_LLM_MODEL ?? DEFAULT_ANTHROPIC_MODEL);
    return new AiSdkLlm("anthropic", modelId, createAnthropic({ apiKey })(modelId));
  }
  const [provider, ...rest] = name.split(":");
  const spec = COMPATIBLE_PROVIDERS[provider as CompatibleProvider];
  if (!provider || !spec) {
    const expected = Object.keys(COMPATIBLE_PROVIDERS)
      .map((p) => `${p}[:model]`)
      .join(", ");
    throw new Error(`unknown llm '${name}'; expected 'fake', 'anthropic', or one of: ${expected}`);
  }
  const modelId = rest.join(":") || spec.defaultModel;
  const keys = fleetKeys(env, provider);
  if (!keys.length) {
    const upper = provider.toUpperCase();
    throw new Error(
      `no API keys for ${provider}: set NUM_${upper} + ${upper}_API_KEY_N in llm.env, or ${upper}_API_KEY`,
    );
  }
  const clients = keys.map(
    (apiKey) =>
      new AiSdkLlm(
        provider,
        modelId,
        createOpenAICompatible({ name: provider, baseURL: spec.baseURL, apiKey })(modelId),
      ),
  );
  return clients.length === 1 ? (clients[0] as LlmClient) : new RotatingLlm(clients);
}

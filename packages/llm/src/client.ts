/**
 * LlmClient seam: completion behind an interface so the paid provider is swappable
 * and tests run on the fake. Every response returns WITH the provider body (`raw`,
 * persisted by the caller: a paid token is bought once) and the wall-clock latency,
 * which no provider body reports.
 *
 * Real providers are `@wrenautomation/models` models; `modelLlm` adapts one. `name`
 * records provider AND model ("groq:openai/gpt-oss-120b") so enrichment provenance
 * survives a provider swap; `provider` names the vendor alone so usage can be summed
 * per vendor.
 *
 * Keys travel in headers and never into error text.
 */
import {
  anthropic,
  COMPATIBLE,
  type CompatibleVendor,
  cohere,
  compatible,
  type Effort,
  type EnvMap,
  fleetKeys,
  gateway,
  isCompatible,
  isCut,
  isFiltered,
  isInputRejected,
  type Model,
  type RotateOptions,
  rotating,
  type Usage,
} from "@wrenautomation/models";
import { claudeCode } from "@wrenautomation/models/command";

export { type Effort, type EnvMap, fleetKeys };

export interface LlmResponse {
  text: string;
  /** The provider body (or our normalized summary of it), persisted by the caller. */
  raw: Record<string, unknown>;
  /** Wall-clock milliseconds for the round trip, measured by the adapter. */
  latencyMs: number | null;
}

export interface CompleteOptions {
  maxTokens?: number;
  /**
   * Anthropic only. A Claude 5 model thinks adaptively and counts that inside `maxTokens`; the
   * model's default is medium. `low` for a fill or a triage, `high` for a long draft.
   */
  effort?: Effort;
  /** The system prompt: the standing instructions, apart from this call's input. */
  system?: string;
  /**
   * The part asking ("watch.triage", "drafts"): read by the usage meter (`observeUsage`) so a
   * response lands on its part's line. No provider sees it.
   */
  part?: string;
}

export interface LlmClient {
  /** Recorded in enrichments.model ("groq:openai/gpt-oss-120b", "claude-haiku-5-5", "fake"). */
  readonly name: string;
  /** The vendor alone ("groq"), for per-vendor usage sums. */
  readonly provider: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse>;
}

/**
 * The least any call may answer in. A budget is a ceiling against a runaway answer, never the
 * length: the prompt says how long ("at most 4 sentences"), and a lower cap only cuts it off.
 */
const DEFAULT_MAX_TOKENS = 2048;
/** Three tries a call: a busy answer (429, 5xx) waits 2 s, then 4 s, as the SDK's own retries did. */
const RETRY: RotateOptions = { passes: 3 };

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
 * The provider refused THIS input (HTTP 400/413/422: too long, filtered). A fact about
 * the document, not the provider: callers record it against the unit and continue.
 * Deliberately NOT a subclass of LlmError so a `catch LlmError` cannot swallow it.
 */
export class LlmInputRejected extends Error {
  override name = "LlmInputRejected";
}

type FakeResponder = (prompt: string, system?: string) => string | Promise<string>;

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `raw` in Anthropic's vocabulary (input_tokens/output_tokens/stop_reason), so audit reads every
 * provider with one code path. The model's own body stays beside it; `cost` is its priced USD.
 */
function rawOf(
  m: Model,
  r: { stop?: string | undefined; usage: Usage; raw?: unknown },
): Record<string, unknown> {
  const body = isRecord(r.raw) ? r.raw : {};
  const tokens = isRecord(body.usage) ? body.usage : {};
  const u = r.usage;
  return {
    ...body,
    provider: m.provider,
    model: body.model ?? m.id,
    stop_reason: r.stop ?? null,
    usage: {
      reasoning_tokens: null,
      ...tokens,
      input_tokens: u.input ?? null,
      output_tokens: u.output ?? null,
      cache_read_tokens: u.cacheRead ?? tokens.cache_read_tokens ?? null,
      cache_write_tokens: u.cacheWrite ?? tokens.cache_write_tokens ?? null,
    },
    cost: { usd: u.usd ?? null, free: u.free ?? false, list_usd: u.listUsd ?? null },
  };
}

/**
 * One model as an LlmClient. A cut or filtered answer keeps its text, as before: the parse step
 * says what is missing, and an empty one is an LlmError. A refused input is LlmInputRejected;
 * every other failure is an LlmError with the HTTP status when there was one.
 */
export function modelLlm(model: Model): LlmClient {
  return {
    name: model.id,
    provider: model.provider,
    async complete(prompt, opts = {}) {
      const started = performance.now();
      try {
        const reply = await model.complete({
          prompt,
          maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(opts.system ? { system: opts.system } : {}),
          ...(opts.effort ? { effort: opts.effort } : {}),
          ...(opts.part ? { purpose: opts.part } : {}),
        });
        return { text: reply.text, raw: rawOf(model, reply), latencyMs: reply.ms };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - started);
        if (isCut(err) && err.partial)
          return {
            text: err.partial,
            raw: rawOf(model, { stop: "length", usage: err.usage ?? {} }),
            latencyMs,
          };
        if (isFiltered(err) && err.partial)
          return {
            text: err.partial,
            raw: rawOf(model, { stop: err.stop, usage: err.usage ?? {} }),
            latencyMs,
          };
        if (isInputRejected(err)) throw new LlmInputRejected(err.message);
        const status = isRecord(err) && typeof err.status === "number" ? err.status : null;
        throw new LlmError(err instanceof Error ? err.message : String(err), {
          status,
          cause: err,
        });
      }
    },
  };
}

interface MakeLlmOptions {
  /** Anthropic model id or short name; falls back to WREN_LLM_MODEL, then Haiku 5.5. */
  anthropicModel?: string | null;
  /** The wire, for a test. */
  fetch?: typeof fetch;
}

/** Vendors on a key ring: Cohere natively, the rest OpenAI-compatible. */
type RingVendor = CompatibleVendor | "cohere";
const RING_VENDORS: readonly RingVendor[] = [
  "cohere",
  ...(Object.keys(COMPATIBLE) as CompatibleVendor[]),
];

/** The vendor's model on `keys`, `model` or the vendor's default. */
function ringModel(
  vendor: RingVendor,
  keys: string | readonly string[],
  model: string,
  wire: { fetch?: typeof fetch },
): Model {
  const o = { key: keys, rotate: RETRY, ...(model ? { model } : {}), ...wire };
  return vendor === "cohere" ? cohere(o) : compatible(vendor, o);
}

/**
 * "fake" | "claude-code[:model]" | "anthropic[:haiku|sonnet|opus|model-id]" | "gateway[:model]" |
 * "cohere[:model]" | "<vendor>[:model-id]" for a vendor in models' COMPATIBLE. The optional
 * :model suffix picks a specific model per run without touching config. anthropic is Wren's own
 * key on the current Claude models (default Haiku 5.5): `anthropic:sonnet` for a draft,
 * `anthropic` for a fill. claude-code needs no key: the Claude Code login pays. gateway is
 * llm.wrenautomation.com, which holds every free key and shares one ledger across processes; its
 * model is an alias ("free", "cohere") or "<provider>/<model>".
 */
export function makeLlm(
  name: string,
  env: EnvMap = process.env,
  opts: MakeLlmOptions = {},
): LlmClient {
  if (name === "fake") return new FakeLlm();
  const [vendor = "", ...rest] = name.split(":");
  const model = rest.join(":");
  const wire = opts.fetch ? { fetch: opts.fetch } : {};
  if (vendor === "claude-code") return modelLlm(claudeCode(model || "sonnet"));
  if (vendor === "anthropic") {
    const key = env.WREN_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("anthropic needs WREN_ANTHROPIC_API_KEY in the environment");
    const chosen = model || opts.anthropicModel || env.WREN_LLM_MODEL || "haiku";
    return modelLlm(anthropic({ key, model: chosen, rotate: RETRY, ...wire }));
  }
  if (vendor === "gateway") {
    const url = env.WREN_LLM_GATEWAY_URL;
    const token = env.WREN_LLM_GATEWAY_TOKEN;
    if (!url || !token)
      throw new Error(
        "gateway needs WREN_LLM_GATEWAY_URL and WREN_LLM_GATEWAY_TOKEN in the environment",
      );
    return modelLlm(rotating([gateway({ url, token, model: model || "free", ...wire })], RETRY));
  }
  if (vendor !== "cohere" && !isCompatible(vendor)) {
    const expected = RING_VENDORS.map((p) => `${p}[:model]`).join(", ");
    throw new Error(
      `unknown llm '${name}'; expected 'fake', 'claude-code', 'anthropic', 'gateway', or one of: ${expected}`,
    );
  }
  const keys = fleetKeys(env, vendor);
  if (!keys.length) {
    const upper = vendor.toUpperCase();
    throw new Error(
      `no API keys for ${vendor}: set NUM_${upper} + ${upper}_API_KEY_N in llm.env, or ${upper}_API_KEY`,
    );
  }
  return modelLlm(ringModel(vendor, keys, model, wire));
}

/** Providers a client's own model key may be for: the store keeps one key, `MODEL_API_KEY`. */
type KeyProvider = RingVendor | "anthropic";
const KEY_PROVIDERS: readonly KeyProvider[] = ["anthropic", ...RING_VENDORS];

/** Each provider's key prefix, most specific first. Cohere and Mistral keys have none. */
const KEY_PREFIXES: readonly (readonly [string, KeyProvider])[] = [
  ["sk-ant-", "anthropic"],
  ["sk-or-", "openrouter"],
  ["gsk_", "groq"],
  ["csk-", "cerebras"],
  ["sk-", "openai"],
];

/**
 * Which provider a client's model key is for, and the key alone: `<provider>:<key>` names it
 * (Cohere, Mistral, or any), else the key's prefix tells. Null: it can't be told. Never says
 * the key.
 */
export function keyProvider(raw: string): { provider: KeyProvider; key: string } | null {
  const v = raw.trim();
  const i = v.indexOf(":");
  if (i > 0) {
    const named = v.slice(0, i).toLowerCase() as KeyProvider;
    if (KEY_PROVIDERS.includes(named)) return { provider: named, key: v.slice(i + 1).trim() };
  }
  const hit = KEY_PREFIXES.find(([p]) => v.startsWith(p));
  return hit ? { provider: hit[1], key: v } : null;
}

/**
 * A client's own model key as a client, straight to its provider (no gateway), on that
 * provider's default model. Refuses a key it can't place, without saying the key.
 */
export function llmForKey(raw: string): LlmClient {
  const p = keyProvider(raw);
  if (!p?.key)
    throw new LlmError(
      "Can't tell which provider this model key is for. Save it as provider:key (cohere:..., mistral:...).",
    );
  if (p.provider === "anthropic") return modelLlm(anthropic({ key: p.key, rotate: RETRY }));
  return modelLlm(ringModel(p.provider, p.key, "", {}));
}

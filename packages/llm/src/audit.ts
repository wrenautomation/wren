/**
 * The normalized per-call audit record. Every provider reports usage in its own
 * shape (OpenAI-compatible: prompt_tokens/completion_tokens; Anthropic and our AI
 * SDK adapter: input_tokens/output_tokens; the fake: nothing). `callRecord` is the
 * one translation, applied at write time by stage.ts; the `email_llm_calls` view
 * reads only this record. The raw body is still stored beside it, untouched.
 */
import type { LlmClient, LlmResponse } from "./client.js";

export interface Usage {
  input: number | null;
  output: number | null;
  total: number | null;
  /** Hidden-thinking share of `output` on reasoning models; null when not broken out. */
  reasoning: number | null;
}

/** Stored as enrichments.output.call (snake_case: read by SQL views). */
export interface CallRecord {
  model: string;
  provider: string;
  usage: Usage | null;
  finish_reason: string | null;
  latency_ms: number | null;
  run_id: string | null;
  rejected: boolean;
}

type Raw = Record<string, unknown> | null | undefined;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Token counts in one vocabulary, or null when the body carries none. */
export function usageFromRaw(raw: Raw): Usage | null {
  const usage = rec(raw?.usage);
  if (!usage) return null;
  let input: number | null;
  let output: number | null;
  let total: number | null;
  let reasoning: number | null;
  if ("prompt_tokens" in usage || "completion_tokens" in usage) {
    const details = rec(usage.completion_tokens_details);
    input = num(usage.prompt_tokens);
    output = num(usage.completion_tokens);
    total = num(usage.total_tokens);
    reasoning = details ? num(details.reasoning_tokens) : null;
  } else if ("input_tokens" in usage || "output_tokens" in usage) {
    input = num(usage.input_tokens);
    output = num(usage.output_tokens);
    total = null;
    reasoning = num(usage.reasoning_tokens);
  } else {
    return null;
  }
  if (total === null && input !== null && output !== null) total = input + output;
  return { input, output, total, reasoning };
}

/** Why generation stopped, in the provider's own word ("stop", "length", "end_turn", ...). */
export function finishReasonFromRaw(raw: Raw): string | null {
  if (!raw) return null;
  const choices = raw.choices;
  if (Array.isArray(choices) && choices.length) {
    const first = rec(choices[0]);
    if (first) return typeof first.finish_reason === "string" ? first.finish_reason : null;
  }
  return typeof raw.stop_reason === "string" ? raw.stop_reason : null;
}

/**
 * Vendor name for a row written before clients carried `provider`:
 * "groq:openai/gpt-oss-120b" -> "groq"; "fake" -> "fake"; a bare model id is Anthropic's.
 */
export function providerFromModel(model: string, raw: Raw): string {
  if (model.includes(":")) return model.split(":")[0] as string;
  if (model === "fake" || raw?.fake) return "fake";
  return "anthropic";
}

export interface CallRecordInput {
  model: string;
  provider: string;
  latencyMs: number | null;
  runId: string | null;
  /** An HTTP 400/422 refusal of this input: a real round trip with no body worth summarizing. */
  rejected?: boolean;
}

export function callRecord(raw: Raw, input: CallRecordInput): CallRecord {
  return {
    model: input.model,
    provider: input.provider,
    usage: usageFromRaw(raw),
    finish_reason: finishReasonFromRaw(raw),
    latency_ms: input.latencyMs,
    run_id: input.runId,
    rejected: input.rejected ?? false,
  };
}

/** `callRecord` from a live client + response (the write-time path). */
export function recordFor(
  llm: LlmClient,
  response: LlmResponse | null,
  opts: { runId: string | null; latencyMs?: number | null; rejected?: boolean },
): CallRecord {
  return callRecord(response?.raw ?? null, {
    model: llm.name,
    provider: llm.provider,
    latencyMs: response ? response.latencyMs : (opts.latencyMs ?? null),
    runId: opts.runId,
    rejected: opts.rejected ?? false,
  });
}

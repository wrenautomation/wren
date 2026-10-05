/**
 * One LLM step, the same way everywhere: complete, parse, and package the outcome
 * for persistence.
 * - A parse failure is an outcome of the unit (parse_error set, parsed null); the
 *   cache treats it as retryable.
 * - An input rejection (HTTP 400/422) is a terminal outcome of the unit.
 * - Any other LlmError propagates: provider failure aborts the run; the loop that
 *   owns the checkpoint decides that.
 */
import type { ZodType } from "zod";
import { type CallRecord, recordFor } from "./audit.js";
import { type LlmClient, LlmInputRejected, type LlmResponse } from "./client.js";
import { parseModel } from "./parsing.js";
import { bestEffortSpan, NULL_TRACER, type Tracer } from "./tracing.js";

/** The uniform audit keys every LLM stage stores (snake_case: read by SQL views). */
export interface Envelope {
  raw_text: string | null;
  parse_error: string | null;
  provider_rejected: string | null;
  api: Record<string, unknown> | null;
  call: CallRecord | null;
  [key: string]: unknown;
}

/** What one completion produced, in the vocabulary the enrichment envelope stores. */
export class Outcome<T> {
  constructor(
    readonly parsed: T | null,
    readonly parseError: string | null,
    readonly providerRejected: string | null,
    readonly rawText: string | null,
    readonly api: Record<string, unknown> | null,
    readonly call: CallRecord,
  ) {}
  get ok(): boolean {
    return this.parsed !== null;
  }
  /** The stored output: the uniform audit keys plus the stage's own payload. */
  envelope(payload: Record<string, unknown> = {}): Envelope {
    return {
      raw_text: this.rawText,
      parse_error: this.parseError,
      provider_rejected: this.providerRejected,
      api: this.api,
      call: this.call,
      ...payload,
    };
  }
}

export interface StageOptions {
  maxTokens: number;
  system?: string;
  runId?: string | null;
  tracer?: Tracer | null;
  /** Labels the span (a stage's EnrichmentKind). */
  name?: string;
  metadata?: Record<string, unknown>;
}

/** Ask, then read the answer as `schema`. Throws LlmError (provider failure) and nothing else. */
export async function completeAndParse<T>(
  llm: LlmClient,
  prompt: string,
  schema: ZodType<T>,
  opts: StageOptions,
): Promise<Outcome<T>> {
  const runId = opts.runId ?? null;
  const span = bestEffortSpan(opts.tracer ?? NULL_TRACER, opts.name ?? "completion", {
    prompt,
    llm,
    metadata: opts.metadata,
  });
  let response: LlmResponse;
  try {
    response = await llm.complete(prompt, {
      maxTokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
    });
  } catch (err) {
    if (err instanceof LlmInputRejected) {
      const rejection = new Outcome<T>(
        null,
        null,
        err.message,
        null,
        null,
        recordFor(llm, null, { runId, rejected: true }),
      );
      span.end(rejection);
      return rejection;
    }
    span.fail(err);
    throw err;
  }
  const parsed = parseModel(response.text, schema);
  const failed = typeof parsed === "string";
  const outcome = new Outcome<T>(
    failed ? null : parsed,
    failed ? parsed : null,
    null,
    response.text,
    response.raw,
    recordFor(llm, response, { runId }),
  );
  span.end(outcome);
  return outcome;
}

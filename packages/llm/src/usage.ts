/**
 * Usage at the client seam: wrap a client once and every response reports its token counts, so a
 * caller that drops the response's record (the Monitor, drafts) is still counted. The seam knows
 * no database: the worker hands it the recorder (`meterTokens` in @wren/core).
 */
import { type Usage, usageFromRaw } from "./audit.js";
import type { CompleteOptions, LlmClient, LlmResponse } from "./client.js";

export interface UsageReport {
  /** The client's model (`LlmClient.name`): "claude-sonnet-5-5". */
  model: string;
  provider: string;
  /** The part that asked: the call's `opts.part`, else the wrapper's default. */
  part: string;
  usage: Usage;
}

/**
 * The client, reporting each response's usage to `record`. A response with no usage reports
 * nothing. A recorder that throws or rejects is logged and the response goes on: metering never
 * fails the model call. `record` runs before the response returns, so a Restate step holding
 * the call journals the write with it.
 */
export function observeUsage<L extends LlmClient>(
  llm: L,
  o: {
    /** The part for a call that names none. */
    part: string;
    record: (r: UsageReport) => Promise<unknown> | unknown;
    warn?: (line: string) => void;
  },
): L {
  const warn = o.warn ?? console.warn;
  const wrapped = Object.create(llm) as L;
  wrapped.complete = async (prompt: string, opts?: CompleteOptions): Promise<LlmResponse> => {
    const res = await llm.complete(prompt, opts);
    const usage = usageFromRaw(res.raw);
    if (usage) {
      try {
        await o.record({
          model: llm.name,
          provider: llm.provider,
          part: opts?.part ?? o.part,
          usage,
        });
      } catch (err) {
        warn(
          `usage: ${llm.provider} ${llm.name} not metered: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return res;
  };
  return wrapped;
}

/** The client, its calls naming `part` unless they name their own. */
export function withPart<L extends LlmClient>(llm: L, part: string): L {
  const wrapped = Object.create(llm) as L;
  wrapped.complete = (prompt: string, opts?: CompleteOptions) =>
    llm.complete(prompt, { ...opts, part: opts?.part ?? part });
  return wrapped;
}

/**
 * Tracing seam for LLM calls: a two-phase span, a null default, and an in-memory
 * recorder for tests. The span opens BEFORE the provider call (the timing is the
 * point) and closes exactly once, with the Outcome or with the provider error.
 *
 * Best-effort, always: an observability backend must never abort a run whose tokens
 * have already been bought. `bestEffortSpan` turns any tracer failure into one
 * warning line and continues as if the tracer were the null one.
 */
import type { LlmClient } from "./client.js";
import type { Outcome } from "./stage.js";

export interface Span {
  /** The call came back: parsed, unparseable, or input-rejected. */
  end(outcome: Outcome<unknown>): void;
  /** The provider failed; `err` is on its way up to the loop. */
  fail(err: unknown): void;
}

export interface SpanStart {
  prompt: string;
  llm: LlmClient;
  /** Whatever identifies the unit: a document id, a company domain. */
  metadata?: Record<string, unknown> | undefined;
}

export interface Tracer {
  start(name: string, opts: SpanStart): Span;
  flush(): void | Promise<void>;
}

export class NullSpan implements Span {
  end(_outcome: Outcome<unknown>): void {}
  fail(_err: unknown): void {}
}
export const NULL_SPAN = new NullSpan();

export class NullTracer implements Tracer {
  start(_name: string, _opts: SpanStart): Span {
    return NULL_SPAN;
  }
  flush(): void {}
}
export const NULL_TRACER = new NullTracer();

/** Where best-effort failures go; tests replace `warn`. One line, no stack. */
export const tracingLog = {
  warn: (message: string): void => {
    console.warn(message);
  },
};

const warn = (where: string, err: unknown): void => {
  const text = err instanceof Error ? err.message : String(err);
  tracingLog.warn(`tracing failed (${where}): ${text}`);
};

class SafeSpan implements Span {
  constructor(private readonly span: Span) {}
  end(outcome: Outcome<unknown>): void {
    try {
      this.span.end(outcome);
    } catch (err) {
      warn("end", err);
    }
  }
  fail(err: unknown): void {
    try {
      this.span.fail(err);
    } catch (tracingErr) {
      warn("fail", tracingErr);
    }
  }
}

/** `tracer.start`, guarded: a backend that is down yields the null span instead of raising. */
export function bestEffortSpan(tracer: Tracer, name: string, opts: SpanStart): Span {
  let span: Span;
  try {
    span = tracer.start(name, opts);
  } catch (err) {
    warn("start", err);
    return NULL_SPAN;
  }
  return new SafeSpan(span);
}

export class RecordedSpan implements Span {
  outcome: Outcome<unknown> | null = null;
  error: unknown = null;
  constructor(
    readonly name: string,
    readonly prompt: string,
    readonly llmName: string,
    readonly provider: string,
    readonly metadata: Record<string, unknown> | undefined,
  ) {}
  end(outcome: Outcome<unknown>): void {
    this.outcome = outcome;
  }
  fail(err: unknown): void {
    this.error = err;
  }
}

/** In-memory Tracer for tests: what was asked, of whom, and how each call ended. */
export class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  flushed = 0;
  start(name: string, opts: SpanStart): RecordedSpan {
    const span = new RecordedSpan(
      name,
      opts.prompt,
      opts.llm.name,
      opts.llm.provider,
      opts.metadata,
    );
    this.spans.push(span);
    return span;
  }
  flush(): void {
    this.flushed++;
  }
}

export const TRACING_BACKENDS = ["none"] as const;

/** `WREN_TRACING` -> a Tracer, or a loud error at startup (before any run row opens). */
export function makeTracer(name: string): Tracer {
  if (name === "none") return NULL_TRACER;
  throw new Error(`unknown tracing '${name}'; expected one of: ${TRACING_BACKENDS.join(", ")}`);
}

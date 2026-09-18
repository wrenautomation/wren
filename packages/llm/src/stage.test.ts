import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLlm, type LlmClient, LlmError, LlmInputRejected, type LlmResponse } from "./client.js";
import { completeAndParse, type Outcome } from "./stage.js";
import { RecordingTracer, type Span, type SpanStart, type Tracer, tracingLog } from "./tracing.js";

const Answer = z.object({ items: z.array(z.string()).default([]) });
const RUN_ID = "0b6b1c1e-4d0a-4d6e-9a3a-6b0b8b4f8d10";

class Failing implements LlmClient {
  readonly name = "fake";
  readonly provider = "fake";
  constructor(private readonly err: Error) {}
  async complete(): Promise<LlmResponse> {
    throw this.err;
  }
}

class Slow implements LlmClient {
  readonly name = "fake";
  readonly provider = "fake";
  async complete(): Promise<LlmResponse> {
    return { text: '{"items": []}', raw: { fake: true }, latencyMs: 77 };
  }
}

describe("completeAndParse", () => {
  it("success carries parsed, raw and the call record", async () => {
    const out = await completeAndParse(new FakeLlm({ default: '{"items": ["a"]}' }), "p", Answer, {
      maxTokens: 10,
      runId: RUN_ID,
    });
    expect(out.ok).toBe(true);
    expect(out.parsed?.items).toEqual(["a"]);
    expect(out.parseError).toBeNull();
    expect(out.providerRejected).toBeNull();
    expect(out.api).toEqual({ fake: true });
    expect(out.call.run_id).toBe(RUN_ID);
    expect(out.call.provider).toBe("fake");
    const env = out.envelope({ parsed: out.parsed });
    expect(Object.keys(env).sort()).toEqual(
      ["api", "call", "parse_error", "parsed", "provider_rejected", "raw_text"].sort(),
    );
  });

  it("parse failure is an outcome, not an exception", async () => {
    const out = await completeAndParse(new FakeLlm({ default: "no json here" }), "p", Answer, {
      maxTokens: 10,
    });
    expect(out.ok).toBe(false);
    expect(out.parseError).toBe("no JSON object in response");
    expect(out.rawText).toBe("no json here");
    expect(out.call.rejected).toBe(false);
  });

  it("wrong shape is a parse failure", async () => {
    const out = await completeAndParse(new FakeLlm({ default: '{"items": 3}' }), "p", Answer, {
      maxTokens: 10,
    });
    expect(out.parsed).toBeNull();
    expect(out.parseError).toMatch(/^ValidationError/);
  });

  it("input rejection is terminal with a counted call", async () => {
    const out = await completeAndParse(new Failing(new LlmInputRejected("HTTP 422")), "p", Answer, {
      maxTokens: 10,
    });
    expect(out.providerRejected).toBe("HTTP 422");
    expect(out.parseError).toBeNull();
    expect(out.rawText).toBeNull();
    expect(out.api).toBeNull();
    expect(out.call.rejected).toBe(true);
  });

  it("provider failure propagates for the loop to abort", async () => {
    await expect(
      completeAndParse(new Failing(new LlmError("provider down")), "p", Answer, { maxTokens: 10 }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("latency rides from the adapter into the record", async () => {
    const out = await completeAndParse(new Slow(), "p", Answer, { maxTokens: 10 });
    expect(out.call.latency_ms).toBe(77);
  });
});

describe("completeAndParse tracing", () => {
  it("records one span with the prompt, llm and outcome", async () => {
    const tracer = new RecordingTracer();
    const out = await completeAndParse(
      new FakeLlm({ default: '{"items": ["a"]}' }),
      "the prompt",
      Answer,
      {
        maxTokens: 10,
        tracer,
      },
    );
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span?.name).toBe("completion");
    expect(span?.prompt).toBe("the prompt");
    expect(span?.llmName).toBe("fake");
    expect(span?.provider).toBe("fake");
    expect(span?.outcome).toBe(out);
    expect(span?.error).toBeNull();
  });

  it("explicit name and metadata ride into the span", async () => {
    const tracer = new RecordingTracer();
    await completeAndParse(new FakeLlm(), "p", Answer, {
      maxTokens: 10,
      tracer,
      name: "people_extraction",
      metadata: { document_id: 7 },
    });
    expect(tracer.spans[0]?.name).toBe("people_extraction");
    expect(tracer.spans[0]?.metadata).toEqual({ document_id: 7 });
  });

  it("a parse failure closes the span with its outcome", async () => {
    const tracer = new RecordingTracer();
    await completeAndParse(new FakeLlm({ default: "nope" }), "p", Answer, {
      maxTokens: 10,
      tracer,
    });
    expect(tracer.spans[0]?.error).toBeNull();
    expect(tracer.spans[0]?.outcome?.parseError).toBe("no JSON object in response");
  });

  it("an input rejection closes the span with its outcome", async () => {
    const tracer = new RecordingTracer();
    await completeAndParse(new Failing(new LlmInputRejected("HTTP 422")), "p", Answer, {
      maxTokens: 10,
      tracer,
    });
    expect(tracer.spans[0]?.error).toBeNull();
    expect(tracer.spans[0]?.outcome?.providerRejected).toBe("HTTP 422");
  });

  it("a provider failure marks the span and still propagates", async () => {
    const tracer = new RecordingTracer();
    await expect(
      completeAndParse(new Failing(new LlmError("provider down")), "p", Answer, {
        maxTokens: 10,
        tracer,
      }),
    ).rejects.toThrow("provider down");
    expect(tracer.spans[0]?.outcome).toBeNull();
    expect(tracer.spans[0]?.error).toBeInstanceOf(LlmError);
    expect((tracer.spans[0]?.error as LlmError).message).toBe("provider down");
  });
});

/** A tracer that throws from exactly one of its three calls. */
class BrokenTracer implements Tracer {
  readonly closes: string[] = [];
  constructor(private readonly brokenAt: "start" | "end" | "fail") {}
  start(_name: string, _opts: SpanStart): Span {
    if (this.brokenAt === "start") throw new Error("langfuse is down");
    return {
      end: (_o: Outcome<unknown>) => {
        this.closes.push("end");
        if (this.brokenAt === "end") throw new Error("langfuse is down");
      },
      fail: (_e: unknown) => {
        this.closes.push("fail");
        if (this.brokenAt === "fail") throw new Error("langfuse is down");
      },
    };
  }
  flush(): void {}
}

describe("best-effort tracing", () => {
  const originalWarn = tracingLog.warn;
  let warnings: string[] = [];
  const capture = () => {
    warnings = [];
    tracingLog.warn = (m) => warnings.push(m);
  };
  afterEach(() => {
    tracingLog.warn = originalWarn;
  });

  it("a tracer that cannot start costs a warning, not the outcome", async () => {
    capture();
    const tracer = new BrokenTracer("start");
    const out = await completeAndParse(new FakeLlm({ default: '{"items": ["a"]}' }), "p", Answer, {
      maxTokens: 10,
      tracer,
    });
    expect(out.parsed?.items).toEqual(["a"]);
    expect(tracer.closes).toEqual([]);
    expect(warnings).toEqual(["tracing failed (start): langfuse is down"]);
  });

  it("a tracer that cannot close costs a warning, not the outcome", async () => {
    capture();
    const tracer = new BrokenTracer("end");
    const out = await completeAndParse(new FakeLlm({ default: '{"items": ["a"]}' }), "p", Answer, {
      maxTokens: 10,
      tracer,
    });
    expect(out.parsed?.items).toEqual(["a"]);
    expect(tracer.closes).toEqual(["end"]);
    expect(warnings).toEqual(["tracing failed (end): langfuse is down"]);
  });

  it("a tracer that fails on a provider failure never masks it", async () => {
    capture();
    const tracer = new BrokenTracer("fail");
    await expect(
      completeAndParse(new Failing(new LlmError("provider down")), "p", Answer, {
        maxTokens: 10,
        tracer,
      }),
    ).rejects.toThrow("provider down");
    expect(tracer.closes).toEqual(["fail"]);
    expect(warnings).toEqual(["tracing failed (fail): langfuse is down"]);
  });
});

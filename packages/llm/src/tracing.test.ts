import { describe, expect, it } from "vitest";
import { FakeLlm } from "./client.js";
import { makeTracer, NULL_TRACER, RecordingTracer } from "./tracing.js";

describe("tracing", () => {
  it("defaults to the null backend", () => {
    expect(makeTracer("none")).toBe(NULL_TRACER);
  });

  it("names the backends that exist for an unknown one", () => {
    expect(() => makeTracer("lang-fuse")).toThrow(/lang-fuse.*none/);
  });

  it("null tracer yields a span that swallows everything", () => {
    const span = NULL_TRACER.start("x", { prompt: "p", llm: new FakeLlm() });
    expect(() => span.fail(new Error("boom"))).not.toThrow();
    NULL_TRACER.flush();
  });

  it("recording tracer counts flushes and keeps span order", () => {
    const tracer = new RecordingTracer();
    const llm = new FakeLlm();
    tracer.start("first", { prompt: "a", llm, metadata: { document_id: 1 } });
    tracer.start("second", { prompt: "b", llm });
    expect(tracer.spans.map((s) => s.name)).toEqual(["first", "second"]);
    expect(tracer.spans[0]?.metadata).toEqual({ document_id: 1 });
    expect(tracer.flushed).toBe(0);
    tracer.flush();
    tracer.flush();
    expect(tracer.flushed).toBe(2);
  });
});

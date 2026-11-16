import { describe, expect, it } from "vitest";
import { FakeLlm } from "./client.js";
import { makeTracer, NULL_TRACER } from "./tracing.js";

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
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { usageFromRaw } from "./audit.js";
import {
  AiSdkLlm,
  FakeLlm,
  fleetKeys,
  type LlmClient,
  LlmError,
  LlmInputRejected,
  type LlmResponse,
  makeLlm,
  RotatingLlm,
} from "./client.js";
import { loadLlmEnv } from "./env.js";

const textModel = (text: string, finishReason: "stop" | "length" = "stop") =>
  new MockLanguageModelV3({
    provider: "groq",
    modelId: "m",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: finishReason, raw: finishReason },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 4, text: 3, reasoning: 1 },
      },
      warnings: [],
      response: { id: "r1", modelId: "m", timestamp: new Date(0) },
    },
  });

const failingModel = (statusCode: number) =>
  new MockLanguageModelV3({
    provider: "groq",
    modelId: "m",
    doGenerate: async () => {
      throw new APICallError({
        message: "nope",
        url: "https://api.example/v1",
        requestBodyValues: {},
        statusCode,
        responseBody: "{}",
        isRetryable: false,
      });
    },
  });

describe("FakeLlm", () => {
  it("answers from the default or a responder", async () => {
    const fake = new FakeLlm();
    expect(fake.provider).toBe("fake");
    expect(await fake.complete("hi")).toEqual({
      text: '{"people": []}',
      raw: { fake: true },
      latencyMs: 0,
    });
    const echo = new FakeLlm({ respond: (p) => `got ${p}` });
    expect((await echo.complete("x")).text).toBe("got x");
  });
});

describe("AiSdkLlm", () => {
  it("names provider and model, times calls, and normalizes usage", async () => {
    const llm = new AiSdkLlm("groq", "openai/gpt-oss-120b", textModel("answer"));
    expect(llm.name).toBe("groq:openai/gpt-oss-120b");
    expect(llm.provider).toBe("groq");
    const res = await llm.complete("hi", { maxTokens: 123 });
    expect(res.text).toBe("answer");
    expect(res.latencyMs).not.toBeNull();
    expect(res.raw.stop_reason).toBe("stop");
    expect(usageFromRaw(res.raw)).toEqual({ input: 10, output: 4, total: 14, reasoning: 1 });
  });

  it("anthropic names the bare model id", () => {
    expect(new AiSdkLlm("anthropic", "claude-test", textModel("x")).name).toBe("claude-test");
  });

  it("raises LlmError on empty content", async () => {
    const llm = new AiSdkLlm("groq", "m", textModel("", "length"));
    await expect(llm.complete("hi")).rejects.toBeInstanceOf(LlmError);
  });

  it.each([400, 422])("HTTP %s is an input rejection", async (status) => {
    const llm = new AiSdkLlm("groq", "m", failingModel(status));
    await expect(llm.complete("hi")).rejects.toBeInstanceOf(LlmInputRejected);
  });

  it("wraps other provider failures with the status", async () => {
    const llm = new AiSdkLlm("groq", "m", failingModel(500));
    const err = await llm.complete("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(500);
    expect((err as LlmError).message).toMatch(/AI_APICallError/);
  });
});

describe("RotatingLlm", () => {
  class Scripted implements LlmClient {
    readonly name = "groq:m";
    readonly provider = "groq";
    calls = 0;
    constructor(private readonly status: number | null) {}
    async complete(): Promise<LlmResponse> {
      this.calls++;
      if (this.status !== null) throw new LlmError("no", { status: this.status });
      return { text: "ok", raw: {}, latencyMs: 1 };
    }
  }
  it("hands a rate-limited prompt to the next key", async () => {
    const a = new Scripted(429);
    const b = new Scripted(null);
    const llm = new RotatingLlm([a, b]);
    expect((await llm.complete("p")).text).toBe("ok");
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });
  it("surfaces the error once every key failed", async () => {
    const llm = new RotatingLlm([new Scripted(401), new Scripted(429)]);
    await expect(llm.complete("p")).rejects.toBeInstanceOf(LlmError);
  });
  it("does not rotate on non-key failures", async () => {
    const a = new Scripted(500);
    const b = new Scripted(null);
    await expect(new RotatingLlm([a, b]).complete("p")).rejects.toBeInstanceOf(LlmError);
    expect(b.calls).toBe(0);
  });
});

describe("makeLlm", () => {
  it("knows the vocabulary", () => {
    expect(makeLlm("fake", {})).toBeInstanceOf(FakeLlm);
    expect(() => makeLlm("anthropic", {})).toThrow(/WREN_ANTHROPIC_API_KEY/);
    expect(() => makeLlm("nope", {})).toThrow(/fake.*anthropic.*groq/);
  });
  it("routes each provider to its default model and the model suffix overrides", () => {
    const env = { NUM_GROQ: "1", GROQ_API_KEY_1: "k1" };
    expect(makeLlm("groq", env).name).toBe("groq:openai/gpt-oss-120b");
    expect(makeLlm("groq:llama-3.3-70b-versatile", env).name).toBe("groq:llama-3.3-70b-versatile");
    expect(() => makeLlm("gemini", env)).toThrow(/NUM_GEMINI/);
  });
  it("rotates over a key fleet", () => {
    const env = { NUM_GROQ: "3", GROQ_API_KEY_1: "a", GROQ_API_KEY_3: "c" };
    expect(fleetKeys(env, "groq")).toEqual(["a", "c"]);
    expect(makeLlm("groq", env)).toBeInstanceOf(RotatingLlm);
    expect(fleetKeys({ GROQ_API_KEY: "solo" }, "groq")).toEqual(["solo"]);
  });
  it("anthropic uses WREN_LLM_MODEL then the default", () => {
    expect(makeLlm("anthropic", { WREN_ANTHROPIC_API_KEY: "k" }).name).toBe(
      "claude-haiku-4-5-20251001",
    );
    expect(
      makeLlm("anthropic", { WREN_ANTHROPIC_API_KEY: "k", WREN_LLM_MODEL: "claude-x" }).name,
    ).toBe("claude-x");
  });
  it("anthropic:<model> beats the configured model", () => {
    const env = { WREN_ANTHROPIC_API_KEY: "k", WREN_LLM_MODEL: "claude-x" };
    expect(makeLlm("anthropic:claude-y", env, { anthropicModel: "claude-z" }).name).toBe(
      "claude-y",
    );
  });
});

describe("loadLlmEnv", () => {
  it("setdefault does not override existing env; missing file is a noop", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmenv-"));
    writeFileSync(join(dir, "llm.env"), "NUM_ZZTEST=5\nZZTEST_API_KEY_1=from-file\n");
    process.env.ZZTEST_API_KEY_1 = "already-exported";
    expect(loadLlmEnv("llm.env", dir)).toBe(true);
    expect(process.env.ZZTEST_API_KEY_1).toBe("already-exported");
    expect(process.env.NUM_ZZTEST).toBe("5");
    expect(loadLlmEnv("missing.env", dir)).toBe(false);
  });
});

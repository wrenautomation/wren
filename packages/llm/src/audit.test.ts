import { describe, expect, it } from "vitest";
import {
  callRecord,
  finishReasonFromRaw,
  providerFromModel,
  recordFor,
  usageFromRaw,
} from "./audit.js";
import { FakeLlm } from "./client.js";

const OPENAI_BODY = {
  id: "chatcmpl-1",
  model: "openai/gpt-oss-120b",
  choices: [{ finish_reason: "length", message: { content: "{" } }],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 300,
    total_tokens: 1500,
    completion_tokens_details: { reasoning_tokens: 250 },
  },
};
const ANTHROPIC_BODY = {
  id: "msg_1",
  type: "message",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "{}" }],
  usage: { input_tokens: 40, output_tokens: 8 },
};

describe("audit", () => {
  it("reads OpenAI-compatible usage including the reasoning share", () => {
    expect(usageFromRaw(OPENAI_BODY)).toEqual({
      input: 1200,
      output: 300,
      total: 1500,
      reasoning: 250,
    });
    expect(finishReasonFromRaw(OPENAI_BODY)).toBe("length");
  });

  it("derives Anthropic totals", () => {
    expect(usageFromRaw(ANTHROPIC_BODY)).toEqual({
      input: 40,
      output: 8,
      total: 48,
      reasoning: null,
    });
    expect(finishReasonFromRaw(ANTHROPIC_BODY)).toBe("end_turn");
  });

  it("yields null, not zero, for bodies without usage", () => {
    expect(usageFromRaw({ fake: true })).toBeNull();
    expect(usageFromRaw(null)).toBeNull();
    expect(usageFromRaw({ usage: { credits: 3 } })).toBeNull();
    expect(finishReasonFromRaw({ fake: true })).toBeNull();
  });

  it("derives the provider for pre-ledger rows", () => {
    expect(providerFromModel("groq:openai/gpt-oss-120b", null)).toBe("groq");
    expect(providerFromModel("cohere:command-a-03-2025", {})).toBe("cohere");
    expect(providerFromModel("fake", { fake: true })).toBe("fake");
    expect(providerFromModel("claude-haiku-4-5-20251001", ANTHROPIC_BODY)).toBe("anthropic");
  });

  it("keeps the call record shape stable", () => {
    const runId = "0b6b1c1e-4d0a-4d6e-9a3a-6b0b8b4f8d10";
    expect(
      callRecord(OPENAI_BODY, {
        model: "groq:openai/gpt-oss-120b",
        provider: "groq",
        latencyMs: 812,
        runId,
      }),
    ).toEqual({
      model: "groq:openai/gpt-oss-120b",
      provider: "groq",
      usage: { input: 1200, output: 300, total: 1500, reasoning: 250 },
      finish_reason: "length",
      latency_ms: 812,
      run_id: runId,
      rejected: false,
    });
  });

  it("recordFor reads the client and response", () => {
    const llm = new FakeLlm();
    const record = recordFor(
      llm,
      { text: "{}", raw: { fake: true }, latencyMs: 3 },
      { runId: null },
    );
    expect(record.model).toBe("fake");
    expect(record.provider).toBe("fake");
    expect(record.latency_ms).toBe(3);
    expect(record.usage).toBeNull();
    const rejected = recordFor(llm, null, { runId: null, rejected: true });
    expect(rejected.rejected).toBe(true);
    expect(rejected.usage).toBeNull();
  });
});

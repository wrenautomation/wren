import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Cut,
  Filtered,
  fakeModel,
  InputRejected,
  Refused,
  Transient,
} from "@wrenautomation/models";
import { claudeChildEnv, claudeCode } from "@wrenautomation/models/command";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usageFromRaw } from "./audit.js";
import {
  FakeLlm,
  fleetKeys,
  keyProvider,
  LlmError,
  LlmInputRejected,
  llmForKey,
  makeLlm,
  modelLlm,
} from "./client.js";
import { loadLlmEnv } from "./env.js";

/** An OpenAI-compatible chat reply, as Groq sends it. */
const chat = (text: string) =>
  Response.json({
    id: "r1",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  });

/** A wire that answers each call from `steps` in turn and keeps each request body. */
const wire = (...steps: (() => Response)[]) => {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const step = steps[Math.min(bodies.length - 1, steps.length - 1)] as () => Response;
    return step();
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
};

const groq = { NUM_GROQ: "1", GROQ_API_KEY_1: "k-0000000001" };

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

describe("modelLlm", () => {
  it("names provider and model, asks for 2048 tokens by default, and normalizes usage", async () => {
    const w = wire(() => chat("answer"));
    const llm = makeLlm("groq:openai/gpt-oss-120b", groq, { fetch: w.fetchFn });
    expect(llm.name).toBe("groq:openai/gpt-oss-120b");
    expect(llm.provider).toBe("groq");
    const res = await llm.complete("hi");
    expect(res.text).toBe("answer");
    expect(res.latencyMs).not.toBeNull();
    expect(res.raw.stop_reason).toBe("stop");
    expect(w.bodies[0]?.max_tokens).toBe(2048);
    expect(usageFromRaw(res.raw)).toMatchObject({ input: 10, output: 4, total: 14 });
    expect(res.raw.cost).toMatchObject({ usd: 0, free: true });
  });

  it("passes system, effort and the part on as the model's request", async () => {
    let seen: unknown = null;
    const llm = modelLlm(
      fakeModel((_p, req) => {
        seen = req;
        return "ok";
      }),
    );
    await llm.complete("hi", { system: "rules", effort: "low", part: "drafts", maxTokens: 500 });
    expect(seen).toMatchObject({
      prompt: "hi",
      system: "rules",
      effort: "low",
      purpose: "drafts",
      maxTokens: 500,
    });
  });

  it("keeps a cut answer's text for the parse step; an empty one is an LlmError", async () => {
    const cut = modelLlm(
      fakeModel(() => {
        throw new Cut("cut", '{"a": 1, "b"', { input: 5, output: 2048 });
      }),
    );
    const res = await cut.complete("hi");
    expect(res.text).toBe('{"a": 1, "b"');
    expect(res.raw.stop_reason).toBe("length");
    expect(usageFromRaw(res.raw)).toMatchObject({ input: 5, output: 2048 });
    const empty = modelLlm(
      fakeModel(() => {
        throw new Filtered("stopped", "refusal", "");
      }),
    );
    await expect(empty.complete("hi")).rejects.toBeInstanceOf(LlmError);
  });

  it("a refused input is LlmInputRejected; other failures are LlmError with the status", async () => {
    const throwing = (err: Error) =>
      modelLlm(
        fakeModel(() => {
          throw err;
        }),
      );
    await expect(throwing(new InputRejected("too long", 413)).complete("x")).rejects.toBeInstanceOf(
      LlmInputRejected,
    );
    for (const [err, status] of [
      [new Transient("busy", { status: 503 }), 503],
      [new Refused("bad key", 401), 401],
      [new Error("no text in the reply"), null],
    ] as const) {
      const e = await throwing(err)
        .complete("x")
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).status).toBe(status);
    }
  });

  it("HTTP 400 from the wire is an input rejection", async () => {
    const w = wire(() => Response.json({ error: { message: "bad" } }, { status: 400 }));
    await expect(makeLlm("groq", groq, { fetch: w.fetchFn }).complete("hi")).rejects.toBeInstanceOf(
      LlmInputRejected,
    );
  });

  describe("tries again", () => {
    afterEach(() => vi.useRealTimers());

    it("a busy answer on a single key, after a wait", async () => {
      vi.useFakeTimers();
      const w = wire(
        () => Response.json({ error: { message: "slow down" } }, { status: 429 }),
        () => chat("ok"),
      );
      const call = makeLlm("groq", groq, { fetch: w.fetchFn }).complete("hi");
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await call).text).toBe("ok");
      expect(w.bodies).toHaveLength(2);
    });

    it("hands a refused key's prompt to the next key at once", async () => {
      const w = wire(
        () => Response.json({ error: { message: "revoked" } }, { status: 401 }),
        () => chat("ok"),
      );
      const env = { NUM_GROQ: "2", GROQ_API_KEY_1: "k-1", GROQ_API_KEY_2: "k-2" };
      expect((await makeLlm("groq", env, { fetch: w.fetchFn }).complete("hi")).text).toBe("ok");
      expect(w.bodies).toHaveLength(2);
    });
  });
});

describe("claude-code", () => {
  it("is what makeLlm builds for claude-code[:model], sonnet by default", () => {
    expect(makeLlm("claude-code", {}).name).toBe("claude-code:sonnet");
    expect(makeLlm("claude-code:opus", {}).name).toBe("claude-code:opus");
  });

  it("reports the headless run's tokens and its list price, at no cost", async () => {
    const llm = modelLlm(
      claudeCode("opus", {
        run: async () =>
          JSON.stringify({
            subtype: "success",
            result: '{"ok": true}',
            total_cost_usd: 0.12,
            usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 10 },
          }),
      }),
    );
    const out = await llm.complete("hello");
    expect(out.text).toBe('{"ok": true}');
    expect(out.raw).toMatchObject({
      provider: "claude-code",
      usage: { input_tokens: 910, output_tokens: 40, cache_read_tokens: 10 },
      cost: { usd: 0, free: true, list_usd: 0.12 },
    });
  });

  it("an error result is an LlmError, and the child never sees an API key", async () => {
    const llm = modelLlm(
      claudeCode("sonnet", {
        run: async () => JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "" }),
      }),
    );
    await expect(llm.complete("x")).rejects.toBeInstanceOf(LlmError);
    expect(claudeChildEnv({ ANTHROPIC_API_KEY: "k", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });
});

describe("makeLlm", () => {
  it("knows the vocabulary", () => {
    expect(makeLlm("fake", {})).toBeInstanceOf(FakeLlm);
    expect(() => makeLlm("anthropic", {})).toThrow(/WREN_ANTHROPIC_API_KEY/);
    expect(() => makeLlm("nope", {})).toThrow(/fake.*anthropic.*cohere.*groq/);
  });
  it("routes each provider to its default model and the model suffix overrides", () => {
    expect(makeLlm("groq", groq).name).toBe("groq:openai/gpt-oss-120b");
    expect(makeLlm("groq:llama-3.3-70b-versatile", groq).name).toBe("groq:llama-3.3-70b-versatile");
    expect(makeLlm("cohere", { COHERE_API_KEY: "c" }).name).toBe("cohere:command-a-03-2025");
    expect(() => makeLlm("mistral", groq)).toThrow(/NUM_MISTRAL/);
    expect(() => makeLlm("gemini", groq)).toThrow(/unknown llm/);
  });
  it("reads a key fleet", () => {
    const env = { NUM_GROQ: "3", GROQ_API_KEY_1: "a", GROQ_API_KEY_3: "c" };
    expect(fleetKeys(env, "groq")).toEqual(["a", "c"]);
    expect(fleetKeys({ GROQ_API_KEY: "solo" }, "groq")).toEqual(["solo"]);
    expect(fleetKeys({ NUM_GROQ: "1", GROQ_API_KEY_1: "a #an account" }, "groq")).toEqual(["a"]);
  });
  it("gateway takes an alias or provider/model and needs its URL and token", () => {
    const env = { WREN_LLM_GATEWAY_URL: "https://gw.example/v1", WREN_LLM_GATEWAY_TOKEN: "t" };
    expect(makeLlm("gateway", env).name).toBe("gateway:free");
    expect(makeLlm("gateway:openrouter/google/gemma-4-31b-it:free", env).name).toBe(
      "gateway:openrouter/google/gemma-4-31b-it:free",
    );
    expect(() => makeLlm("gateway", {})).toThrow(/WREN_LLM_GATEWAY_URL/);
  });
  it("anthropic uses WREN_LLM_MODEL then the default, Haiku 5.5", () => {
    expect(makeLlm("anthropic", { WREN_ANTHROPIC_API_KEY: "k" }).name).toBe("claude-haiku-5-5");
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
  it("anthropic:haiku|sonnet|opus name the current Claude models, wherever a model is given", () => {
    const env = { WREN_ANTHROPIC_API_KEY: "k" };
    expect(makeLlm("anthropic:haiku", env).name).toBe("claude-haiku-5-5");
    expect(makeLlm("anthropic:sonnet", env).name).toBe("claude-sonnet-5-5");
    expect(makeLlm("anthropic:opus", env).name).toBe("claude-opus-5-5");
    expect(makeLlm("anthropic", { ...env, WREN_LLM_MODEL: "sonnet" }).name).toBe(
      "claude-sonnet-5-5",
    );
    expect(makeLlm("anthropic", env, { anthropicModel: "opus" }).name).toBe("claude-opus-5-5");
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

describe("llmForKey: a client's own model key", () => {
  it("places a key by its prefix or a provider: prefix, straight to the provider", () => {
    expect(keyProvider("sk-ant-api03-synthetic0000")?.provider).toBe("anthropic");
    expect(keyProvider("sk-or-v1-synthetic0000")?.provider).toBe("openrouter");
    expect(keyProvider("gsk_synthetic0000")?.provider).toBe("groq");
    expect(keyProvider("AIzaSynthetic0000")).toBeNull(); // Gemini keys: not a provider any more
    expect(keyProvider("sk-proj-synthetic0000")?.provider).toBe("openai");
    expect(keyProvider("cohere:synthetic0000")).toEqual({
      provider: "cohere",
      key: "synthetic0000",
    });
    expect(keyProvider("synthetic0000nopfx")).toBeNull();
    expect(llmForKey("gsk_synthetic0000").name).toBe("groq:openai/gpt-oss-120b");
    expect(llmForKey("sk-ant-api03-synthetic0000").provider).toBe("anthropic");
    expect(llmForKey("mistral:synthetic0000").provider).toBe("mistral");
    expect(llmForKey("cohere:synthetic0000").name).toBe("cohere:command-a-03-2025");
  });

  it("refuses a key it can't place, without saying it", () => {
    const key = "synthetic0000nopfx9999";
    let msg = "";
    try {
      llmForKey(key);
    } catch (e) {
      msg = String((e as Error).message) + String((e as Error).stack);
    }
    expect(msg).toContain("Can't tell which provider");
    expect(msg).not.toContain(key);
  });
});

import { describe, expect, it } from "vitest";
import { dayKey, resolve, type Target } from "../src/catalog.js";
import { classify, describe as describeError, Ledger } from "../src/ledger.js";
import { complete, type Env, keysOf, splitThought } from "../src/route.js";

const T0 = Date.parse("2026-10-06T18:00:00Z");
const FLASH: Target = { provider: "gemini", model: "gemini-3.8-flash" }; // 5 a minute, 20 a day

describe("ledger", () => {
  it("round-robins keys and stops each at its per-minute limit", () => {
    const l = new Ledger();
    const got = Array.from({ length: 11 }, () => l.acquire(FLASH, 2, T0));
    expect(got).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, null]);
    expect(l.acquire(FLASH, 2, T0 + 60_000)).toBe(0); // next minute
  });

  it("cools a key on 429 with growing backoff, and resets it on success", () => {
    const l = new Ledger();
    l.report(FLASH, 0, "rate", T0);
    expect(l.acquire(FLASH, 1, T0 + 60_000)).toBeNull();
    expect(l.acquire(FLASH, 1, T0 + 2 * 60_000)).toBe(0);
    l.report(FLASH, 0, "rate", T0 + 2 * 60_000);
    expect(l.acquire(FLASH, 1, T0 + 5 * 60_000)).toBeNull(); // 4 minutes now
    expect(l.acquire(FLASH, 1, T0 + 6 * 60_000)).toBe(0);
    l.report(FLASH, 0, "ok", T0 + 6 * 60_000);
    l.report(FLASH, 0, "rate", T0 + 7 * 60_000);
    expect(l.acquire(FLASH, 1, T0 + 9 * 60_000)).toBe(0); // back to 2
  });

  it("a daily 429 spends the key until the provider's day turns; auth kills it on every model", () => {
    const l = new Ledger();
    l.report(FLASH, 0, "daily", T0);
    expect(l.acquire(FLASH, 1, T0 + 3_600_000)).toBeNull();
    // Gemini's day is Pacific: 18:00Z is 11:00 PT, so the day turns at 07:00Z next morning.
    expect(dayKey("gemini", T0)).toBe("2026-10-06");
    expect(l.acquire(FLASH, 1, Date.parse("2026-10-07T07:01:00Z"))).toBe(0);
    l.report(FLASH, 0, "auth", T0);
    expect(l.acquire({ provider: "gemini", model: "gemma-4-31b-it" }, 1, T0)).toBeNull();
  });

  it("survives a reload from what it saved", () => {
    const saved = new Map<string, unknown>();
    const a = new Ledger((s) => saved.set(s.id, s));
    a.acquire(FLASH, 3, T0);
    a.report(FLASH, 1, "auth", T0);
    const b = new Ledger();
    for (const s of saved.values()) b.load(s as never);
    expect(b.acquire(FLASH, 3, T0)).toBe(2); // cursor moved past 0, key 1 is dead
  });

  it("reports usage per model, with recent errors and no key text", () => {
    const l = new Ledger();
    l.acquire(FLASH, 3, T0);
    l.report(
      FLASH,
      1,
      "rate",
      T0,
      describeError(429, '{"error":{"message":"slow down AIzaSyAbcdefghijklmnop"}}'),
    );
    const [u] = l.usage([FLASH], { gemini: 3, openrouter: 0, cohere: 0 }, T0);
    expect(u).toMatchObject({
      model: "gemini/gemini-3.8-flash",
      keys: 3,
      ready: 2,
      cooling: 1,
      today: 1,
      errors: ["429 slow down [key]"],
    });
  });
});

describe("classify and resolve", () => {
  it("reads what a failure says about the key", () => {
    expect(
      classify(429, "Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
    ).toBe("daily");
    expect(classify(429, "Rate limit exceeded: free-models-per-day")).toBe("daily");
    expect(classify(429, "Resource exhausted, try again")).toBe("rate");
    expect(classify(429, "temporarily rate-limited upstream (upstream_provider_shared_pool)")).toBe(
      "model",
    );
    expect(classify(400, "API key not valid. Please pass a valid API key.")).toBe("auth");
    expect(classify(503, "")).toBe("server");
    expect(classify(400, "bad tool schema")).toBeNull();
  });

  it("takes aliases and provider/model, nothing else", () => {
    expect(resolve(undefined)?.[0]?.provider).toBe("gemini");
    expect(resolve("openrouter/google/gemma-4-31b-it:free")).toEqual([
      { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    ]);
    expect(resolve("cohere")?.[0]).toEqual({ provider: "cohere", model: "command-a-03-2025" });
    expect(resolve("gpt-4o")).toBeNull();
    expect(resolve("acme/x")).toBeNull();
  });
});

describe("complete", () => {
  const env = {
    GATEWAY_TOKEN: "t",
    GEMINI_KEYS: "g0\ng1\n",
    OPENROUTER_KEYS: "o0 # a note\n# a comment line",
  } as unknown as Env;

  it("reads one key per line and drops notes", () => {
    expect(keysOf(env, "gemini")).toEqual(["g0", "g1"]);
    expect(keysOf(env, "openrouter")).toEqual(["o0"]);
  });

  it("moves to the next key on 429, the next model when a model is spent, and labels the winner", async () => {
    const l = new Ledger();
    const ledger = {
      acquire: (t: Target) => l.acquire(t, t.provider === "gemini" ? 2 : 1, T0),
      report: (t: Target, i: number, o: never) => l.report(t, i, o, T0),
    };
    const calls: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      const key = String((init.headers as Record<string, string>).authorization).slice(7);
      calls.push(`${model}@${key}`);
      if (model === "gemini-3.8-flash") return new Response("per day", { status: 429 });
      if (model === "gemini-3.7-flash" && key === "g0")
        return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await complete({ model: "free", messages: [] }, env, ledger, fetcher);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-model")).toBe("gemini/gemini-3.7-flash");
    expect(res.headers.get("x-gateway-key")).toBe("gemini#1");
    expect(calls).toEqual([
      "gemini-3.8-flash@g0",
      "gemini-3.8-flash@g1",
      "gemini-3.7-flash@g0",
      "gemini-3.7-flash@g1",
    ]);
  });

  it("a model that times out is skipped for a while; the next model answers", async () => {
    const l = new Ledger();
    const ledger = {
      acquire: (t: Target) => l.acquire(t, 2, T0),
      report: (t: Target, i: number, o: never, d?: string) => l.report(t, i, o, T0, d),
    };
    const fetcher = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      if (model === "gemini-3.8-flash") throw new DOMException("aborted", "AbortError");
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await complete({ model: "free", messages: [] }, env, ledger, fetcher);
    expect(res.headers.get("x-gateway-model")).toBe("gemini/gemini-3.7-flash");
    expect(l.acquire(FLASH, 2, T0 + 60_000)).toBeNull(); // still skipped
    expect(l.acquire(FLASH, 2, T0 + 11 * 60_000)).not.toBeNull();
  });

  it("returns the request's own error as is, and 429 when every key is spent", async () => {
    const l = new Ledger();
    const ledger = {
      acquire: (t: Target) => l.acquire(t, 1, T0),
      report: (t: Target, i: number, o: never) => l.report(t, i, o, T0),
    };
    const bad = (async () =>
      new Response('{"error":"bad schema"}', { status: 400 })) as unknown as typeof fetch;
    expect((await complete({ model: "gemini/gemma-4-31b-it" }, env, ledger, bad)).status).toBe(400);
    const spent = (async () => new Response("per day", { status: 429 })) as unknown as typeof fetch;
    const res = await complete({ model: "free" }, env, ledger, spent);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("splitThought", () => {
  it("moves Gemma's inline thought out of the reply", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "<thought>they want pong</thought>pong" } }],
    });
    const out = JSON.parse(splitThought(raw));
    expect(out.choices[0].message).toEqual({
      content: "pong",
      reasoning_content: "they want pong",
    });
    expect(splitThought('{"choices":[]}')).toBe('{"choices":[]}');
  });
});

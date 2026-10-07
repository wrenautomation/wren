import { describe, expect, it } from "vitest";
import { ALL, CALLERS, callerOf, Guard, MAX_COMPLETION_TOKENS, sanitize } from "../src/guard.js";

const T0 = Date.parse("2026-10-06T18:00:00Z");

describe("guard", () => {
  it("lets a burst through up to rpm, then drips at rpm a minute", () => {
    const g = new Guard();
    const rpm = (CALLERS.william as { rpm: number }).rpm;
    for (let i = 0; i < rpm; i++) expect(g.admit("william", T0).ok).toBe(true);
    const over = g.admit("william", T0);
    expect(over).toMatchObject({ ok: false, retryAfter: 1 });
    if (!over.ok) expect(over.headers["retry-after"]).toBe("1");
    expect(g.admit("william", T0 + 60_000 / rpm).ok).toBe(true); // one more dripped in
  });

  it("stops a caller at its day cap until UTC midnight", () => {
    const g = new Guard();
    const rpd = (CALLERS.william as { rpd: number }).rpd;
    // Spread over the day so the faucet never binds.
    for (let i = 0; i < rpd; i++) g.admit("william", T0 + i * 1000);
    const over = g.admit("william", T0 + rpd * 1000);
    expect(over.ok).toBe(false);
    expect(g.admit("william", Date.parse("2026-10-08T00:00:01Z")).ok).toBe(true);
  });

  it("caps paid tokens per caller, and settles to what the reply used", () => {
    const g = new Guard();
    const cap = (CALLERS.prod as { paidTokensPerDay: number }).paidTokensPerDay;
    expect(g.admit("prod", T0, cap).ok).toBe(true);
    const over = g.admit("prod", T0 + 1000, 1);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/paid tokens/);
    g.settle("prod", T0 + 2000, -cap + 100); // the reply used 100
    expect(g.admit("prod", T0 + 3000, 1000).ok).toBe(true);
    expect(g.usage(T0 + 3000).callers.prod?.paidTokensToday).toBe(1100);
    expect(g.usage(T0 + 3000).all.paidTokensToday).toBe(1100);
  });

  it("the shared cap binds across callers", () => {
    const g = new Guard();
    expect(g.admit("william", T0, ALL.paidTokensPerDay).ok).toBe(true);
    const over = g.admit("prod", T0, 10);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/^all callers/);
  });

  it("charges nothing when it refuses", () => {
    const g = new Guard();
    g.admit("william", T0, (CALLERS.william as { paidTokensPerDay: number }).paidTokensPerDay);
    g.admit("william", T0, 5); // refused
    expect(g.usage(T0).callers.william?.requestsToday).toBe(1);
  });
});

describe("callerOf", () => {
  const hash = async (s: string) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  it("names the caller whose hash matches, nothing else", async () => {
    const secret = `prod ${await hash("p-token")}\nwilliam ${await hash("w-token")}\nghost ${await hash("g")}`;
    expect(await callerOf("Bearer w-token", secret)).toBe("william");
    expect(await callerOf("Bearer p-token", secret)).toBe("prod");
    expect(await callerOf("Bearer g", secret)).toBeNull(); // not in CALLERS
    expect(await callerOf("Bearer nope", secret)).toBeNull();
    expect(await callerOf(null, secret)).toBeNull();
  });
});

describe("sanitize", () => {
  const msgs = [{ role: "user", content: "hi" }];
  it("cuts max_tokens and reserves prompt plus completion", () => {
    const r = sanitize({ messages: msgs, max_tokens: 100_000 }, 400);
    expect(r).toEqual({
      body: { messages: msgs, max_tokens: MAX_COMPLETION_TOKENS },
      reserve: 100 + MAX_COMPLETION_TOKENS,
    });
    expect(sanitize({ messages: msgs, max_tokens: 50 }, 40)).toMatchObject({ reserve: 60 });
  });
  it("refuses n > 1 and empty messages", () => {
    expect(sanitize({ messages: msgs, n: 3 }, 10)).toEqual({ error: "n must be 1" });
    expect(sanitize({ messages: [] }, 10)).toHaveProperty("error");
  });
});

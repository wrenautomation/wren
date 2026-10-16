import { describe, expect, it } from "vitest";
import { limitSignal, timedFetch } from "./fetch-limit.js";

/** A fetch that never answers until its signal aborts. */
const hung = (_input: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("timedFetch", () => {
  it("aborts a fetch that never answers at its limit", async () => {
    const started = Date.now();
    const err = await timedFetch(50, hung)("https://example.test/").catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("leaves a fetch that answers in time alone", async () => {
    const ok = timedFetch(1_000, async (_input: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(false);
      expect(init?.method).toBe("POST");
      return new Response("hi");
    });
    expect(await (await ok("https://example.test/", { method: "POST" })).text()).toBe("hi");
  });

  it("still aborts on the caller's own signal, before the limit", async () => {
    const mine = new AbortController();
    const p = timedFetch(60_000, hung)("https://example.test/", { signal: mine.signal });
    mine.abort(new Error("caller gave up"));
    await expect(p).rejects.toThrow("caller gave up");
  });
});

describe("limitSignal", () => {
  it("is the limit alone without a caller's signal", async () => {
    const s = limitSignal(20);
    expect(s.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.aborted).toBe(true);
  });
});

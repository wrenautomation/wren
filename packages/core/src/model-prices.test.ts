import { describe, expect, it } from "vitest";
import { priceOf, pricesText, tokenCost } from "./model-prices.js";
import { VENDORS, vendorOf } from "./vendors.js";

// Micro-dollars: one million micros is one dollar.
describe("tokenCost", () => {
  it("prices Sonnet 5.5 input and output", () => {
    // 1M in at 2, 1M out at 10: 12 dollars.
    expect(tokenCost("claude-sonnet-5-5", { input: 1_000_000, output: 1_000_000 })).toBe(
      12_000_000,
    );
    expect(tokenCost("claude-sonnet-5-5", { input: 1_000, output: 500 })).toBe(7_000);
  });

  it("has no long-context tier on Sonnet 5.5", () => {
    expect(tokenCost("claude-sonnet-5-5", { input: 500_000, output: 0 })).toBe(1_000_000);
  });

  it("prices Haiku 5.5 on the low tier up to 100,000 prompt tokens", () => {
    expect(tokenCost("claude-haiku-5-5", { input: 50_000, output: 10_000 })).toBe(5_000 + 5_000);
  });

  it("takes exactly 100,000 prompt tokens on the low tier", () => {
    expect(tokenCost("claude-haiku-5-5", { input: 100_000, output: 0 })).toBe(10_000);
  });

  it("moves the whole request to the high tier at 100,001", () => {
    // 100,001 at 0.50 per million, output at 2.50.
    expect(tokenCost("claude-haiku-5-5", { input: 100_001, output: 1_000 })).toBe(
      Math.round((100_001 * 500_000 + 1_000 * 2_500_000) / 1_000_000),
    );
    expect(tokenCost("claude-haiku-5-5", { input: 100_001, output: 0 })).toBe(50_001);
  });

  it("counts cache reads and writes in the prompt length for the tier", () => {
    // 60k plain + 50k cache read = 110k prompt: high tier. Read at 0.05, plain at 0.50.
    const high = tokenCost("claude-haiku-5-5", { input: 110_000, output: 0, cacheRead: 50_000 });
    expect(high).toBe(Math.round((60_000 * 500_000 + 50_000 * 50_000) / 1_000_000));
    // The same read in a 60k prompt: low tier, read at 0.01.
    const low = tokenCost("claude-haiku-5-5", { input: 60_000, output: 0, cacheRead: 50_000 });
    expect(low).toBe(Math.round((10_000 * 100_000 + 50_000 * 10_000) / 1_000_000));
  });

  it("prices cache reads far under input", () => {
    // Sonnet: 1M read at 0.10.
    expect(
      tokenCost("claude-sonnet-5-5", { input: 1_000_000, output: 0, cacheRead: 1_000_000 }),
    ).toBe(100_000);
  });

  it("prices 5 minute and 1 hour cache writes apart", () => {
    // Sonnet: 1M written, 400k of it for 1 hour: 600k at 2.50 plus 400k at 4.
    expect(
      tokenCost("claude-sonnet-5-5", {
        input: 1_000_000,
        output: 0,
        cacheWrite: 1_000_000,
        cacheWrite1h: 400_000,
      }),
    ).toBe(1_500_000 + 1_600_000);
  });

  it("takes a dated model id by its base", () => {
    expect(tokenCost("claude-haiku-5-5-20261001", { input: 1_000_000, output: 0 })).toBe(
      tokenCost("claude-haiku-5-5", { input: 1_000_000, output: 0 }),
    );
    expect(priceOf("claude-haiku-5-55")).toBeNull();
  });

  it("prices the worker's default model, Haiku 4.5, by its dated id", () => {
    expect(tokenCost("claude-haiku-4-5-20251001", { input: 1_000_000, output: 1_000_000 })).toBe(
      1_000_000 + 5_000_000,
    );
  });

  it("costs an unknown model 0 and never throws", () => {
    expect(tokenCost("claude-mystery-9", { input: 1_000_000, output: 1_000_000 })).toBe(0);
    expect(priceOf("claude-mystery-9")).toBeNull();
  });

  it("treats missing and negative counts as 0", () => {
    expect(tokenCost("claude-sonnet-5-5", { input: null, output: null })).toBe(0);
    expect(tokenCost("claude-sonnet-5-5", { input: -5, output: 0 })).toBe(0);
  });
});

describe("the anthropic vendor", () => {
  it("is Wren's own, budgeted at 200 dollars a month, priced per model", () => {
    const v = vendorOf("anthropic");
    expect(v.budgetMicros).toBe(200_000_000);
    expect(v.wrenOnly).toBe(true);
    expect(v.micros).toBeNull();
    expect(v.unit).toBe("token");
    expect(pricesText()).toContain("Haiku 5.5");
  });

  it("is the only vendor with a budget", () => {
    expect(VENDORS.filter((v) => v.budgetMicros !== undefined).map((v) => v.id)).toEqual([
      "anthropic",
    ]);
  });
});

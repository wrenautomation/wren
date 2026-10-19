import { describe, expect, it } from "vitest";
import { ASK, askPaths, parseSeed } from "./seed.js";
import { Refused } from "./store.js";

const base = () => ({ offer: "o", funnels: [], terms: [], journeys: [], deals: [] });
const errors = (raw: unknown): string[] => {
  try {
    parseSeed(raw);
    return [];
  } catch (e) {
    return e instanceof Refused ? e.errors : [String(e)];
  }
};

describe("askPaths", () => {
  it("lists each place a value is still asked for", () => {
    const raw = { a: [{ b: ASK }, 1], c: { d: ASK }, e: "fine" };
    expect(askPaths(raw)).toEqual(["a[0].b", "c.d"]);
  });
});

describe("parseSeed", () => {
  it("takes an empty file", () => {
    expect(parseSeed(base()).funnels).toEqual([]);
  });
  it("refuses a file that still asks, and lists each", () => {
    const e = errors({ ...base(), note: ASK, journeys: [{ person: ASK }] });
    expect(e[0]).toMatch(/2 values/);
    expect(e).toContain("  note");
    expect(e).toContain("  journeys[0].person");
  });
  it("refuses unknown fields and repeats", () => {
    expect(errors({ ...base(), x: 1 }).join()).toMatch(/x/);
    const t = { plan: "a", from: "2020-01-01", body: {} };
    expect(errors({ ...base(), terms: [t, t] }).join()).toMatch(/./);
  });
  it("refuses a bad date", () => {
    const body = {
      currency: "USD",
      setupCents: 1,
      monthlyCents: null,
      perUnitCents: null,
      unit: null,
      capCents: null,
      days: null,
      payDays: 7,
    };
    expect(errors({ ...base(), terms: [{ plan: "a", from: "soon", body }] }).join()).toMatch(
      /YYYY-MM-DD/,
    );
    expect(
      errors({
        ...base(),
        terms: [
          { plan: "a", from: "2020-01-01", body },
          { plan: "a", from: "2020-01-01", body },
        ],
      }).join(),
    ).toMatch(/twice/);
  });
});

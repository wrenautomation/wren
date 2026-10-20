import type { Icp } from "@wren/offers";
import { describe, expect, it, vi } from "vitest";
import { bandOf, type FitModel, type FitTraits, needsModel, scoreFit } from "./icp.js";

const ICP: Icp = {
  who: "Owner-run dental practices that want more booked consults",
  industries: ["dental", "orthodontics"],
  sizes: ["11-50"],
  roles: ["owner", "practice manager"],
  regions: ["US", "Canada"],
  must: ["Takes new patients"],
  not: ["Part of a large chain"],
};

const KNOWN: FitTraits = {
  industries: ["Dental practice"],
  size: 20,
  roles: ["Owner"],
  regions: ["US"],
  about: ["Owner at Acme Dental, 20 staff, Ohio"],
};

const says = (text: string): FitModel => ({ complete: async () => ({ text }) });

describe("bandOf", () => {
  it("reads counts, bands and persona words", () => {
    expect(bandOf(12)).toEqual([12, 12]);
    expect(bandOf("11-50")).toEqual([11, 50]);
    expect(bandOf("2 to 9")).toEqual([2, 9]);
    expect(bandOf("1,000+")).toEqual([1000, Number.POSITIVE_INFINITY]);
    expect(bandOf("mid")).toEqual([10, 49]);
    expect(bandOf("unknown")).toBeNull();
    expect(bandOf(null)).toBeNull();
  });
});

describe("scoreFit in code", () => {
  const { who: _who, must: _must, not: _not, ...structured } = ICP;
  const codeOnly: Icp = { who: "", ...structured };

  it("scores a full match 100 with a reason per field", async () => {
    const fit = await scoreFit(codeOnly, KNOWN);
    expect(fit.score).toBe(100);
    expect(fit.unknown).toEqual([]);
    expect(fit.reasons).toEqual([
      "Industry fits: Dental practice.",
      "Role fits: Owner.",
      "Region fits: US.",
      "Size 20 fits.",
    ]);
  });

  it("scores a partial match by the share of fields that fit", async () => {
    const fit = await scoreFit(codeOnly, { ...KNOWN, size: "solo", regions: ["Germany"] });
    expect(fit.score).toBe(50);
    expect(fit.reasons).toContain("Size 1 does not fit 11-50.");
    expect(fit.reasons).toContain("Region does not fit: Germany.");
  });

  it("puts a field with no known trait in unknown and does not lower the score", async () => {
    const some = await scoreFit(codeOnly, { roles: ["Practice Manager"] });
    expect(some.score).toBe(100);
    expect(some.unknown).toEqual(["industries", "regions", "sizes"]);
    // The same person against an ICP that asks nothing else scores the same.
    const alone = await scoreFit(
      { who: "", roles: ["owner", "practice manager"] },
      { roles: ["Practice Manager"] },
    );
    expect(alone.score).toBe(some.score);
  });

  it("scores 50 with a reason when nothing is known", async () => {
    const fit = await scoreFit(codeOnly, {});
    expect(fit.score).toBe(50);
    expect(fit.unknown).toEqual(["industries", "roles", "regions", "sizes"]);
    expect(fit.reasons).toEqual(["Nothing is known yet to check against the profile."]);
  });

  it("matches a country code to the country's name", async () => {
    const fit = await scoreFit({ who: "", regions: ["United States"] }, { regions: ["US"] });
    expect(fit.score).toBe(100);
  });

  it("matches whole words only", async () => {
    const fit = await scoreFit({ who: "", roles: ["owner"] }, { roles: ["Downer"] });
    expect(fit.score).toBe(0);
  });

  it("leaves who, must and not unknown without a model", async () => {
    const fit = await scoreFit(ICP, KNOWN);
    expect(fit.score).toBe(100);
    expect(fit.unknown).toEqual(["who", "must: Takes new patients", "not: Part of a large chain"]);
  });
});

describe("scoreFit with a model", () => {
  it("counts who and must, and notes a not that does not apply", async () => {
    const fit = await scoreFit(ICP, KNOWN, says('{"who": "yes", "must": ["no"], "not": ["no"]}'));
    // 4 structured yes + who yes + must no = 5 of 6.
    expect(fit.score).toBe(83);
    expect(fit.reasons).toContain("Matches who the profile describes.");
    expect(fit.reasons).toContain("Does not meet: Takes new patients.");
    expect(fit.reasons).toContain("Clear of: Part of a large chain.");
    expect(fit.unknown).toEqual([]);
  });

  it("rules a person out when a not rule applies", async () => {
    const fit = await scoreFit(ICP, KNOWN, says('{"who": "yes", "must": ["yes"], "not": ["yes"]}'));
    expect(fit.score).toBe(0);
    expect(fit.reasons).toContain("Ruled out: Part of a large chain.");
  });

  it("takes the answer from inside a fenced reply, and unknown for what it leaves out", async () => {
    const fit = await scoreFit(ICP, KNOWN, says('```json\n{"who": "yes", "must": []}\n```'));
    expect(fit.unknown).toEqual(["must: Takes new patients", "not: Part of a large chain"]);
    expect(fit.score).toBe(100);
  });

  it("keeps the code score and says so when the model errors", async () => {
    const model: FitModel = {
      complete: async () => {
        throw new Error("gateway down");
      },
    };
    const fit = await scoreFit(ICP, KNOWN, model);
    expect(fit.score).toBe(100);
    expect(fit.reasons[0]).toBe(
      "The model check failed (gateway down); the score uses the fields checked in code.",
    );
    expect(fit.unknown).toEqual(["who", "must: Takes new patients", "not: Part of a large chain"]);
  });

  it("does the same when the answer is not JSON", async () => {
    const fit = await scoreFit(ICP, KNOWN, says("I think they fit."));
    expect(fit.score).toBe(100);
    expect(fit.reasons[0]).toMatch(/^The model check failed \(the answer was not JSON\)/);
  });

  it("does not wait on a model that never answers", async () => {
    const model: FitModel = { complete: () => new Promise(() => {}) };
    const fit = await scoreFit(ICP, KNOWN, model, 10);
    expect(fit.score).toBe(100);
    expect(fit.reasons[0]).toMatch(/timed out/);
  });

  it("does not ask when there is nothing to judge or nothing the model judges", async () => {
    const model = { complete: vi.fn(async () => ({ text: "{}" })) };
    await scoreFit(ICP, { ...KNOWN, about: [] }, model);
    await scoreFit({ who: "", industries: ["dental"] }, KNOWN, model);
    expect(model.complete).not.toHaveBeenCalled();
    expect(needsModel({ who: "", industries: ["dental"] })).toBe(false);
    expect(needsModel(ICP)).toBe(true);
  });
});

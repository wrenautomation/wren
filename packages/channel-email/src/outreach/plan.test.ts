import { describe, expect, it } from "vitest";
import { enrollmentPlan } from "./plan.js";

const KNOWN = new Set(["a-days-0-5", "b-days-0-5"]);

describe("enrollmentPlan", () => {
  it("keeps ordered rules whose sequences exist", () => {
    const plan = enrollmentPlan(
      [{ sequence: "a-days-0-5", where: { "company.segment": "a" } }, { sequence: "b-days-0-5" }],
      KNOWN,
      "niche 'x'",
    );
    expect(plan.map((r) => r.sequence)).toEqual(["a-days-0-5", "b-days-0-5"]);
  });
  it("refuses an unknown sequence", () => {
    expect(() => enrollmentPlan([{ sequence: "zzz" }], KNOWN, "niche 'x'")).toThrow(
      /unknown sequence 'zzz'/,
    );
  });
  it("refuses an ungated rule that is not last", () => {
    expect(() =>
      enrollmentPlan(
        [{ sequence: "a-days-0-5" }, { sequence: "b-days-0-5", where: { k: "v" } }],
        KNOWN,
        "niche 'x'",
      ),
    ).toThrow(/has no gate/);
  });
  it("refuses an empty plan", () => {
    expect(() => enrollmentPlan([], KNOWN, "niche 'x'")).toThrow(/at least one rule/);
  });
});

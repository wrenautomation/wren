import { describe, expect, it } from "vitest";
import { type EnrollmentRule, enrollmentPlan } from "./plan.js";

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

describe("enrollmentPlan audiences", () => {
  it("keeps an ungated first_contact rule followed by a returning-only rule", () => {
    const plan = enrollmentPlan(
      [
        { sequence: "a-days-0-5", audience: "first_contact" },
        { sequence: "b-days-0-5", audience: "returning" },
      ],
      KNOWN,
      "niche 'x'",
    );
    expect(plan.map((r) => [r.sequence, r.audience])).toEqual([
      ["a-days-0-5", "first_contact"],
      ["b-days-0-5", "returning"],
    ]);
  });
  it("keeps an ungated returning rule followed by a first_contact rule", () => {
    expect(() =>
      enrollmentPlan(
        [
          { sequence: "b-days-0-5", audience: "returning" },
          { sequence: "a-days-0-5", audience: "first_contact" },
        ],
        KNOWN,
        "niche 'x'",
      ),
    ).not.toThrow();
  });
  it("keeps a gated returning rule ahead of an ungated both-audience rule", () => {
    expect(() =>
      enrollmentPlan(
        [
          { sequence: "b-days-0-5", where: { k: "v" }, audience: "returning" },
          { sequence: "a-days-0-5" },
        ],
        KNOWN,
        "niche 'x'",
      ),
    ).not.toThrow();
  });
  it.each([
    ["a returning-only rule", { sequence: "b-days-0-5", audience: "returning" as const }],
    ["a first_contact-only rule", { sequence: "b-days-0-5", audience: "first_contact" as const }],
    ["a both-audience gated rule", { sequence: "b-days-0-5", where: { k: "v" } }],
  ])("refuses an ungated both-audience rule followed by %s", (_label, later) => {
    expect(() => enrollmentPlan([{ sequence: "a-days-0-5" }, later], KNOWN, "niche 'x'")).toThrow(
      /plan rule 0 \('a-days-0-5'\) has no gate/,
    );
  });
  it("refuses an ungated returning rule followed by another returning rule", () => {
    expect(() =>
      enrollmentPlan(
        [
          { sequence: "a-days-0-5", audience: "returning" },
          { sequence: "b-days-0-5", where: { k: "v" }, audience: "returning" },
        ],
        KNOWN,
        "niche 'x'",
      ),
    ).toThrow(/has no gate, so returning rule 1 after it could never enroll/);
  });
  it("refuses an ungated first_contact rule followed by a both-audience rule", () => {
    expect(() =>
      enrollmentPlan(
        [
          { sequence: "a-days-0-5", audience: "first_contact" },
          { sequence: "b-days-0-5", where: { k: "v" } },
        ],
        KNOWN,
        "niche 'x'",
      ),
    ).toThrow(/first_contact rule 1 after it could never enroll/);
  });
  it("refuses an unknown audience", () => {
    const rule = { sequence: "a-days-0-5", audience: "lapsed" } as unknown as EnrollmentRule;
    expect(() => enrollmentPlan([rule], KNOWN, "niche 'x'")).toThrow(
      /plan rule 0 names unknown audience 'lapsed'/,
    );
  });
  it("treats an empty where as no gate", () => {
    expect(() =>
      enrollmentPlan(
        [
          { sequence: "a-days-0-5", where: {}, audience: "returning" },
          { sequence: "b-days-0-5", audience: "returning" },
        ],
        KNOWN,
        "niche 'x'",
      ),
    ).toThrow(/has no gate/);
  });
});

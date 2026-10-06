import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { alleleKey } from "@wren/core/slots";
import {
  checkCandidate,
  fallbackPlan,
  type LocusView,
  parseOption,
  runJudge,
  runStrategist,
} from "./tiers.js";

const ctx = {
  facts: new Set(["company_short"]),
  siblings: ["I saw {company_short} grew this year", "your team grew a lot this year"],
  tried: new Set<string>(),
};
const why = (text: string, c = ctx) => {
  const r = checkCandidate(text, c);
  return r.ok ? [] : r.why;
};

describe("checkCandidate", () => {
  it("passes a clean option with a known fact", () => {
    const r = checkCandidate("I noticed {company_short} grew fast", ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.key).toBe(alleleKey(parseOption("I noticed {company_short} grew fast")));
  });
  it("drops marks, unknown facts, copy-rule breaks, length and repeats", () => {
    expect(why("a | b that is long enough here")[0]).toMatch(/does not parse/);
    expect(why("line one\nline two that is long")[0]).toMatch(/does not parse/);
    expect(why("hello {first_name}, your team grew")).toContain("unknown fact {first_name}");
    expect(why("your team grew — a lot this year")).toContain("a dash");
    expect(why("it costs $500 to grow the team")).toContain("a price");
    expect(why("see wrenautomation.com for growth")).toContain("a link");
    expect(why("hi")[0]).toMatch(/^length/);
    const seen = {
      ...ctx,
      tried: new Set([alleleKey(parseOption("your team grew a lot this year"))]),
    };
    expect(why("your team grew a lot this year", seen)).toContain("already tried here");
  });
});

const locus = (over: Partial<LocusView> = {}): LocusView => ({
  locus: "v1",
  settled: false,
  stagnant: false,
  alleles: [
    { allele: "a", text: "x", exposures: 100, successes: 1, pBest: 0.2, angle: "pain" },
    { allele: "b", text: "y", exposures: 100, successes: 6, pBest: 0.8, angle: null },
  ],
  ...over,
});

describe("strategist", () => {
  it("falls back to the stagnant locus with the widest spread when the model fails", async () => {
    const loci = [
      locus(),
      locus({ locus: "v2", stagnant: true }),
      locus({
        locus: "v3",
        stagnant: true,
        alleles: [
          { allele: "c", text: "z", exposures: 100, successes: 0, pBest: 0.1, angle: null },
          { allele: "d", text: "w", exposures: 100, successes: 9, pBest: 0.9, angle: null },
        ],
      }),
    ];
    const out = await runStrategist(new FakeLlm({ default: "no idea" }), {
      genome: "g",
      loci,
      writable: ["v1", "v2", "v3"],
      journal: [],
    });
    expect(out.plan).toMatchObject({ loci: ["v3"], mutation: "rewrite_loser", fallback: true });
    expect(fallbackPlan(loci, [], "x")).toBeNull();
  });
  it("keeps only writable loci from the model's plan", async () => {
    const llm = new FakeLlm({
      default:
        '{"mode":"explore","loci":["v9","v1"],"mutation":"new_angle","temperature":0.3,"reason":"try"}',
    });
    const out = await runStrategist(llm, {
      genome: "g",
      loci: [locus()],
      writable: ["v1"],
      journal: [],
    });
    expect(out.plan).toMatchObject({ loci: ["v1"], mode: "explore", fallback: false });
  });
});

describe("judge", () => {
  it("ranks by score, and diversify puts an untaken angle first", async () => {
    const llm = new FakeLlm({
      default:
        '{"scores":[{"n":1,"score":9,"angle":"pain"},{"n":2,"score":5,"angle":"proof"},{"n":3,"score":7,"angle":"pain"}]}',
    });
    const input = { locus: locus(), candidates: ["one", "two", "three"] };
    const plain = await runJudge(llm, { ...input, mode: "explore" });
    expect(plain.ranked.map((r) => r.text)).toEqual(["one", "three", "two"]);
    const wide = await runJudge(llm, { ...input, mode: "diversify" });
    expect(wide.ranked.map((r) => r.text)).toEqual(["two", "one", "three"]);
    const broken = await runJudge(new FakeLlm({ default: "?" }), { ...input, mode: "explore" });
    expect(broken.ranked.map((r) => [r.text, r.score])).toEqual([
      ["one", null],
      ["two", null],
      ["three", null],
    ]);
    expect(broken.error).not.toBeNull();
  });
});

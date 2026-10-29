import { type NumberedClaim, studyReport } from "@wrenautomation/read/study";
import { describe, expect, it } from "vitest";
import { verticalStudy } from "./recipes.js";
import { claimKey, type StudyClaim, type StudyView } from "./run.js";

const PAGE = {
  url: "https://staffing.example/survey",
  text: "Our 2025 survey of 412 firms found that 38% of placements came from repeat clients. Firms said referrals were cheaper than ads.",
};

const CLAIMS: NumberedClaim[] = [
  {
    n: 1,
    angle: 0,
    claim: "38% of placements come from repeat clients.",
    quote: "38% of placements came from repeat clients",
    source_url: PAGE.url,
  },
  {
    n: 2,
    angle: 0,
    claim: "Firms say referrals are cheaper than ads.",
    quote: "Firms said referrals were cheaper than ads",
    source_url: PAGE.url,
  },
];

describe("claims", () => {
  it("keys a claim by its document, study and quote", () => {
    const key = claimKey(7, "demo", "38% of placements came from repeat clients");
    expect(key).toMatch(/^doc:7\/study:demo\/[0-9a-f]{12}$/);
    expect(claimKey(7, "demo", "38% of placements came from repeat clients")).toBe(key);
    expect(claimKey(8, "demo", "38% of placements came from repeat clients")).not.toBe(key);
  });
});

describe("recipes", () => {
  it("builds a vertical study from words only", () => {
    const s = verticalStudy({ vertical: "recruiting firms", sells: "client win-back" });
    expect(s.angles).toHaveLength(5);
    expect(s.drafts.map((d) => d.key)).toEqual(["offers", "emails"]);
    expect(s.drafts[1]?.ask).toContain("reply with a few times");
  });
});

describe("report", () => {
  it("renders claims with marks and calls, drafts with cites, sources once", () => {
    const called: StudyClaim[] = CLAIMS.map((c, i) => ({
      ...c,
      key: `doc:1/study:demo/${i}`,
      call: i === 1 ? "drop" : null,
      comment: i === 1 ? "old survey" : null,
    }));
    const view = {
      study: {
        id: 1,
        slug: "demo",
        question: "Why?",
        angles: ["A", "B"],
        drafts: [],
        niche: null,
        createdAt: new Date(0),
      },
      angles: [
        { angle: "A", claims: called },
        { angle: "B", claims: [] },
      ],
      drafts: [
        {
          spec: { key: "offers", ask: "" },
          kept: [{ title: "Repeat desk", body: "Win them back.", cites: [1] }],
          dropped: [{ title: "Made up", why: "number_not_cited" }],
          done: true,
          stale: true,
        },
      ],
      titles: new Map([[PAGE.url, "Staffing survey"]]),
      counts: { queries: 3, pages: 2, unread: 1, gated: 1, waiting: 1 },
    } satisfies StudyView;
    const md = studyReport(view);
    expect(md).toContain("- 38% of placements come from repeat clients. [1]\n");
    expect(md).toContain("- ~~Firms say referrals are cheaper than ads. [2] (drop: old survey)~~");
    expect(md).toContain("2 claims passed the quote check (1 did not), 1 dropped by you.");
    expect(md).toContain("_Not run yet._");
    expect(md).toContain("_Your calls or new claims changed its claims");
    expect(md).toContain("Cites [1]");
    expect(md).toContain("Made up (number not cited)");
    expect(md).toContain(
      `1. Staffing survey, <${PAGE.url}>: "38% of placements came from repeat clients"`,
    );
    expect(md).toContain("2 parts still to run");

    const held = { by: "tester", at: "2026-10-06T00:00:00Z", published: "2025-01-02", hash: "x" };
    const marked = studyReport({ ...view, manual: new Map([[PAGE.url, held]]) });
    expect(marked).toContain(
      `<${PAGE.url}> (added by hand by tester on 2026-10-06, published 2025-01-02): "38%`,
    );
  });
});

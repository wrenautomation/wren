import { describe, expect, it } from "vitest";
import { buildBriefPrompt, gateBrief } from "./brief.js";

const facts = [
  {
    mark: "f12",
    text: "Acme has 3 open roles: Recruiter, Toronto, posted 2026-09-20 (greenhouse job board, read 2026-09-29)",
  },
  { mark: "f7", text: "still at Acme as Head of Talent (LinkedIn, read 2026-09-28)" },
  { mark: "c3", text: "CRM record: owner Sam; last placement 2024-03-15" },
];

describe("gateBrief", () => {
  it("keeps sentences whose marks and numbers come from their facts", () => {
    const g = gateBrief(
      [
        "Acme has 3 open roles, one posted 2026-09-20. [f12]",
        "She is still Head of Talent there. [f7][c3]",
      ],
      facts,
    );
    expect(g.kept).toHaveLength(2);
    expect(g.dropped).toEqual([]);
    expect(g.cites).toEqual({ findings: [7, 12], crm: [3] });
  });

  it("drops a sentence that cites nothing", () => {
    const g = gateBrief(["A great time to reach out."], facts);
    expect(g.dropped).toEqual([{ sentence: "A great time to reach out.", why: "cites nothing" }]);
  });

  it("drops a sentence citing a mark that isn't this person's", () => {
    const g = gateBrief(["Acme is hiring. [f12][f99]"], facts);
    expect(g.dropped[0]?.why).toBe("cites f99, not this person's facts");
  });

  it("drops a number the cited facts don't hold", () => {
    const g = gateBrief(["Acme has 4 open roles. [f12]"], facts);
    expect(g.dropped[0]?.why).toBe("4 not in the facts it cites");
  });

  it("a number from an uncited fact doesn't count", () => {
    const g = gateBrief(["Last placement was 2024-03-15. [f7]"], facts);
    expect(g.kept).toEqual([]);
  });

  it("a digit inside a bigger number is not that number", () => {
    expect(gateBrief(["Acme has 2 open roles. [f12]"], facts).kept).toEqual([]);
    expect(gateBrief(["Placed in 202. [c3]"], facts).kept).toEqual([]);
  });

  it("a year copied from a cited date passes", () => {
    expect(gateBrief(["Placed in 2024. [c3]"], facts).kept).toHaveLength(1);
  });

  it("reads mark lists however the model writes them", () => {
    const g = gateBrief(
      ["Still there with a placement on file. [F7, c3]", "Hiring. [ f12 ; f7 ]"],
      facts,
    );
    expect(g.kept).toHaveLength(2);
    expect(g.cites).toEqual({ findings: [7, 12], crm: [3] });
  });

  it("stops at four sentences and says so", () => {
    const g = gateBrief(
      Array.from({ length: 5 }, (_, i) => `Fact ${i === 0 ? "3" : ""}. [f12]`),
      facts,
    );
    expect(g.kept).toHaveLength(4);
    expect(g.dropped).toEqual([{ sentence: "Fact . [f12]", why: "over 4 sentences" }]);
  });

  it("dropped sentences don't count toward the cap or the citations", () => {
    const g = gateBrief(["Made up 9. [c3]", "Hiring. [f12]"], facts);
    expect(g.kept).toEqual(["Hiring. [f12]"]);
    expect(g.cites).toEqual({ findings: [12], crm: [] });
  });

  it("skips blank sentences", () => {
    expect(gateBrief(["  ", ""], facts)).toEqual({
      kept: [],
      dropped: [],
      cites: { findings: [], crm: [] },
    });
  });
});

describe("buildBriefPrompt", () => {
  it("lists every fact with its mark", () => {
    const p = buildBriefPrompt({
      personId: 1,
      name: "Jane Doe",
      firm: "Acme",
      facts,
      inputsHash: "x",
    });
    expect(p).toContain("Contact: Jane Doe, last known at Acme.");
    for (const f of facts) expect(p).toContain(`[${f.mark}] ${f.text}`);
  });
});

describe("gateBrief: the model's habits", () => {
  // Was a bug: "Sr." ended the sentence, so the uncited half was dropped and the brief began mid-sentence.
  it("a title abbreviation doesn't split the sentence", () => {
    const g = gateBrief(["Jane remains at Acme as Sr. Head of Talent. [f7]"], facts);
    expect(g.kept).toEqual(["Jane remains at Acme as Sr. Head of Talent. [f7]"]);
  });
  // Was a bug: "indicating ongoing recruitment needs" became "the team keeps growing" in the email.
  it("a clause saying what a fact means is cut, the fact kept", () => {
    const g = gateBrief(
      ["Jane is still at Acme as Head of Talent, which may indicate ongoing hiring needs [f7]."],
      facts,
    );
    expect(g.kept).toEqual(["Jane is still at Acme as Head of Talent [f7]."]);
  });
});

describe("gateBrief: hiring needs an open-roles fact", () => {
  // Was a bug: a job-change fact carried "There are open roles at ChainSafe" into the portal.
  it("hiring cited to a fact without open roles is dropped", () => {
    const g = gateBrief(["There are open roles at Acme. [f7]"], facts);
    expect(g.kept).toEqual([]);
    expect(g.dropped[0]?.why).toBe("says hiring; the facts it cites have no open roles");
  });
  it("hiring cited to the open-roles fact is kept", () => {
    expect(gateBrief(["Acme is hiring a Recruiter in Toronto. [f12]"], facts).kept).toHaveLength(1);
  });
  it('"making this a good time" is a guess, cut', () => {
    const g = gateBrief(
      ["Jane is still at Acme as Head of Talent, making this a good time [f7]."],
      facts,
    );
    expect(g.kept).toEqual(["Jane is still at Acme as Head of Talent [f7]."]);
  });
});

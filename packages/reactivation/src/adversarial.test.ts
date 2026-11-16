/**
 * Adversarial tests for the brief gate and the score. Each test says what
 * SHOULD happen per the doc comments; fixed bugs are marked "Was a bug".
 */
import { describe, expect, it } from "vitest";
import { gateBrief } from "./brief.js";
import { POINTS, type ScoreInput, scoreContact } from "./score.js";

const facts = [
  {
    mark: "f12",
    text: "Acme has 3 open roles: Recruiter, Toronto, posted 2026-09-20 (greenhouse job board, read 2026-09-29)",
  },
  { mark: "f7", text: "still at Acme as Head of Talent (LinkedIn, read 2026-09-28)" },
  { mark: "c3", text: "CRM record: owner Sam; last placement 2024-03-15" },
];
const kept = (s: string) => gateBrief([s], facts).kept;

describe("gateBrief: numbers the facts don't hold", () => {
  // Was a bug: NUMBER only matches ASCII digits, so a count written as a word skips the number check.
  it("a wrong count spelled out is dropped", () => {
    expect(kept("Acme has two open roles. [f12]")).toEqual([]);
  });

  // Was a bug: same root: non-ASCII digits aren't \d, so they are never checked.
  it("a wrong count in non-ASCII digits is dropped", () => {
    expect(kept("Acme has ９ open roles. [f12]")).toEqual([]);
    expect(kept("Acme has ٩ open roles. [f12]")).toEqual([]);
  });

  // Was a bug: hasNumber finds the count anywhere in the cited text, so the day of a read or posted date passes as a count.
  it("a count lifted from a date in the fact is dropped", () => {
    expect(kept("Acme has 29 open roles. [f12]")).toEqual([]);
    expect(kept("Acme has 20 open roles. [f12]")).toEqual([]);
    expect(kept("Sam placed 15 candidates with them. [c3]")).toEqual([]);
  });

  // Was a bug: a unit or magnitude glued to a real number isn't part of the check: "3k" passes on the fact's 3.
  it("a real number with a made-up magnitude is dropped", () => {
    expect(kept("Acme has 3k open roles. [f12]")).toEqual([]);
    expect(kept("Acme has 3 million open roles. [f12]")).toEqual([]);
  });

  it("thousands separators and decimals are one number, not parts", () => {
    expect(kept("Acme has 3,000 open roles. [f12]")).toEqual([]);
    expect(kept("Acme has 3.5 open roles. [f12]")).toEqual([]);
    expect(kept("Placed on 2024-03-15. [c3]")).toHaveLength(1);
  });

  it("a number in the marks is not read as a claim", () => {
    expect(kept("Acme is hiring a Recruiter in Toronto. [f12]")).toHaveLength(1);
    expect(kept("Acme has 12 open roles. [f12]")).toEqual([]);
  });

  it("a mark mid-sentence still gates the whole sentence", () => {
    expect(kept("Acme [f12] has 4 open roles.")).toEqual([]);
  });
});

describe("gateBrief: marks", () => {
  // Was a bug: the gate never splits an element, so a second sentence packed after the marks rides on them uncited.
  it("an uncited sentence packed after a cited one is not kept", () => {
    const g = gateBrief(
      ["Acme has 3 open roles. [f12] She was just promoted to VP at Google."],
      facts,
    );
    expect(g.kept.join(" ")).not.toContain("Google");
  });

  // Was a bug: same root: packing sentences into elements beats the four-sentence cap.
  it("four elements can't carry more than four sentences", () => {
    const g = gateBrief(
      [
        "Acme is hiring. [f12] Acme is hiring a Recruiter. [f12]",
        "Still at Acme. [f7] Head of Talent. [f7]",
        "Owner is Sam. [c3] Placed in 2024. [c3]",
        "Recruiter in Toronto. [f12] Read by LinkedIn. [f7]",
      ],
      facts,
    );
    const sentences = g.kept
      .join(" ")
      .split(/(?<=\])\s+/)
      .filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(4);
  });

  it("marks another person's, zero-padded, or in look-alike brackets drop the sentence", () => {
    expect(kept("Acme is hiring. [f012]")).toEqual([]);
    expect(kept("Acme is hiring. ［f12］")).toEqual([]);
    expect(kept("Acme is hiring. (f12)")).toEqual([]);
    expect(kept("Acme is hiring. [f12][f13]")).toEqual([]);
    expect(kept("Acme is hiring. [x12]")).toEqual([]);
  });

  it("an empty fact list keeps nothing", () => {
    expect(gateBrief(["Acme is hiring. [f12]"], []).kept).toEqual([]);
  });
});

describe("scoreContact: windows", () => {
  const base: ScoreInput = {
    firm: "Acme",
    where: null,
    hiring: null,
    placed: null,
    contacted: null,
  };
  const points = (s: ScoreInput, today: string) => scoreContact(s, new Date(today)).score;

  // Was a bug: monthsBefore rolls Feb 29 minus 12 months to Mar 1, so a contact exactly 12 months back falls outside.
  it("on a leap day, exactly 12 months back is still inside the contacted window", () => {
    expect(
      points({ ...base, contacted: { on: "2027-02-28", crmId: 1 } }, "2028-02-29T12:00:00Z"),
    ).toBe(POINTS.unknown + POINTS.contactedRecently);
  });
});

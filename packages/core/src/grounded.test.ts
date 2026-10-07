/**
 * The facts guard on synthetic drafts. The flagged cases copy the shapes of real LinkedIn comment
 * drafts it was built for (2026-10-07), with every name, place and number changed.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FACTS } from "./facts.js";
import {
  claimIn,
  droppedWhy,
  type Grounding,
  groundingFlags,
  guardDraft,
  guardParts,
  numbersIn,
} from "./grounded.js";

const on = (post: string, own: string[] = []): Grounding => ({
  facts: DEFAULT_FACTS,
  sources: [post],
  own,
});
const kinds = (draft: string, g: Grounding) => groundingFlags(draft, g).map((f) => f.kind);

describe("made up: flagged", () => {
  const cases: [string, string, string, ("claim" | "number")[]][] = [
    [
      "a team built for a client",
      "A sitter covered the weekend and the family paid one rate.",
      "We built a scheduling tool for a sitter agency and stepped in when overtime hit 38 hours.",
      ["claim", "number"],
    ],
    [
      "revenue math from nowhere",
      "One of my clients sold their firm for $12M. They still call me.",
      "If a recruiter bills 180k a year, a team of 15 is 2.7M. Most firms never do that math.",
      ["number", "number", "number"],
    ],
    [
      "a life story",
      "Talked to a class of students about careers in sales today.",
      "When I graduated, maybe 4% of my class went into sales. Now it feels like 30.",
      ["claim", "number", "number"],
    ],
    [
      "a year the post never says",
      "Remote contract role, long term, strong benefits.",
      "Contract roles have changed a lot since 2014.",
      ["number"],
    ],
    [
      "a Wren result",
      "Nine years of phone screens taught me where candidates drop.",
      "At Wren, we built a voice screener that cut no-shows by 35%. We tried text first.",
      ["claim", "claim", "number"],
    ],
    [
      "a team abroad",
      "We're growing our business development team in a new city.",
      "I built a sales team in a new city once. We paid 90,000 a year and it took six months.",
      ["claim", "claim", "number"],
    ],
    [
      "our clients",
      "Most agencies chase new logos and forget the old ones.",
      "Our clients see the most money from people they already placed.",
      ["claim"],
    ],
    [
      "in my experience",
      "Follow-up is where deals die.",
      "In my experience the second call matters more than the first.",
      ["claim"],
    ],
  ];
  for (const [name, post, draft, want] of cases)
    it(name, () => {
      expect(kinds(draft, on(post))).toEqual(want);
    });
});

describe("grounded: passes", () => {
  const cases: [string, string, string, string[]?][] = [
    [
      "a question",
      "Most candidates ghost after the first call.",
      "Which step loses more of them: the first call or the wait after it?",
    ],
    [
      "the post's own numbers",
      "Over 4 in 5 people who start in agency recruiting leave within 2 years.",
      "If 4 in 5 leave inside 2 years, the real cost is the ramp, not the fee.",
    ],
    [
      "the same number written another way",
      "The deal closed at $1.5 million.",
      "1.5M is a lot of trust to earn on one hire.",
    ],
    [
      "a fact he gave",
      "Old leads sit in every CRM.",
      "I built a lead reactivation tool for old CRM contacts.",
    ],
    [
      "a reaction to the post",
      "Speed to lead matters more than the script.",
      "I liked the point on speed. I wondered how they measure it.",
    ],
    [
      "idioms are not numbers",
      "B2B staffing runs on trust.",
      "B2B buyers want 24/7 answers and 1:1 calls.",
    ],
    [
      "his own words back it",
      "How do you handle the inbox?",
      "I built the inbox tool myself, so it bends to the job.",
      ["I built the inbox tool myself."],
    ],
    ["saying nothing", "Anything.", ""],
  ];
  for (const [name, post, draft, own] of cases)
    it(name, () => {
      expect(groundingFlags(draft, on(post, own))).toEqual([]);
    });

  it("no facts: no first-person claim at all", () => {
    expect(
      kinds("I built a lead reactivation tool for old CRM contacts.", {
        facts: [],
        sources: ["Old leads sit in every CRM."],
      }),
    ).toEqual(["claim"]);
  });
});

describe("pieces", () => {
  it("reads numbers as values", () => {
    expect(numbersIn("$30M, 30 million, 1,200 and 4.5k").map((n) => n.value)).toEqual([
      30e6, 30e6, 1200, 4500,
    ]);
    expect(numbersIn("B2B, H1B, Q4 and 24/7")).toEqual([]);
  });

  it("finds a claim, leaves a reaction", () => {
    expect(claimIn("We've finally shipped it.")).toBeTruthy();
    expect(claimIn("I'm building the same thing.")).toBeTruthy();
    expect(claimIn("I loved this.")).toBeNull();
    expect(claimIn("You built a good team.")).toBeNull();
  });
});

describe("guardDraft", () => {
  const g = on("Old leads sit in every CRM.");
  const model = (...answers: string[]) => {
    const notes: (string | null)[] = [];
    const attempt = async (fix: string | null) => {
      notes.push(fix);
      const text = answers.shift() ?? "";
      return { text, result: text };
    };
    return { attempt, notes };
  };

  it("clean: one ask", async () => {
    const m = model("Which old leads answer first?");
    const out = await guardDraft(m.attempt, g);
    expect(out).toMatchObject({ outcome: "clean", text: "Which old leads answer first?" });
    expect(m.notes).toEqual([null]);
  });

  it("flagged once: asked again with what was flagged", async () => {
    const m = model("We booked 14 meetings from old leads.", "Which old leads answer first?");
    const out = await guardDraft(m.attempt, g);
    expect(out).toMatchObject({
      outcome: "redrafted",
      text: "Which old leads answer first?",
      first: "We booked 14 meetings from old leads.",
    });
    expect(m.notes[1]).toContain("We booked 14 meetings");
    expect(m.notes[1]).toContain("a number from nowhere: 14");
  });

  it("flagged twice: dropped, with why", async () => {
    const m = model("We booked 14 meetings.", "We booked 9 meetings.");
    const out = await guardDraft(m.attempt, g);
    expect(out.outcome).toBe("dropped");
    expect(out.text).toBeNull();
    expect(droppedWhy(out)).toMatch(/^made things up: "We booked 9 meetings\."; 9$/);
  });
});

describe("guardParts", () => {
  it("names the part a flag is in, and asks once more", async () => {
    const asked: (string | null)[] = [];
    const g = await guardParts(
      async (fix) => {
        asked.push(fix);
        return {
          parts: fix
            ? [{ label: "post 1", text: "Cut the demo." }]
            : [
                { label: "post 1", text: "Cut the demo." },
                { label: "post 2", text: "It saved 40% of the time." },
              ],
          result: fix ? "second" : "first",
        };
      },
      { facts: [], sources: [], own: ["Cut the demo to the part that matters."] },
    );
    expect(g.flags).toEqual([{ kind: "number", text: "post 2: 40" }]);
    expect(asked[1]).toContain("post 2: 40");
    expect(g.outcome).toBe("redrafted");
    expect(g.text).toBe("Cut the demo.");
    expect(g.result).toBe("second");
  });
});

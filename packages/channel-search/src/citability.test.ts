import { describe, expect, it } from "vitest";
import { citability, passagesOf, scorePassage } from "./citability.js";

const answer =
  "Lead reactivation is a campaign that contacts old leads a company already paid for. According to Gartner, 60% of leads never get a second touch. For example, Acme Staffing reopened 1,200 people in 2025 using Wren Automation and booked 14 calls. First, the list is cleaned. Second, each person gets a short note that names the role they asked about.";

describe("citability", () => {
  it("scores a definitional, sourced, figure-rich answer above a vague one", () => {
    const strong = scorePassage(answer, "What is lead reactivation?");
    const weak = scorePassage(
      "It is something that they do for them when this happens and that is it, really, and these things just work out over time for those who try it.",
      "More",
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.parts.answer).toBe(30);
    expect(strong.parts.figures).toBeGreaterThan(0);
    expect(weak.grade).toBe("F");
  });

  it("splits llms.txt at headings, dropping link lists and short blocks", () => {
    const md = `# Wren\n\n> ${answer}\n\n## Pages\n\n- [Home](https://x): home\n\n### Short?\n\nToo short.\n\n### What is lead reactivation?\n\n${answer}\n`;
    expect(passagesOf(md).map((p) => p.heading)).toEqual(["Wren", "What is lead reactivation?"]);
    const c = citability(md);
    expect(c.passages).toHaveLength(2);
    expect(c.average).toBeGreaterThan(0);
  });
});

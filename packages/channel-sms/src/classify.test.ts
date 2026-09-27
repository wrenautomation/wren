import { describe, expect, it } from "vitest";
import { ground } from "./classify.js";

const s = { reply: "Sure, what does it cost?", ours: "hi", company: "Acme" };

describe("ground", () => {
  it("applies a grounded label", () => {
    expect(
      ground(
        s,
        { disposition: "interested", evidence: "what does it  COST", confidence: 0.9 },
        null,
      ),
    ).toMatchObject({
      grounded: true,
      disposition: "interested",
    });
  });
  it("refuses invented quotes, foreign labels, low confidence, no proposal", () => {
    expect(
      ground(s, { disposition: "interested", evidence: "yes let's talk", confidence: 0.9 }, null)
        .grounded,
    ).toBe(false);
    expect(
      ground(s, { disposition: "meeting_booked", evidence: "Sure", confidence: 0.9 }, null)
        .grounded,
    ).toBe(false);
    expect(
      ground(s, { disposition: "interested", evidence: "Sure", confidence: 0.5 }, null).grounded,
    ).toBe(false);
    expect(ground(s, null, "no JSON").reason).toBe("no JSON");
  });
});

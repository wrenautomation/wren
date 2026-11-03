import { describe, expect, it } from "vitest";
import { scoredFrom } from "./draft-models.js";

describe("scoredFrom", () => {
  const gen = (text: string, arm: string | null = "cohere", by = "cohere") => ({
    event: "generated",
    via: "model",
    by,
    text,
    arm,
  });
  const step = (event: string, text: string | null = null, via = "person") => ({
    event,
    via,
    by: "w",
    text,
    arm: null,
  });

  it("reads the last model draft and how it ended", () => {
    expect(scoredFrom("c:1", [gen("one"), gen("two", "cohere")])).toMatchObject({
      written: "two",
      armed: true,
      end: { is: "open" },
    });
    expect(scoredFrom("c:1", [gen("one"), step("rejected")])?.end).toEqual({ is: "rejected" });
    expect(scoredFrom("c:1", [gen("one"), step("sent", "one")])?.end).toEqual({
      is: "approved",
      text: "one",
    });
  });

  it("takes the edit when the decision carries no text", () => {
    expect(scoredFrom("c:1", [gen("one"), step("edited", "uno"), step("approved")])?.end).toEqual({
      is: "approved",
      text: "uno",
    });
    expect(scoredFrom("c:1", [gen("one"), step("approved")])?.end).toEqual({
      is: "approved",
      text: "one",
    });
  });

  it("marks a draft with no arm as outside the test, and none for no model draft", () => {
    expect(scoredFrom("c:1", [gen("one", null)])?.armed).toBe(false);
    expect(scoredFrom("c:1", [step("sent", "x")])).toBeNull();
  });
});

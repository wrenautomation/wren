import { describe, expect, it } from "vitest";
import { type Look, settledDraft } from "./look.js";

describe("settledDraft: a save that answers late", () => {
  it("takes what was sent when nothing changed since", () => {
    const from: Look = { preset: "night" } as Look;
    expect(settledDraft(from, from, null)).toBeNull();
  });

  it("keeps the typing done while it saved", () => {
    const from: Look = { preset: "night" } as Look;
    const since: Look = { preset: "paper" } as Look;
    expect(settledDraft(since, from, from)).toBe(since);
  });
});

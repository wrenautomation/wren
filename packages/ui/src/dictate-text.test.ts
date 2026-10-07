import { describe, expect, it } from "vitest";
import { grow, joinDictated, undoable } from "./dictate-text.js";

describe("joinDictated", () => {
  it("spaces and capitalizes from what's around the cursor", () => {
    expect(joinDictated("", "hello there")).toBe("Hello there");
    expect(joinDictated("Hi Dana,", "thanks for the call")).toBe(" thanks for the call");
    expect(joinDictated("Sounds good. ", "see you Monday")).toBe("See you Monday");
    expect(joinDictated("Sounds good.", "see you")).toBe(" See you");
    expect(joinDictated("Line one\n", "next")).toBe("Next");
    expect(joinDictated("Done", ". Talk soon")).toBe(". Talk soon");
    expect(joinDictated("Hi ", "Dana", "thanks")).toBe("Dana ");
    expect(joinDictated("Hi", "  ")).toBe("");
  });
});

describe("one undo per dictation", () => {
  it("grows a run while words follow on, and only undoes untouched text", () => {
    let run = grow(null, 3, " one", "abc one");
    run = grow(run, 7, " two", "abc one two");
    expect(run).toEqual({ start: 3, text: " one two", value: "abc one two" });
    expect(undoable(run, "abc one two")).toBe(true);
    expect(undoable(run, "abc one two!")).toBe(false);
    expect(grow(run, 0, "x", "xabc one two").start).toBe(0);
  });
});

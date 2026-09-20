import { describe, expect, it } from "vitest";
import { editableText, parseEditable } from "./review.js";

describe("editable draft text", () => {
  it("round-trips an opener", () => {
    const text = editableText("quick one", "Hi Jane,\n\nline two");
    expect(text).toBe("Subject: quick one\n\nHi Jane,\n\nline two");
    expect(parseEditable(text, { riding: false })).toEqual({
      subject: "quick one",
      body: "Hi Jane,\n\nline two",
    });
  });

  it("a thread-rider is body only, trailing newlines dropped", () => {
    expect(editableText(null, "bump")).toBe("bump");
    expect(parseEditable("bump\n\n", { riding: true })).toEqual({ subject: null, body: "bump" });
  });

  it("refuses a deleted or empty Subject line", () => {
    expect(() => parseEditable("Hi Jane", { riding: false })).toThrow(/Subject/);
    expect(() => parseEditable("Subject: \n\nHi", { riding: false })).toThrow(/empty/);
    expect(() => parseEditable("Subject: x\nHi", { riding: false })).toThrow(/blank line/);
  });
});

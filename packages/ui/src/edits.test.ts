import { describe, expect, it } from "vitest";
import { wordDiff } from "./edits.js";

const read = (a: string, b: string) =>
  (wordDiff(a, b) ?? [])
    .map((p) => (p.kind === "same" ? p.text : `[${p.kind}:${p.text}]`))
    .join("");

describe("wordDiff", () => {
  it("marks swapped words with their spaces kept", () => {
    expect(read("Hi there, reply STOP.", "Hi friend, reply STOP.")).toBe(
      "Hi [gone:there, ][new:friend, ]reply STOP.",
    );
  });
  it("puts both texts back together", () => {
    const pieces = wordDiff("one two  three\nfour", "one 2 three\nfive six") ?? [];
    expect(
      pieces
        .filter((p) => p.kind !== "new")
        .map((p) => p.text)
        .join(""),
    ).toBe("one two  three\nfour");
    expect(
      pieces
        .filter((p) => p.kind !== "gone")
        .map((p) => p.text)
        .join(""),
    ).toBe("one 2 three\nfive six");
  });
});

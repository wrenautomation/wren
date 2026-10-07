import { describe, expect, it } from "vitest";
import { type CommentExample, examplesBlock, pickExamples, termsOf } from "./examples.js";

const ex = (item: string, about: string, yes: boolean, at: number): CommentExample => ({
  item,
  kind: "comment",
  platform: "youtube",
  yes,
  text: "a draft",
  reason: yes ? null : "voice",
  note: yes ? null : "too stiff",
  about,
  at: new Date(at),
});

describe("pickExamples", () => {
  it("ranks by shared words, then newest, and keeps one no", () => {
    const pool = [
      ex("a", "invoice chasing tools", true, 1),
      ex("b", "hiring a first employee", true, 3),
      ex("c", "chasing late invoice payments", true, 2),
      ex("d", "weather today", false, 0),
    ];
    expect(pickExamples(pool, "chasing an invoice", 2).map((e) => e.item)).toEqual(["c", "d"]);
    expect(pickExamples(pool, "chasing an invoice", 3).map((e) => e.item)).toEqual(["c", "a", "d"]);
    expect(pickExamples(pool, "", 4).map((e) => e.item)).toEqual(["b", "c", "a", "d"]);
  });

  it("drops stop words and short words", () => {
    expect([...termsOf("The QuickBooks of it, and an API!")]).toEqual(["quickbooks", "api"]);
  });

  it("writes a block that says what he did", () => {
    const block = examplesBlock([ex("a", "x", true, 1), ex("b", "y", false, 2)]);
    expect(block).toContain("He sent it.");
    expect(block).toContain('He turned it down: Not my voice ("too stiff").');
    expect(examplesBlock([])).toBe("");
  });
});

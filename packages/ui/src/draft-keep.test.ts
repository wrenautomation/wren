import { describe, expect, it } from "vitest";
import { keepDraft, keptDraft } from "./draft-keep.js";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("kept draft words", () => {
  it("come back over the same saved text", () => {
    const s = memory();
    keepDraft("d1", "Old words", "Old words, edited", s, 1);
    expect(keptDraft("d1", "Old words", s, 2)).toBe("Old words, edited");
  });

  it("drop when the saved draft moved on", () => {
    const s = memory();
    keepDraft("d1", "Old words", "Mine", s, 1);
    expect(keptDraft("d1", "Claude rewrote it", s, 2)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it("drop once the words match what was saved", () => {
    const s = memory();
    keepDraft("d1", "A", "B", s, 1);
    keepDraft("d1", "B", "B ", s, 2);
    expect(s.size()).toBe(0);
    expect(keptDraft("d1", "B", s, 3)).toBeNull();
  });

  it("drop after a week", () => {
    const s = memory();
    keepDraft("d1", "A", "B", s, 0);
    expect(keptDraft("d1", "A", s, 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("survive no storage", () => {
    expect(() => keepDraft("d1", "A", "B", null)).not.toThrow();
    expect(keptDraft("d1", "A", null)).toBeNull();
  });
});

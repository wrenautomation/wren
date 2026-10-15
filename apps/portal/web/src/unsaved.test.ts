import { describe, expect, it } from "vitest";
import { dropUnsaved, keepUnsaved, newRequestId, unsavedOf } from "./unsaved.js";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
};

describe("unsaved typing", () => {
  it("gives back what was typed, with the base it was typed over", () => {
    const s = memory();
    keepUnsaved("doc:1", "7", { title: "Roof " }, s, 1000);
    expect(unsavedOf("doc:1", s, 2000)).toEqual({ base: "7", value: { title: "Roof " }, at: 1000 });
    dropUnsaved("doc:1", s);
    expect(unsavedOf("doc:1", s, 2000)).toBeNull();
  });

  it("drops a copy older than a week, or one that doesn't read", () => {
    const s = memory();
    keepUnsaved("a", "1", "x", s, 0);
    expect(unsavedOf("a", s, 8 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(s.size()).toBe(0);
    s.setItem("wren.unsaved:b", "{not json");
    expect(unsavedOf("b", s)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => keepUnsaved("a", "1", "x", blocked)).not.toThrow();
    expect(unsavedOf("a", blocked)).toBeNull();
    expect(() => dropUnsaved("a", blocked)).not.toThrow();
  });

  it("makes request ids the Worker takes", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(newRequestId()).not.toBe(a);
  });
});

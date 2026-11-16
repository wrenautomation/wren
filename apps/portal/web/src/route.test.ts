// Covers href, navigate and go against a stand-in router. The click rules and `useRoute` need a
// DOM, which these tests don't have; the browser pass covers them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRouter, go, href, navigate } from "./route.js";

type Move = { href: string; replace: boolean; state: { from?: string } };

function setup(pathname: string, search = "", hash = "", state: unknown = null) {
  vi.stubGlobal("location", { pathname, search, hash });
  vi.stubGlobal("history", { state });
  const moves: Move[] = [];
  bindRouter({
    navigate: (m: Move) => {
      moves.push(m);
      return Promise.resolve();
    },
  } as never);
  return { moves };
}

afterEach(() => {
  vi.unstubAllGlobals();
  bindRouter(null);
});

describe("href", () => {
  it("returns the bare path when no param is left", () => {
    expect(href("/a")).toBe("/a");
    expect(href("/a", {})).toBe("/a");
    expect(href("/a", { c: null, d: undefined, e: "" })).toBe("/a");
  });

  it("drops null, undefined and empty; keeps 0, insertion order; encodes", () => {
    expect(href("/a", { b: "1", c: null, d: undefined, e: "" })).toBe("/a?b=1");
    expect(href("/a", { n: 0 })).toBe("/a?n=0");
    expect(href("/a", { b: "2", a: "1" })).toBe("/a?b=2&a=1");
    expect(href("/a", { q: "a b&c" })).toBe("/a?q=a+b%26c");
  });
});

describe("navigate", () => {
  it("adds an entry for a different address, keeping where it came from and the scroll", () => {
    const { moves } = setup("/a");
    navigate("/b");
    expect(moves).toMatchObject([
      { href: "/b", replace: false, state: { from: "/a" }, resetScroll: false },
    ]);
  });

  it("replaces the entry when replace is true, keeping its own from", () => {
    const { moves } = setup("/a", "", "", { from: "/z" });
    navigate("/b", true);
    expect(moves).toMatchObject([{ href: "/b", replace: true, state: { from: "/z" } }]);
  });

  it("replaces when the destination is the current address", () => {
    const { moves } = setup("/a", "?x=1", "#h");
    navigate("/a?x=1#h");
    expect(moves).toMatchObject([{ href: "/a?x=1#h", replace: true, state: {} }]);
  });
});

describe("go", () => {
  it("merges kept params with new ones: a new one wins, null clears, empty drops, repeats stay", () => {
    const { moves } = setup("/a");
    go("/b", { x: "1" });
    go("/b", { z: "9" }, new URLSearchParams("x=1&y=2"));
    go("/b", { x: "9" }, new URLSearchParams("x=1&y=2"));
    go("/b", { x: null }, new URLSearchParams("x=1&y=2"));
    go("/b", {}, new URLSearchParams("tag=a&tag=b"));
    go("/b", {}, new URLSearchParams("q=&y=2"));
    expect(moves.map((m) => m.href)).toEqual([
      "/b?x=1",
      "/b?x=1&y=2&z=9",
      "/b?x=9&y=2",
      "/b?y=2",
      "/b?tag=a&tag=b",
      "/b?y=2",
    ]);
  });
});

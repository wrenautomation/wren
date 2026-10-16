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
  it("returns the bare path when params is omitted", () => {
    expect(href("/a")).toBe("/a");
  });

  it("returns the bare path when params is empty", () => {
    expect(href("/a", {})).toBe("/a");
  });

  it("drops null, undefined and empty-string params", () => {
    expect(href("/a", { b: "1", c: null, d: undefined, e: "" })).toBe("/a?b=1");
  });

  it("returns the bare path when every param is dropped", () => {
    expect(href("/a", { c: null, d: undefined, e: "" })).toBe("/a");
  });

  it("keeps 0 as a real value, not an empty one", () => {
    expect(href("/a", { n: 0 })).toBe("/a?n=0");
  });

  it("keeps insertion order rather than sorting keys", () => {
    expect(href("/a", { b: "2", a: "1" })).toBe("/a?b=2&a=1");
  });

  it("percent/plus-encodes special characters", () => {
    expect(href("/a", { q: "a b&c" })).toBe("/a?q=a+b%26c");
  });
});

describe("navigate", () => {
  it("adds an entry for a different address, keeping where it came from", () => {
    const { moves } = setup("/a");
    navigate("/b");
    expect(moves).toMatchObject([{ href: "/b", replace: false, state: { from: "/a" } }]);
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

  it("keeps the page's scroll", () => {
    const { moves } = setup("/a");
    navigate("/b");
    expect(moves[0]).toMatchObject({ resetScroll: false });
  });
});

describe("go", () => {
  it("navigates with only the given params when nothing is kept", () => {
    const { moves } = setup("/a");
    go("/b", { x: "1" });
    expect(moves[0]?.href).toBe("/b?x=1");
  });

  it("merges kept params with new ones", () => {
    const { moves } = setup("/a");
    go("/b", { z: "9" }, new URLSearchParams("x=1&y=2"));
    expect(moves[0]?.href).toBe("/b?x=1&y=2&z=9");
  });

  it("lets a new param override a kept one of the same key", () => {
    const { moves } = setup("/a");
    go("/b", { x: "9" }, new URLSearchParams("x=1&y=2"));
    expect(moves[0]?.href).toBe("/b?x=9&y=2");
  });

  it("clears a kept param by passing it as null", () => {
    const { moves } = setup("/a");
    go("/b", { x: null }, new URLSearchParams("x=1&y=2"));
    expect(moves[0]?.href).toBe("/b?y=2");
  });

  it("keeps every value of a repeated key", () => {
    const { moves } = setup("/a");
    go("/b", {}, new URLSearchParams("tag=a&tag=b"));
    expect(moves[0]?.href).toBe("/b?tag=a&tag=b");
  });

  it("drops an empty kept param", () => {
    const { moves } = setup("/a");
    go("/b", {}, new URLSearchParams("q=&y=2"));
    expect(moves[0]?.href).toBe("/b?y=2");
  });
});

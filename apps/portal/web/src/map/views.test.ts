// @vitest-environment happy-dom
import type { SavedViewLine } from "@wren/ui";
import { describe, expect, it } from "vitest";
import { foldsOf, isViewOf, mapParamsOf, viewHref } from "./views.js";

const view = (id: number, params: string): SavedViewLine => ({
  id,
  name: `v${id}`,
  params,
  shared: false,
  mine: true,
});

describe("mapParamsOf", () => {
  it("keeps the look, sorts shut plates and folds, drops the rest", () => {
    const q = new URLSearchParams("look=layers&shut=node:b,line:a&window=w1&sv=3");
    const out = mapParamsOf(q, { depth: 2, open: { x: true, b: false, a: true } });
    expect(out).toBe("close=b&depth=2&look=layers&open=a%2Cx&shut=line%3Aa%2Cnode%3Ab");
  });
  it("gives the same string for the same screen, shut in any order", () => {
    const a = mapParamsOf(new URLSearchParams("shut=node:b,node:a"), {});
    const b = mapParamsOf(new URLSearchParams("shut=node:a,node:b"), {});
    expect(a).toBe(b);
  });
});

describe("foldsOf", () => {
  it("is null when the address names no folds", () => {
    expect(foldsOf(new URLSearchParams("look=layers"))).toBeNull();
  });
  it("reads depth, open and close", () => {
    expect(foldsOf(new URLSearchParams("depth=1&open=a,b&close=c"))).toEqual({
      depth: 1,
      open: { a: true, b: true, c: false },
    });
  });
  it("drops a bad depth", () => {
    expect(foldsOf(new URLSearchParams("depth=-2&open=a"))).toEqual({ open: { a: true } });
  });
});

describe("views", () => {
  it("a whole-map view opens / with its look and folds", () => {
    const v = view(7, "depth=1&look=layers&shut=node%3Aa");
    const to = viewHref(v, new URLSearchParams("window=w2&focus=x"));
    const q = new URLSearchParams(to.split("?")[1]);
    expect(to.startsWith("/?")).toBe(true);
    expect(Object.fromEntries(q)).toEqual({
      window: "w2",
      sv: "7",
      look: "layers",
      shut: "node:a",
      depth: "1",
    });
  });
  it("a view without folds still clears the kept folds", () => {
    const q = new URLSearchParams(
      viewHref(view(8, "look=layers"), new URLSearchParams()).split("?")[1],
    );
    expect(foldsOf(q)).toEqual({ open: {} });
  });
  it("a view with parts is never the whole map on screen", () => {
    expect(isViewOf(view(1, "parts=line%3Aa"), "")).toBe(false);
  });
  it("matches the screen it was saved from", () => {
    const now = mapParamsOf(new URLSearchParams("look=layers"), { depth: 1 });
    expect(isViewOf(view(2, now), now)).toBe(true);
    expect(isViewOf(view(2, now), mapParamsOf(new URLSearchParams(), { depth: 1 }))).toBe(false);
  });
});

// Covers href, navigate and go. The click rules and `useRoute` need a DOM, which these tests
// don't have; the browser pass covers them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { go, href, navigate } from "./route.js";

function setup(pathname: string, search = "", hash = "") {
  const loc = { pathname, search, hash };
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const dispatched: Event[] = [];
  vi.stubGlobal("location", loc);
  vi.stubGlobal("history", { pushState, replaceState });
  vi.stubGlobal("dispatchEvent", (e: Event) => {
    dispatched.push(e);
    return true;
  });
  return { loc, pushState, replaceState, dispatched };
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("pushes a new history entry for a different address", () => {
    const { pushState, replaceState } = setup("/a", "", "");
    navigate("/b");
    expect(pushState).toHaveBeenCalledWith(null, "", "/b");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("replaces instead of pushing when replace is true", () => {
    const { pushState, replaceState } = setup("/a", "", "");
    navigate("/b", true);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/b");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("replaces instead of pushing when the destination is the current address", () => {
    const { pushState, replaceState } = setup("/a", "?x=1", "#h");
    navigate("/a?x=1#h");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/a?x=1#h");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("dispatches a wren:route event either way", () => {
    const { dispatched } = setup("/a", "", "");
    navigate("/b");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("wren:route");
  });
});

describe("go", () => {
  it("navigates with only the given params when nothing is kept", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", { x: "1" });
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?x=1");
  });

  it("merges kept params with new ones", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", { z: "9" }, new URLSearchParams("x=1&y=2"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?x=1&y=2&z=9");
  });

  it("lets a new param override a kept one of the same key", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", { x: "9" }, new URLSearchParams("x=1&y=2"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?x=9&y=2");
  });

  it("clears a kept param by passing it as null", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", { x: null }, new URLSearchParams("x=1&y=2"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?y=2");
  });

  it("keeps every value of a repeated key", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", {}, new URLSearchParams("tag=a&tag=b"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?tag=a&tag=b");
  });

  it("drops an empty kept param", () => {
    const { pushState } = setup("/a", "", "");
    go("/b", {}, new URLSearchParams("q=&y=2"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/b?y=2");
  });
});

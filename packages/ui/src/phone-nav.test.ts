import { describe, expect, it } from "vitest";
import {
  backOf,
  barOf,
  MORE,
  rubber,
  settle,
  stepTo,
  swipeEnd,
  tabOfPage,
  tapOf,
} from "./phone-nav.js";

const page = (id: string, group?: string) => ({ id, label: id, href: `/app/${id}`, group });

describe("barOf", () => {
  it("makes one tab per run of pages", () => {
    const { tabs, more } = barOf([page("a"), page("b", "G"), page("c", "G"), page("d")], undefined);
    expect(tabs.map((t) => [t.id, t.label, t.holds])).toEqual([
      ["a", "a", ["a"]],
      ["b", "G", ["b", "c"]],
      ["d", "d", ["d"]],
    ]);
    expect(more).toEqual([]);
  });

  it("puts what doesn't fit under More", () => {
    const { tabs, more } = barOf(
      ["a", "b", "c", "d", "e", "f"].map((id) => page(id)),
      undefined,
    );
    expect(tabs.map((t) => t.id)).toEqual(["a", "b", "c", MORE]);
    expect(more.map((p) => p.id)).toEqual(["d", "e", "f"]);
  });

  it("gives a lone leftover page its own slot", () => {
    const { tabs, more } = barOf(
      ["a", "b", "c", "d"].map((id) => page(id)),
      [
        { id: "a", label: "A", icon: "home", href: "/app/a", holds: [] },
        { id: "b", label: "B", icon: "home", href: "/app/b", holds: [] },
        { id: "c", label: "C", icon: "home", href: "/app/c", holds: [] },
      ],
    );
    expect(tabs.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(more).toEqual([]);
  });

  it("drops picks for pages he can't see", () => {
    const { tabs } = barOf(
      [page("a")],
      [
        { id: "x", label: "X", icon: "home", href: "/app/x", holds: [] },
        { id: "a", label: "A", icon: "home", href: "/app/a", holds: [] },
      ],
    );
    expect(tabs.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("tabOfPage", () => {
  const { tabs } = barOf(
    ["a", "b", "c", "d", "e"].map((id) => page(id)),
    undefined,
  );
  it("finds the tab holding a page, More included", () => {
    expect(tabOfPage(tabs, "b", undefined)).toBe("b");
    expect(tabOfPage(tabs, "e", undefined)).toBe(MORE);
  });
  it("keeps the last tab for a page no tab holds", () => {
    expect(tabOfPage(tabs, "hidden", "b")).toBe("b");
    expect(tabOfPage(tabs, "hidden", undefined)).toBeUndefined();
  });
});

describe("stepTo", () => {
  it("pushes a new page and pops back to one walked before", () => {
    let s = stepTo([], "/a", "A");
    s = stepTo(s, "/a/1", "One");
    s = stepTo(s, "/a/1/x", "X");
    expect(s.map((x) => x.url)).toEqual(["/a", "/a/1", "/a/1/x"]);
    s = stepTo(s, "/a");
    expect(s).toEqual([{ url: "/a", title: "A" }]);
  });
  it("swaps the top for the same page with a new search", () => {
    const s = stepTo(stepTo([], "/a", "A"), "/a?view=late");
    expect(s).toEqual([{ url: "/a?view=late", title: "A" }]);
  });
});

describe("backOf and tapOf", () => {
  it("goes back one step, else where the tab came from", () => {
    const from = { url: "/", title: "Today" };
    expect(backOf([{ url: "/a", title: "A" }], from)).toBe(from);
    expect(backOf([{ url: "/a", title: "A" }], undefined)).toBeUndefined();
    expect(
      backOf(
        [
          { url: "/a", title: "A" },
          { url: "/a/1", title: "" },
        ],
        from,
      )?.url,
    ).toBe("/a");
  });
  it("opens a tab where he left it, pops it, then scrolls up", () => {
    const s = [
      { url: "/a", title: "A" },
      { url: "/a/1", title: "" },
    ];
    expect(tapOf(false, s, "/a", "/b")).toEqual({ go: "/a/1" });
    expect(tapOf(false, undefined, "/a", "/b")).toEqual({ go: "/a" });
    expect(tapOf(true, s, "/a", "/a/1")).toEqual({ go: "/a" });
    expect(tapOf(true, s, "/a", "/a?q=1")).toBe("top");
  });
});

describe("settle", () => {
  it("lands on the stop a throw carries to", () => {
    expect(settle(100, 0, [0, 400, 800])).toBe(0);
    expect(settle(300, 0, [0, 400, 800])).toBe(400);
    expect(settle(300, 2, [0, 400, 800])).toBe(800);
    expect(settle(300, -2, [0, 400, 800])).toBe(0);
  });
});

describe("swipeEnd and rubber", () => {
  it("shuts a short swipe, opens a middling one, runs a long one", () => {
    expect(swipeEnd(-20, 0, 390, 168)).toBe("shut");
    expect(swipeEnd(-100, 0, 390, 168)).toBe("open");
    expect(swipeEnd(-260, 0, 390, 168)).toBe("full");
    expect(swipeEnd(-180, -1.2, 390, 168)).toBe("full");
    expect(swipeEnd(-30, -1.2, 390, 168)).toBe("open");
  });
  it("gives less the further it's pulled", () => {
    expect(rubber(80, 80)).toBe(40);
    expect(rubber(800, 80)).toBeLessThan(80);
  });
});

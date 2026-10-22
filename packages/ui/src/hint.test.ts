/** Hover text: the attributes a caller spreads, where a tip sits, and when it shows. */
import { describe, expect, it } from "vitest";
import { ariaKeys, hintFlow, placeTip, tipProps, whenTip } from "./hint.js";

describe("tipProps", () => {
  it("is the text on the element and for a screen reader, or nothing", () => {
    expect(tipProps("Hi")).toEqual({ "data-tip": "Hi", "aria-description": "Hi" });
    expect(tipProps("")).toEqual({});
    expect(tipProps(undefined)).toEqual({});
    expect(tipProps(null)).toEqual({});
  });

  it("carries a key, a side and a clip", () => {
    expect(tipProps("Hide pages", { keys: "]", side: "right" })).toEqual({
      "data-tip": "Hide pages",
      "data-tip-keys": "]",
      "aria-keyshortcuts": "]",
      "data-tip-side": "right",
      "aria-description": "Hide pages",
    });
    expect(tipProps("Long name", { clip: true })["data-tip-clip"]).toBe("");
  });

  it("is the name, not a description, for an icon alone", () => {
    const p = tipProps("Close", { as: "name", keys: "Esc" });
    expect(p["aria-label"]).toBe("Close");
    expect(p["aria-description"]).toBeUndefined();
    expect(p["aria-keyshortcuts"]).toBe("Escape");
  });

  it("adds nothing for a screen reader when the element already says it", () => {
    expect(tipProps("Close", { as: "none" })).toEqual({ "data-tip": "Close" });
  });
});

describe("ariaKeys", () => {
  it("names the keys the way aria-keyshortcuts does", () => {
    expect(ariaKeys("⌥ ↓")).toBe("Alt+ArrowDown");
    expect(ariaKeys("⌘ K")).toBe("Meta+K");
    expect(ariaKeys("J")).toBe("J");
    expect(ariaKeys("⌘⌥M")).toBe("Meta+Alt+M");
    expect(ariaKeys("⇧⌘Z")).toBe("Shift+Meta+Z");
    expect(ariaKeys("Esc")).toBe("Escape");
  });
});

describe("placeTip", () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 100, height: 24 };
  const at = (left: number, top: number, width = 40, height = 20) => ({ left, top, width, height });

  it("sits below, centered on what it names", () => {
    expect(placeTip(at(480, 100), size, view)).toEqual({ side: "bottom", left: 450, top: 126 });
  });

  it("flips above when there is no room below", () => {
    const p = placeTip(at(480, 780), size, view);
    expect(p.side).toBe("top");
    expect(p.top).toBe(780 - 6 - 24);
  });

  it("stays on a side when neither has room", () => {
    const tall = { width: 100, height: 900 };
    expect(placeTip(at(480, 100), tall, view).side).toBe("bottom");
  });

  it("sits over a thing taller than the view, in sight", () => {
    const p = placeTip(at(480, -50, 40, 2000), size, view);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + size.height).toBeLessThanOrEqual(800 - 8);
  });

  it("keeps clear of the edges", () => {
    expect(placeTip(at(0, 100, 10), size, view).left).toBe(8);
    expect(placeTip(at(995, 100, 4), size, view).left).toBe(1000 - 100 - 8);
  });

  it("opens to the side and flips there too", () => {
    expect(placeTip(at(100, 200), size, view, "right")).toEqual({
      side: "right",
      left: 100 + 40 + 6,
      top: 200 + 10 - 12,
    });
    expect(placeTip(at(950, 200), size, view, "right").side).toBe("left");
  });
});

describe("hintFlow", () => {
  /** A clock and timers the test moves by hand. */
  function rig() {
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const log: string[] = [];
    const flow = hintFlow<string>({
      now: () => now,
      after: (ms, fn) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return () => {
          const i = timers.indexOf(t);
          if (i >= 0) timers.splice(i, 1);
        };
      },
      show: (t) => log.push(`show ${t}`),
      hide: () => log.push("hide"),
    });
    const tick = (ms: number) => {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    };
    return { flow, tick, log };
  }

  it("shows after a rest, not before", () => {
    const { flow, tick, log } = rig();
    flow.aim("a");
    tick(399);
    expect(log).toEqual([]);
    tick(1);
    expect(log).toEqual(["show a"]);
    expect(flow.open).toBe(true);
  });

  it("never shows for a pointer that moves on first", () => {
    const { flow, tick, log } = rig();
    flow.aim("a");
    tick(200);
    flow.aim(null);
    tick(1000);
    expect(log).toEqual([]);
  });

  it("moves to the next at once while one shows, and just after", () => {
    const { flow, tick, log } = rig();
    flow.aim("a");
    tick(400);
    flow.aim("b");
    expect(log).toEqual(["show a", "show b"]);
    flow.aim(null);
    expect(log).toEqual(["show a", "show b", "hide"]);
    tick(200);
    flow.aim("c");
    expect(log.at(-1)).toBe("show c");
    flow.aim(null);
    tick(500);
    flow.aim("d");
    tick(399);
    expect(log.at(-1)).toBe("hide");
    tick(1);
    expect(log.at(-1)).toBe("show d");
  });

  it("a press hides it and keeps it hidden until the pointer leaves", () => {
    const { flow, tick, log } = rig();
    flow.aim("a");
    tick(400);
    flow.dismiss();
    flow.aim("a");
    tick(2000);
    expect(log).toEqual(["show a", "hide"]);
    flow.aim(null);
    flow.aim("a");
    tick(400);
    expect(log.at(-1)).toBe("show a");
  });

  it("a press before the rest ends cancels it", () => {
    const { flow, tick, log } = rig();
    flow.aim("a");
    tick(300);
    flow.dismiss();
    tick(1000);
    expect(log).toEqual([]);
    expect(flow.target).toBe("a");
  });
});

describe("whenTip", () => {
  const d = new Date("2026-09-30T21:08:00Z");

  it("gives the day, the time and the zone, then how long ago", () => {
    expect(whenTip(d, "3 days ago", "America/New_York")).toBe(
      "Sep 30, 2026, 5:08 PM ET · 3 days ago",
    );
    expect(whenTip(d, "in 2 hours", "America/Los_Angeles")).toBe(
      "Sep 30, 2026, 2:08 PM PT · in 2 hours",
    );
  });

  it("leaves the time and zone off a bare day", () => {
    const day = new Date("2026-09-30T04:00:00Z");
    expect(whenTip(day, "3 days ago", "America/New_York")).toBe("Sep 30, 2026 · 3 days ago");
  });
});

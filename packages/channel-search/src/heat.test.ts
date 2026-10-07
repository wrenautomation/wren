import type { SiteEvent } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { rollupHeat } from "./heat.js";

let id = 0;
const ev = (ts: string, view: string, name: string, props: unknown): SiteEvent => ({
  id: ++id,
  ts,
  view,
  visitor: null,
  page: "/agencies",
  name,
  props: typeof props === "string" ? props : JSON.stringify(props),
});
const HERO = "#hero > a:nth-of-type(2)";

describe("heatmap rollup", () => {
  it("counts clicks and rage per path and grid cell, and scroll by the view's deepest point", () => {
    id = 0;
    const { heat, scroll, from } = rollupHeat([
      ev("2026-10-05T10:00:00Z", "v1", "click", { path: HERO, fx: 0.15, fy: 0.95, b: "laptop" }),
      ev("2026-10-05T10:00:01Z", "v1", "click", { path: HERO, fx: 0.19, fy: 0.9, b: "laptop" }),
      ev("2026-10-05T10:00:01Z", "v1", "rage", { path: HERO, fx: 0.19, fy: 0.9, b: "laptop" }),
      ev("2026-10-05T10:00:02Z", "v1", "scroll", { pct: 20, b: "laptop" }),
      ev("2026-10-05T10:01:00Z", "v1", "scroll", { pct: 35, b: "laptop" }),
      ev("2026-10-05T10:02:00Z", "v2", "scroll", { pct: 100, b: "phone" }),
      // Not heat, or not usable: skipped.
      ev("2026-10-05T10:03:00Z", "v2", "cta", { label: "Book" }),
      ev("2026-10-05T10:03:00Z", "v2", "click", { path: HERO, b: "huge" }),
      ev("2026-10-05T10:03:00Z", "v2", "click", "not json"),
      ev("2026-10-06T09:00:00Z", "v3", "click", { path: "body", b: "wide" }),
    ]);
    expect(heat).toContainEqual({
      day: "2026-10-05",
      page: "/agencies",
      width: "laptop",
      path: HERO,
      cell: 91,
      clicks: 2,
      rage: 1,
    });
    // No position: the middle cell.
    expect(heat).toContainEqual(expect.objectContaining({ day: "2026-10-06", cell: 55 }));
    expect(heat).toHaveLength(2);
    const laptop = scroll.filter((r) => r.width === "laptop").map((r) => [r.band, r.views]);
    expect(laptop).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(scroll.filter((r) => r.width === "phone")).toHaveLength(10);
    // The next pass re-reads the newest day from its first event.
    expect(from).toBe(9);
  });

  it("nothing read, no cursor", () => {
    expect(rollupHeat([])).toEqual({ heat: [], scroll: [], from: null });
  });
});

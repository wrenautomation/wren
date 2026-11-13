import { describe, expect, it } from "vitest";
import { routeOf } from "./map-canvas.js";
import { layoutMap, type MapIn, metaOf, offsetOf, titleOf } from "./map-layout.js";

const box = (path: string, parent: string, open = false, count?: number) => ({
  path,
  name: path.split("/").at(-1) ?? path,
  kind: "folder",
  parent,
  open,
  ...(count != null ? { count } : {}),
});

const MAP: MapIn = {
  root: "r",
  boxes: [
    box("r/a", "r", true, 2),
    box("r/a/x", "r/a", false, 4),
    box("r/a/y", "r/a", false, 1),
    box("r/b", "r", false, 9),
  ],
  lines: [
    { id: "l1", from: "r/a/x", to: "r/b", count: 12, rels: { cites: 12 } },
    { id: "l2", from: "r/a/y", to: "r/a/x", count: 1, rels: { backs: 1 } },
    // a box and its own kid: the frame holds it, no line
    { id: "l3", from: "r/a", to: "r/a/x", count: 3, rels: { into: 3 } },
  ],
  inside: { "r/b": 5 },
  outside: {},
};

describe("layoutMap", () => {
  it("nests kids inside their open box and routes lines between shown boxes", async () => {
    const at = await layoutMap(MAP);
    const a = at.boxes["r/a"];
    const x = at.boxes["r/a/x"];
    expect(a && x).toBeTruthy();
    if (!a || !x) return;
    // relative to the open box: inside its frame, under the title
    expect(x.x).toBeGreaterThanOrEqual(0);
    expect(x.y).toBeGreaterThanOrEqual(titleOf(MAP.boxes[0] as never).top);
    expect(x.x + x.width).toBeLessThanOrEqual(a.width);
    expect(Object.keys(at.lines).sort()).toEqual(["l1", "l2"]);
    expect(at.lines.l1?.points.length).toBeGreaterThanOrEqual(2);
    // a count over 1 gets a pill elk keeps clear
    expect(at.lines.l1?.label).toBeTruthy();
    expect(at.lines.l2?.label).toBeUndefined();
    // l2 runs back to an earlier box: laid out forward, its arrow still ends on r/a/x
    const end = at.lines.l2?.points.at(-1);
    const [ax, ay] = [a.x + x.x, a.y + x.y];
    expect(end && end.x >= ax - 1 && end.x <= ax + x.width + 1).toBe(true);
    expect(end && end.y >= ay - 1 && end.y <= ay + x.height + 1).toBe(true);
  });

  it("grows a card for a long name, never cuts it", async () => {
    const long = { ...MAP, boxes: [{ ...box("r/z", "r"), name: "A ".repeat(60) }] };
    const short = { ...MAP, boxes: [box("r/z", "r")] };
    const [l, s] = await Promise.all([
      layoutMap({ ...long, lines: [] }),
      layoutMap({ ...short, lines: [] }),
    ]);
    expect(l.boxes["r/z"]?.height).toBeGreaterThan((s.boxes["r/z"]?.height ?? 0) + 30);
  });
});

describe("metaOf", () => {
  it("says what a card holds, or why it stays closed", () => {
    expect(metaOf(box("r/b", "r", false, 1200), 5)).toBe("1,200 · 5 links inside");
    expect(metaOf({ ...box("r/b", "r"), full: true }, 0)).toMatch(/Too many to draw/);
    expect(metaOf({ ...box("r/b", "r", false, 3), leaf: true }, 1)).toBe("1 link inside");
  });
});

describe("routeOf", () => {
  it("ends the line short of the tip and points the head along the last leg", () => {
    const r = routeOf(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 40 },
      ],
      8,
    );
    expect(r.d.endsWith("L50,32")).toBe(true);
    expect(r.head.startsWith("M50,40")).toBe(true);
    expect(r.d).toContain("Q50,0");
  });
});

describe("layoutMap, a big folder", () => {
  it("spreads its kids into columns, not one tall stack", async () => {
    const n = 30;
    const big: MapIn = {
      root: "r",
      boxes: [
        box("r/a", "r", true, n),
        ...Array.from({ length: n }, (_, i) => box(`r/a/k${i}`, "r/a")),
      ],
      lines: [],
      inside: {},
      outside: {},
    };
    const at = await layoutMap(big);
    const a = at.boxes["r/a"];
    expect(a).toBeTruthy();
    if (!a) return;
    expect(a.width).toBeGreaterThan(a.height / 2);
    const xs = new Set(Array.from({ length: n }, (_, i) => at.boxes[`r/a/k${i}`]?.x));
    expect(xs.size).toBeGreaterThan(2);
  });
});

describe("offsetOf", () => {
  it("moves a route to its right on screen, corners square, the pill with its leg", () => {
    // right, then down
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const out = offsetOf(pts, { x: 50, y: 0 }, 10);
    expect(out.points).toEqual([
      { x: 0, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 100 },
    ]);
    expect(out.label).toEqual({ x: 50, y: 10 });
  });
});

describe("layoutMap, down (a phone)", () => {
  it("puts at most 2 unlinked kids in a row", async () => {
    const n = 5;
    const map: MapIn = {
      root: "r",
      boxes: [
        { path: "r/a", name: "A", kind: "folder", parent: "r", open: true, count: n },
        ...Array.from({ length: n }, (_, i) => ({
          path: `r/a/k${i}`,
          name: `k${i}`,
          kind: "topic",
          parent: "r/a",
          open: false,
        })),
      ],
      lines: [],
      inside: {},
      outside: {},
    };
    const at = await layoutMap(map, "DOWN");
    const ys = Array.from({ length: n }, (_, i) => at.boxes[`r/a/k${i}`]?.y);
    const rows = new Map<number | undefined, number>();
    for (const y of ys) rows.set(y, (rows.get(y) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(2);
    expect(at.width).toBeLessThan(3 * 200);
  });
});

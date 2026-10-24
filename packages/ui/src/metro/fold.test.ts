import { beforeAll, describe, expect, it } from "vitest";
import { autoZoom, capsuleMark, foldScene, twinRuns, viewScene, viewZoom } from "./fold.js";
import {
  boxAt,
  CHIP_H,
  foldWidth,
  labelBoxes,
  markBoxes,
  overlaps,
  sceneClashes,
} from "./geometry.js";
import { layoutView } from "./place.js";
import { DIFF_VIEW, loopZoom, protocolZoom, TWINS_VIEW, ZOOM_SCENE, ZOOM_VIEW } from "./samples.js";
import { allOpen, fullDepth, openSet } from "./tree.js";
import { isCapsule, isMark, type MetroScene } from "./types.js";
import type { MetroView } from "./view.js";

const NONE = new Set<string>();
const at = (nodes: Parameters<typeof openSet>[0], depth: number, open = {}) =>
  openSet(nodes, { depth, open });

describe("composed zooms", () => {
  it("shows no fewer marks one depth deeper, and more with all open", async () => {
    for (const z of [loopZoom(), protocolZoom()]) {
      const full = fullDepth(z.nodes);
      const n = await Promise.all(
        Array.from({ length: full + 1 }, async (_, d) => (await z.scene(at(z.nodes, d))).st.length),
      );
      // A fold tab counts as a mark, so two depths may tie in count and differ in what shows.
      for (let d = 1; d <= full; d++) expect(n[d] ?? 0).toBeGreaterThanOrEqual(n[d - 1] ?? 0);
      expect(n[0] ?? 0).toBeLessThan(n[full] ?? 0);
    }
    const p = protocolZoom();
    expect((await p.scene(allOpen(p.nodes))).st).toHaveLength(p.total);
  });

  it("folds the whole offer to one circle at depth 0", async () => {
    const z = loopZoom();
    const marks = (await z.scene(NONE)).st.filter((s) => isMark(s) || isCapsule(s));
    expect(marks.length).toBeLessThan(LOOP_MIN);
  });

  it("opens one node by hand and adds its marks", async () => {
    const z = protocolZoom();
    const shut = (await z.scene(NONE)).st.length;
    expect((await z.scene(new Set(["wait"]))).st.length).toBeGreaterThan(shut);
  });
});

/** Fewer marks than the loop shows with one node open: the offer folded to one circle. */
const LOOP_MIN = 6;

describe("autoZoom and foldScene", () => {
  const z = autoZoom(ZOOM_SCENE);
  const full = fullDepth(z.nodes);

  it("has a tree, and counts the marks", () => {
    expect(full).toBeGreaterThanOrEqual(1);
    expect(z.total).toBe(ZOOM_SCENE.st.length);
  });

  it("shows every station with every node open", () => {
    expect(foldScene(ZOOM_SCENE, allOpen(z.nodes)).st).toHaveLength(ZOOM_SCENE.st.length);
  });

  it("folds runs into capsules, fewest marks at depth 0", () => {
    const top = foldScene(ZOOM_SCENE, NONE);
    expect(top.st.filter(isCapsule).length).toBeGreaterThan(0);
    expect(top.st.length).toBeLessThan(ZOOM_SCENE.st.length);
  });

  it("never folds a hub in no group, or an exit", () => {
    const keep = ZOOM_SCENE.st
      .filter((s) => isMark(s) && (s.t === "hub" || s.t === "exit"))
      .map((s) => s.id);
    const ids = new Set(foldScene(ZOOM_SCENE, NONE).st.map((s) => s.id));
    for (const id of keep) expect(ids.has(id), id).toBe(true);
  });

  it("keeps every track end on a drawn mark or point", () => {
    const s = foldScene(ZOOM_SCENE, NONE);
    const ids = new Set(s.st.map((m) => m.id));
    for (const t of s.tr) {
      if (t.a && !t.pa) expect(ids.has(t.a), t.a).toBe(true);
      if (t.b && !t.pc) expect(ids.has(t.b), t.b).toBe(true);
    }
  });

  it("drops a track that sits inside one capsule", () => {
    expect(foldScene(ZOOM_SCENE, NONE).tr.length).toBeLessThan(ZOOM_SCENE.tr.length);
  });

  it("keeps an opened node's capsule place, so its fold tab sits where the capsule was", () => {
    const folded = foldScene(ZOOM_SCENE, NONE);
    const cap = folded.st.find(isCapsule);
    if (!cap?.grp) throw new Error("no capsule");
    const open = foldScene(ZOOM_SCENE, new Set([cap.grp]));
    expect(open.st.length).toBeGreaterThan(folded.st.length);
    const [o] = open.opened ?? [];
    expect(o).toMatchObject({ grp: cap.grp, t: cap.n, cap: cap.cap, y: cap.y, l: cap.l });
  });
});

describe("a fold keeps the diff marks", () => {
  let scene: MetroScene;
  beforeAll(async () => {
    scene = foldScene(await layoutView(DIFF_VIEW), NONE);
  });

  it("gives a capsule the mark its stations share, else changed", () => {
    expect(capsuleMark([{ mark: "added" }, { mark: "added" }], [])).toBe("added");
    expect(capsuleMark([{ mark: "added" }, {}], [])).toBe("changed");
    expect(capsuleMark([{}, {}], [{ mark: "removed" }])).toBe("changed");
    expect(capsuleMark([{}, {}], [])).toBeUndefined();
    expect(capsuleMark([{ mark: "removed" }], [])).toBe("removed");
  });

  it("marks the capsule of a folded run", () => {
    const caps = scene.st.filter(isCapsule);
    expect(caps.find((c) => c.id === "web@1")?.mark).toBe("added");
    expect(caps.find((c) => c.id === "gp@1")?.mark).toBe("changed");
  });

  it("keeps the mark of a track that reattaches to a capsule", () => {
    expect(scene.tr.find((t) => t.id === "t-hub-lan")?.mark).toBe("added");
  });
});

describe("viewScene", () => {
  const nodes = viewZoom(ZOOM_VIEW).nodes;
  let full: MetroScene;
  beforeAll(async () => {
    full = await layoutView(ZOOM_VIEW);
  });
  const ids = (sc: { st: readonly { id: string }[] }) => new Set(sc.st.map((s) => s.id));

  it("folds before layout: a fold is a circle in one slot, and the map is narrower", async () => {
    const sc = await viewScene(ZOOM_VIEW, NONE);
    const caps = sc.st.filter(isCapsule);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(c.cap[0]).toBe(c.cap[1]);
    expect(sc.st.length).toBeLessThan(full.st.length);
    expect(sc.w ?? 0).toBeLessThan(full.w ?? 0);
  });

  it("gives a fold its last station's kind and who reached its first and last station", async () => {
    const view = {
      ...ZOOM_VIEW,
      stations: ZOOM_VIEW.stations.map((s, i) => ({ ...s, arrived: 100 - i })),
    };
    const caps = (await viewScene(view, NONE)).st.filter(isCapsule);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.steps).toBeGreaterThan(1);
      expect(c.t).toBeDefined();
      const [a, b] = c.io ?? [0, 0];
      expect(a).toBeGreaterThan(b);
    }
  });

  it("ends every track on a drawn station", async () => {
    for (const d of [0, 1]) {
      const sc = await viewScene(ZOOM_VIEW, at(nodes, d));
      const have = ids(sc);
      for (const t of sc.tr) {
        if (t.a) expect(have.has(t.a)).toBe(true);
        if (t.b) expect(have.has(t.b)).toBe(true);
      }
    }
  });

  it("opens a node by hand with its fold tab clear of every mark", async () => {
    const sc = await viewScene(ZOOM_VIEW, new Set(["rd"]));
    const o = sc.opened?.find((x) => x.grp === "rd");
    expect(o).toBeDefined();
    expect(sc.st.some((s) => s.id === "rd")).toBe(false);
    // The stand-in chip that kept the tab's room is gone.
    for (const s of sc.st.filter(isMark)) expect(s.repGlyph).not.toBe("shrink");
    const tab = boxAt(o?.at[0] ?? 0, o?.at[1] ?? 0, foldWidth(o?.t ?? ""), CHIP_H);
    for (const s of sc.st.filter(isMark))
      for (const b of [...markBoxes(s), ...labelBoxes(s)]) expect(overlaps(tab, b)).toBe(false);
  });

  it("comes back from the cache at once once laid out", async () => {
    const z = viewZoom(ZOOM_VIEW);
    const first = await z.scene(NONE);
    expect(z.scene(new Set(NONE))).toBe(first);
  });
});

describe("side-by-side stations", () => {
  const key = "tpl:post@so@Marketing";
  const z = viewZoom(TWINS_VIEW);
  const deepest = (open: Record<string, boolean> = {}) =>
    z.scene(at(z.nodes, fullDepth(z.nodes), open));

  it("folds a template's stations into one stacked capsule that adds up their people", async () => {
    const fold = (await deepest()).st.find((s) => s.id === key);
    expect(fold && isCapsule(fold)).toBe(true);
    expect(fold).toMatchObject({
      grp: key,
      each: "platforms",
      steps: 4,
      n: "Post",
      s: "LinkedIn, X, YouTube, Instagram",
      io: [42 + 35 + 38 + 31, 3 + 2 + 4 + 1],
    });
  });

  it("keeps an outlier out: TikTok's stuck share departs from the rest", async () => {
    const ids = (await deepest()).st.map((s) => s.id);
    expect(ids).toContain("ptiktok");
    expect(ids).not.toContain("plinkedin");
  });

  it("keeps a twin with a diff mark out of the fold", () => {
    const view = {
      ...TWINS_VIEW,
      stations: TWINS_VIEW.stations.map((s) =>
        s.id === "px" ? { ...s, mark: "changed" as const } : s,
      ),
    };
    expect(
      twinRuns(view)
        .get(key)
        ?.m.map((s) => s.id),
    ).not.toContain("px");
  });

  it("joins tracks once to the fold, and opens by hand to each platform with a tab", async () => {
    const shut = await deepest();
    const ids = new Set(shut.st.map((s) => s.id));
    for (const r of shut.tr) {
      if (r.a) expect(ids.has(r.a)).toBe(true);
      if (r.b) expect(ids.has(r.b)).toBe(true);
    }
    expect(shut.tr.filter((r) => r.a === "pw" && r.b === key)).toHaveLength(1);
    const open = await deepest({ [key]: true });
    expect(open.st.map((s) => s.id)).toContain("plinkedin");
    expect(open.opened?.map((o) => o.grp)).toContain(key);
  });

  it("stays folded at the deepest cut until opened by hand", () => {
    expect(at(z.nodes, fullDepth(z.nodes)).has(key)).toBe(false);
    expect(at(z.nodes, fullDepth(z.nodes), { [key]: true }).has(key)).toBe(true);
  });

  it("folds twins first, so a node folded at depth 0 takes the twins in", async () => {
    const top = await z.scene(NONE);
    expect(top.st.some((s) => s.id === key)).toBe(false);
    expect(top.st.some((s) => s.id === "so@Marketing")).toBe(true);
  });
});

describe("a group of groups across lines", () => {
  const view: MetroView = {
    title: "Content marketing",
    lines: [
      { id: "post", tier: "out" },
      { id: "ads", tier: "out" },
      { id: "gp", offer: "Retainer", tier: "core", colour: 0 },
    ],
    stations: [
      { id: "p1", kind: "att", line: "post", column: "Marketing", label: "Draft", group: "posts" },
      { id: "p2", kind: "att", line: "post", column: "Marketing", label: "Posted", group: "posts" },
      { id: "a1", kind: "att", line: "ads", column: "Marketing", label: "Ad made", group: "paid" },
      { id: "a2", kind: "att", line: "ads", column: "Marketing", label: "Ad live", group: "paid" },
      { id: "hub", kind: "hub", line: "gp", column: "Sales", label: "First touch" },
      { id: "pay", kind: "cash", line: "gp", column: "Money", label: "Paid" },
    ],
    tracks: [
      { from: "p1", to: "p2", by: "system" },
      { from: "a1", to: "a2", by: "system" },
      { from: "p2", to: "hub", by: "system" },
      { from: "a2", to: "hub", by: "system" },
      { from: "hub", to: "pay", by: "person" },
    ],
    groups: [
      { id: "content", label: "Content marketing" },
      { id: "posts", label: "Posts", parent: "content" },
      { id: "paid", label: "Ads", parent: "content" },
    ],
  };
  const z = viewZoom(view);
  const shown = async (d: number) => (await z.scene(at(z.nodes, d))).st.map((s) => s.id);

  it("folds to one circle, then its groups, then their stations, with nothing on top", async () => {
    expect(fullDepth(z.nodes)).toBe(2);
    const top = await shown(0);
    expect(top).toContain("content");
    for (const id of ["posts", "paid", "p1", "a1"]) expect(top).not.toContain(id);
    const mid = await shown(1);
    expect(mid).toEqual(expect.arrayContaining(["posts", "paid"]));
    expect(mid).not.toContain("content");
    expect(await shown(2)).toEqual(expect.arrayContaining(["p1", "p2", "a1", "a2"]));
    for (let d = 0; d <= 2; d++) expect(sceneClashes(await z.scene(at(z.nodes, d)))).toEqual([]);
  });
});

describe("the hub in a group", () => {
  const view: MetroView = {
    title: "Top level",
    lines: [
      { id: "post", tier: "out" },
      { id: "gp", offer: "Retainer", tier: "core", colour: 0 },
    ],
    stations: [
      {
        id: "p1",
        kind: "att",
        line: "post",
        column: "Marketing",
        label: "Posted",
        group: "content",
      },
      {
        id: "hub",
        kind: "hub",
        line: "gp",
        column: "Marketing",
        label: "First touch",
        group: "mkt",
      },
      { id: "call", kind: "att", line: "gp", column: "Sales", label: "Call", group: "sales" },
      { id: "pay", kind: "cash", line: "gp", column: "Money", label: "Paid", group: "money" },
    ],
    tracks: [
      { from: "p1", to: "hub", by: "system" },
      { from: "hub", to: "call", by: "person" },
      { from: "call", to: "pay", by: "person" },
    ],
    groups: [
      { id: "mkt", label: "Marketing" },
      { id: "content", label: "Content", parent: "mkt" },
      { id: "sales", label: "Sales" },
      { id: "money", label: "Money", parent: "sales" },
    ],
  };
  const z = viewZoom(view);

  it("folds like any station, onto the line that leaves it", async () => {
    const top = await z.scene(at(z.nodes, 0));
    const ids = top.st.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["mkt", "sales"]));
    for (const id of ["hub", "p1", "call", "pay"]) expect(ids).not.toContain(id);
    expect(top.tr.find((t) => t.a === "mkt")?.l).toBe("gp");
    expect(sceneClashes(top)).toEqual([]);
    expect((await z.scene(allOpen(z.nodes))).st.map((s) => s.id)).toContain("hub");
  });

  it("drops a column whose stations all sit in a fold from another column", async () => {
    const zones = (await z.scene(at(z.nodes, 0))).zones?.map((q) => q[2]);
    expect(zones).not.toContain("Money");
    expect((await z.scene(allOpen(z.nodes))).zones?.map((q) => q[2])).toContain("Money");
  });
});

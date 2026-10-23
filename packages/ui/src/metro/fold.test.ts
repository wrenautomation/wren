import { describe, expect, it } from "vitest";
import {
  autoZoom,
  capsuleMark,
  flagsAt,
  foldScene,
  normalise,
  stepLevel,
  toggleGroup,
  viewScene,
} from "./fold.js";
import { layoutMetro } from "./layout.js";
import {
  DIFF_VIEW,
  loopZoom,
  protocolZoom,
  ZOOM_SCENE,
  ZOOM_VIEW,
  zoomScenario,
} from "./samples.js";
import { isCapsule, isMark } from "./types.js";

describe("flagsAt and normalise", () => {
  const z = protocolZoom();
  it("puts hand changes on top of the level's folds", () => {
    expect(flagsAt(z, 0, { send: true })).toEqual({ send: true });
    expect(flagsAt(z, 1, { sort: false })).toMatchObject({ send: true, wait: true, sort: false });
  });

  it("drops the changes that equal the level", () => {
    expect(normalise(z, 1, { send: true, ab: false })).toEqual({});
    expect(normalise(z, 1, { send: false })).toEqual({ send: false });
  });
});

describe("stepLevel", () => {
  const z = zoomScenario();
  it("stays inside the levels", () => {
    expect(stepLevel(z, 0, -1)).toBe(0);
    expect(stepLevel(z, 0, 1)).toBe(1);
    expect(stepLevel(z, 2, 1)).toBe(2);
    expect(stepLevel(z, 1, 5)).toBe(2);
  });
});

describe("toggleGroup", () => {
  it("jumps to a level when the group says so, and clears hand changes", () => {
    const z = loopZoom();
    expect(toggleGroup(z, { level: 0, open: {} }, "offer", true)).toEqual({ level: 1, open: {} });
  });

  it("opens the groups that open with it", () => {
    const z = protocolZoom();
    const next = toggleGroup(z, { level: 0, open: {} }, "ab", true);
    expect(next.open).toMatchObject({ ab: true, send: true });
  });

  it("keeps a hand change on the level it started from", () => {
    const z = protocolZoom();
    const next = toggleGroup(z, { level: 0, open: {} }, "wait", true);
    expect(next.level).toBe(0);
    expect(next.open).toEqual({ wait: true });
  });

  it("becomes another level when the folds equal that level", () => {
    const z = protocolZoom();
    let s = { level: 0, open: {} as Record<string, boolean> };
    for (const k of ["send", "wait", "sort"]) s = toggleGroup(z, s, k, true);
    expect(s).toEqual({ level: 1, open: {} });
  });

  it("folds a group again", () => {
    const z = protocolZoom();
    const open = toggleGroup(z, { level: 0, open: {} }, "wait", true);
    expect(toggleGroup(z, open, "wait", false)).toEqual({ level: 0, open: {} });
  });
});

describe("composed zooms", () => {
  it("shows no fewer marks at a deeper level, and more at the deepest", () => {
    for (const z of [loopZoom(), protocolZoom()]) {
      const n = [0, 1, 2].map((l) => z.scene(l, {}).st.length);
      // A fold tab counts as a mark, so two levels may tie in count and differ in what shows.
      expect(n[0]).toBeLessThan(n[2] ?? 0);
      expect(n[0] ?? 0).toBeLessThanOrEqual(n[1] ?? 0);
      expect(n[1] ?? 0).toBeLessThanOrEqual(n[2] ?? 0);
      expect(z.names).toHaveLength(3);
    }
    expect(protocolZoom().scene(2, {}).st).toHaveLength(protocolZoom().total);
  });

  it("opens one group by hand and adds its marks", () => {
    const z = protocolZoom();
    expect(z.scene(0, { wait: true }).st.length).toBeGreaterThan(z.scene(0, {}).st.length);
  });
});

describe("autoZoom and foldScene", () => {
  const z = autoZoom(ZOOM_SCENE);

  it("names three levels and counts the marks", () => {
    expect(z.names).toEqual(["Parts", "Groups", "Stations"]);
    expect(z.total).toBe(ZOOM_SCENE.st.length);
  });

  it("shows every station at the deepest level", () => {
    expect(z.scene(2, {})).toBe(ZOOM_SCENE);
  });

  it("folds runs into capsules at the lower levels, fewest at Parts", () => {
    const parts = z.scene(0, {});
    const groups = z.scene(1, {});
    expect(parts.st.filter(isCapsule).length).toBeGreaterThan(0);
    expect(parts.st.length).toBeLessThan(groups.st.length);
    expect(groups.st.length).toBeLessThan(ZOOM_SCENE.st.length);
  });

  it("never folds the hub or an exit", () => {
    const hub = ZOOM_SCENE.st
      .filter((s) => isMark(s) && (s.t === "hub" || s.t === "exit"))
      .map((s) => s.id);
    const ids = new Set(foldScene(ZOOM_SCENE, 0).st.map((s) => s.id));
    for (const id of hub) expect(ids.has(id), id).toBe(true);
  });

  it("keeps every track end on a drawn mark or point", () => {
    const s = foldScene(ZOOM_SCENE, 0);
    const ids = new Set(s.st.map((m) => m.id));
    for (const t of s.tr) {
      if (t.a && !t.pa) expect(ids.has(t.a), t.a).toBe(true);
      if (t.b && !t.pc) expect(ids.has(t.b), t.b).toBe(true);
    }
  });

  it("drops a track that sits inside one capsule", () => {
    expect(foldScene(ZOOM_SCENE, 0).tr.length).toBeLessThan(ZOOM_SCENE.tr.length);
  });

  it("keeps an opened group open", () => {
    const folded = foldScene(ZOOM_SCENE, 0);
    const cap = folded.st.find(isCapsule);
    if (!cap?.grp) throw new Error("no capsule");
    const open = foldScene(ZOOM_SCENE, 0, { [cap.grp]: true });
    expect(open.st.length).toBeGreaterThan(folded.st.length);
  });

  it("keeps the opened group's capsule place, so its fold knob sits where the capsule was", () => {
    const cap = foldScene(ZOOM_SCENE, 0).st.find(isCapsule);
    if (!cap?.grp) throw new Error("no capsule");
    const [o] = foldScene(ZOOM_SCENE, 0, { [cap.grp]: true }).opened ?? [];
    expect(o).toMatchObject({ grp: cap.grp, t: cap.n, cap: cap.cap, y: cap.y, l: cap.l });
  });
});

describe("a fold keeps the diff marks", () => {
  it("gives a capsule the mark its stations share, else changed", () => {
    expect(capsuleMark([{ mark: "added" }, { mark: "added" }], [])).toBe("added");
    expect(capsuleMark([{ mark: "added" }, {}], [])).toBe("changed");
    expect(capsuleMark([{}, {}], [{ mark: "removed" }])).toBe("changed");
    expect(capsuleMark([{}, {}], [])).toBeUndefined();
    expect(capsuleMark([{ mark: "removed" }], [])).toBe("removed");
  });

  it("marks the capsule of a folded run", () => {
    const scene = foldScene(layoutMetro(DIFF_VIEW), 0);
    const caps = scene.st.filter(isCapsule);
    expect(caps.find((c) => c.id === "web@1")?.mark).toBe("added");
    expect(caps.find((c) => c.id === "gp@1")?.mark).toBe("changed");
  });

  it("keeps the mark of a track that reattaches to a capsule", () => {
    const scene = foldScene(layoutMetro(DIFF_VIEW), 0);
    expect(scene.tr.find((t) => t.id === "t-hub-lan")?.mark).toBe("added");
  });
});

describe("viewScene", () => {
  const full = layoutMetro(ZOOM_VIEW);
  const ids = (sc: { st: readonly { id: string }[] }) => new Set(sc.st.map((s) => s.id));
  it("folds before layout: a fold is a circle in one slot, and the map is narrower", () => {
    for (const lv of [0, 1]) {
      const sc = viewScene(ZOOM_VIEW, lv, {});
      const caps = sc.st.filter(isCapsule);
      expect(caps.length).toBeGreaterThan(0);
      for (const c of caps) expect(c.cap[0]).toBe(c.cap[1]);
      expect(sc.st.length).toBeLessThan(full.st.length);
      expect(sc.w ?? 0).toBeLessThan(full.w ?? 0);
    }
  });
  it("ends every track on a drawn station", () => {
    for (const lv of [0, 1]) {
      const sc = viewScene(ZOOM_VIEW, lv, {});
      const have = ids(sc);
      for (const t of sc.tr) {
        if (t.a) expect(have.has(t.a)).toBe(true);
        if (t.b) expect(have.has(t.b)).toBe(true);
      }
    }
  });
  it("opens a group by hand with room above for its fold tab", () => {
    const sc = viewScene(ZOOM_VIEW, 1, { rd: true });
    const o = sc.opened?.find((x) => x.grp === "rd");
    expect(o?.top).toBeDefined();
    expect((o?.top ?? 0) - 38).toBeGreaterThanOrEqual(8);
    expect(sc.st.some((s) => s.id === "rd")).toBe(false);
  });
});

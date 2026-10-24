import { beforeAll, describe, expect, it } from "vitest";
import { focusScene, inPart, nameOf, partOf, STUB, stubsOf } from "./focus.js";
import { layoutView } from "./place.js";
import { WEBINAR_VIEW, ZOOM_SCENE } from "./samples.js";
import { isMark, type MetroScene } from "./types.js";

const ids = (s: MetroScene) => s.st.map((m) => m.id).sort();
const stub = (s: MetroScene, label: string) => s.tr.find((r) => r.stub?.label === label);

describe("focusScene: a line", () => {
  const scene = focusScene(ZOOM_SCENE, { kind: "line", id: "gp" });

  it("keeps only the stations on the line, and the exit that follows them", () => {
    expect(ids(scene)).toEqual(["bk", "held", "k", "lost", "m3", "pay", "prop", "rep"]);
  });

  it("keeps the tracks between kept stations", () => {
    const whole = scene.tr.filter((r) => !r.stub && r.a && r.b);
    expect(whole.map((r) => `${r.a}-${r.b}`).sort()).toEqual([
      "bk-held",
      "held-prop",
      "k-m3",
      "m3-pay",
      "prop-k",
      "prop-lost",
      "rep-bk",
    ]);
  });

  it("turns each track that crosses the edge into a labelled stub", () => {
    const stubs = stubsOf(scene);
    expect(stubs.length).toBeGreaterThan(0);
    for (const s of stubs) expect(s.label).toMatch(/^(from|to) /);
    expect(stubs.some((s) => s.side === "in")).toBe(true);
  });

  it("names the far side by its line, group or station", () => {
    const into = scene.tr.find((r) => r.stub?.side === "in" && r.b === "rep");
    expect(into?.stub?.part).toEqual({ kind: "station", id: "hub" });
    expect(into?.stub?.label).toBe("from First touch");
  });

  it("starts a stub away from the part, on the side it comes from", () => {
    for (const r of scene.tr) {
      if (!r.stub) continue;
      const edge = r.stub.side === "out" ? r.pc : r.pa;
      const home = scene.st.find((m) => m.id === (r.stub?.side === "out" ? r.a : r.b));
      expect(edge, r.id).toBeDefined();
      const dx = (edge?.[0] ?? 0) - (home && isMark(home) ? home.x : 0);
      expect(Math.sign(dx)).toBe(r.stub.side === "out" ? 1 : -1);
      expect(Math.abs(dx)).toBeGreaterThanOrEqual(STUB.reach);
    }
  });

  it("crops to the part, with room for the stub labels", () => {
    expect(scene.w).toBeGreaterThan(0);
    for (const m of scene.st) {
      if (!isMark(m)) continue;
      expect(m.x).toBeGreaterThanOrEqual(scene.x0 ?? 0);
      expect(m.x).toBeLessThanOrEqual((scene.x0 ?? 0) + (scene.w ?? 0));
    }
    for (const r of scene.tr) {
      if (!r.stub) continue;
      const tip = r.stub.side === "out" ? r.pc : r.pa;
      expect(tip?.[0] ?? 0).toBeGreaterThanOrEqual(scene.x0 ?? 0);
      expect(tip?.[0] ?? 0).toBeLessThanOrEqual((scene.x0 ?? 0) + (scene.w ?? 0));
    }
  });
});

describe("focusScene: a group", () => {
  it("keeps the group's stations and stubs the rest", () => {
    const scene = focusScene(ZOOM_SCENE, { kind: "group", id: "rd" });
    expect(ids(scene)).toEqual(["r1", "r2", "r3"]);
    const out = scene.tr.filter((r) => r.stub?.side === "out");
    expect(out).toHaveLength(1);
    expect(out[0]?.stub?.label).toBe("to First touch");
  });

  it("calls a neighbour in another group by that group", () => {
    const scene = focusScene(ZOOM_SCENE, { kind: "group", id: "rd" });
    expect(scene.tr.some((r) => r.stub?.part.kind === "station")).toBe(true);
  });
});

describe("focusScene: a set of parts", () => {
  const scene = focusScene(ZOOM_SCENE, [
    { kind: "group", id: "rd" },
    { kind: "station", id: "hub" },
  ]);
  it("keeps the stations of every part", () => {
    expect(ids(scene)).toEqual(["hub", "r1", "r2", "r3"]);
  });

  it("joins two parts by their track, with no stub between them", () => {
    expect(stubsOf(scene).some((s) => s.label === "to First touch")).toBe(false);
    expect(scene.tr.some((r) => !r.stub && r.b === "hub")).toBe(true);
  });

  it("names the set by its parts", () => {
    expect(scene.title).toBe("Focus: Reddit + First touch");
  });

  it("is the same scene as one part when the set holds one", () => {
    const one = { kind: "group", id: "rd" } as const;
    expect(focusScene(ZOOM_SCENE, [one])).toEqual(focusScene(ZOOM_SCENE, one));
  });
});

describe("focusScene: a station", () => {
  const scene = focusScene(ZOOM_SCENE, { kind: "station", id: "bk" });
  it("keeps one station and a stub for each track", () => {
    expect(ids(scene)).toEqual(["bk"]);
    expect(scene.tr.every((r) => r.stub)).toBe(true);
    expect(
      stubsOf(scene)
        .map((s) => s.label)
        .sort(),
    ).toEqual(["from Replied", "to Call held"]);
  });

  it("clicks through to the stations on either side", () => {
    expect(stubsOf(scene).map((s) => s.part)).toContainEqual({ kind: "station", id: "held" });
  });
});

describe("focusScene: a flow", () => {
  let whole: MetroScene;
  let scene: MetroScene;
  beforeAll(async () => {
    whole = await layoutView(WEBINAR_VIEW);
    scene = focusScene(whole, { kind: "flow", id: "Webinar funnel" });
  });
  it("keeps the stations of the flow, in the same places", () => {
    expect(ids(scene)).toEqual(["att", "lan", "tix"]);
    for (const m of scene.st) expect(m).toEqual(whole.st.find((w) => w.id === m.id));
  });

  it("joins the flow to what it feeds and what feeds it", () => {
    expect(stub(scene, "from First touch")?.stub?.part).toEqual({ kind: "station", id: "hub" });
    expect(stubsOf(scene).some((s) => s.side === "out")).toBe(true);
  });
});

describe("focusScene: edges", () => {
  it("is pure: the scene it reads is not changed", () => {
    const before = JSON.stringify(ZOOM_SCENE);
    focusScene(ZOOM_SCENE, { kind: "line", id: "gp" });
    expect(JSON.stringify(ZOOM_SCENE)).toBe(before);
  });

  it("draws nothing for a part that is not there", () => {
    const scene = focusScene(ZOOM_SCENE, { kind: "line", id: "nope" });
    expect(scene.st).toEqual([]);
    expect(scene.tr).toEqual([]);
  });

  it("staggers stubs that leave one station so they do not overlap", () => {
    const scene = focusScene(ZOOM_SCENE, { kind: "station", id: "hub" });
    const outs = scene.tr.filter((r) => r.stub?.side === "out").map((r) => r.pc?.[1]);
    expect(new Set(outs).size).toBe(outs.length);
  });

  it("gives each stub a track id", () => {
    const scene = focusScene(ZOOM_SCENE, { kind: "line", id: "gp" });
    const tid = scene.tr.map((r) => r.id).filter(Boolean);
    expect(new Set(tid).size).toBe(tid.length);
  });
});

describe("inPart, partOf, nameOf", () => {
  const rep = ZOOM_SCENE.st.find((m) => m.id === "rep");
  const r1 = ZOOM_SCENE.st.find((m) => m.id === "r1");
  it("reads line, group, flow and id", () => {
    if (!rep || !r1) throw new Error("fixture");
    expect(inPart(rep, { kind: "line", id: "gp" })).toBe(true);
    expect(inPart(rep, { kind: "line", id: "rd" })).toBe(false);
    expect(inPart(r1, { kind: "group", id: "rd" })).toBe(true);
    expect(inPart(r1, { kind: "station", id: "r1" })).toBe(true);
    expect(inPart(r1, { kind: "flow", id: "x" })).toBe(false);
  });

  it("stands for itself when it has no such part", () => {
    if (!rep) throw new Error("fixture");
    expect(partOf(rep, "group")).toEqual({ kind: "station", id: "rep" });
    expect(partOf(rep, "line")).toEqual({ kind: "line", id: "gp" });
  });

  it("names a part as the scene does", () => {
    expect(nameOf(ZOOM_SCENE, { kind: "line", id: "gp" })).toBe("Growth Partner");
    expect(nameOf(ZOOM_SCENE, { kind: "group", id: "rd" })).toBe("Reddit");
    expect(nameOf(ZOOM_SCENE, { kind: "station", id: "bk" })).toBe("Call booked");
  });
});

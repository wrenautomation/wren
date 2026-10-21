/**
 * Focus: draw one part of the map and nothing else. A part is a line, a group, a station or a flow.
 * Tracks that cross its edge stay as faded stubs, each labelled with where it comes from or goes
 * to. A click on a stub names the part on the far side (`MetroPart`), so the caller can focus it.
 *
 * Pure. Works on scenes whose marks name their line (`ln`), group (`g`) or flow, and whose tracks
 * join marks (`a`, `b`): scenes from `layoutMetro`, and the zoom scene. Hand-composed scenes whose
 * tracks run on points hold no such link, so focus cannot cut them.
 */
import { textWidth } from "./geometry.js";
import {
  isBadge,
  isCapsule,
  isMark,
  isRing,
  type MetroPart,
  type MetroScene,
  type MetroTrack,
  type Point,
  type SceneStation,
} from "./types.js";

/** What to focus: the same shape as a part. */
export type FocusSpec = MetroPart;
export type { MetroPart };

/** How far a stub reaches from the edge of its part, and the gap between stubs on one station. */
export const STUB = { reach: 90, gap: 26, pad: 24 } as const;

const lineOf = (s: SceneStation): string | undefined => (isMark(s) ? s.ln : s.l);
const groupOf = (s: SceneStation): string | undefined => (isMark(s) ? s.g : s.grp);
const flowOf = (s: SceneStation): string | undefined => (isMark(s) ? s.flow : undefined);

/** The station is in the part. */
export function inPart(s: SceneStation, spec: FocusSpec): boolean {
  switch (spec.kind) {
    case "line":
      return lineOf(s) === spec.id;
    case "group":
      return groupOf(s) === spec.id;
    case "flow":
      return flowOf(s) === spec.id;
    case "station":
      return s.id === spec.id;
  }
}

/**
 * The part a station stands for from outside, at the grain of `kind`: a station in a group is
 * "that group" when you focus a group. A station with no such part stands for itself.
 */
export function partOf(s: SceneStation, kind: FocusSpec["kind"]): MetroPart {
  const id = kind === "line" ? lineOf(s) : kind === "group" ? groupOf(s) : flowOf(s);
  return id && kind !== "station" ? { kind, id } : { kind: "station", id: s.id };
}

/** The name of a part, as the scene calls it. */
export function nameOf(scene: MetroScene, part: MetroPart): string {
  if (part.kind === "line") return scene.lines?.[part.id]?.n ?? part.id;
  if (part.kind === "group") return scene.groups?.[part.id] ?? part.id;
  if (part.kind === "flow") return part.id;
  const s = scene.st.find((m) => m.id === part.id);
  return (s && "n" in s && s.n) || part.id;
}

const centre = (s: SceneStation): Point => [
  isCapsule(s) ? (s.x ?? (s.cap[0] + s.cap[1]) / 2) : (s.x ?? 0),
  s.y,
];

/** Width of a stub label in px (11px, semibold) with its padding: the room the crop leaves for it. */
const labelWidth = (t: string) => textWidth(t, 11, true) + 16;

/** The scene with only `spec` drawn, and a stub for each track that crosses its edge. */
export function focusScene(scene: MetroScene, spec: FocusSpec): MetroScene {
  const inside = new Set<string>();
  for (const s of scene.st) if (inPart(s, spec)) inside.add(s.id);

  // An exit follows its source: it joins the part when every track into it starts inside.
  const ends = (r: MetroTrack) => [r.a, r.b].filter((x): x is string => !!x);
  for (const s of scene.st) {
    if (inside.has(s.id) || !isMark(s) || s.t !== "exit") continue;
    const mine = scene.tr.filter((r) => ends(r).includes(s.id));
    const from = mine.flatMap((r) => ends(r).filter((x) => x !== s.id));
    if (from.length && from.every((x) => inside.has(x))) inside.add(s.id);
  }

  const st = scene.st.filter((s) => inside.has(s.id));
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const kept: MetroTrack[] = [];
  const stubs: MetroTrack[] = [];
  const used = new Map<string, number>();
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  const widen = (a: number, b: number) => {
    left = Math.min(left, a);
    right = Math.max(right, b);
  };
  for (const s of st) {
    const [x] = centre(s);
    const half = isCapsule(s) ? (s.cap[1] - s.cap[0]) / 2 + 20 : isBadge(s) || isRing(s) ? 90 : 70;
    widen(x - half, x + half);
  }

  for (const r of scene.tr) {
    const a = r.a && inside.has(r.a);
    const b = r.b && inside.has(r.b);
    if (!r.a && !r.b) {
      // A track on points joins no station: it stays when it is on the focused line.
      if (spec.kind === "line" && r.l === spec.id) kept.push(r);
      continue;
    }
    if ((a || !r.a) && (b || !r.b) && (a || b)) {
      kept.push(r);
      continue;
    }
    if (!a && !b) continue;

    // One end inside: the track becomes a stub that leaves the part.
    const near = byId.get((a ? r.a : r.b) ?? "");
    const far = byId.get((a ? r.b : r.a) ?? "");
    if (!near || !far) continue;
    const side = a ? "out" : "in";
    const [x, y] = centre(near);
    const slot = `${near.id}:${side}`;
    const n = used.get(slot) ?? 0;
    used.set(slot, n + 1);
    const part = partOf(far, spec.kind);
    const label = `${side === "in" ? "from" : "to"} ${nameOf(scene, part)}`;
    const off = (a ? (r.oa ?? r.o) : (r.ob ?? r.o)) ?? 0;
    const edge =
      x +
      (side === "out" ? 1 : -1) *
        ((isCapsule(near) ? (near.cap[1] - near.cap[0]) / 2 : 0) + STUB.reach);
    const tip: Point = [edge, y + off + n * STUB.gap];
    const {
      pts: _pts,
      at: _at,
      who: _who,
      late: _late,
      cond: _cond,
      cat: _cat,
      dot: _dot,
      lab: _lab,
      mv: _mv,
      dots: _dots,
      task: _task,
      k: _k,
      a: _a,
      b: _b,
      oa: _oa,
      ob: _ob,
      o: _o,
      pa: _pa,
      pc: _pc,
      ...rest
    } = r;
    const inner = a
      ? { a: near.id, ...(r.oa !== undefined ? { oa: r.oa } : {}) }
      : { b: near.id, ...(r.ob !== undefined ? { ob: r.ob } : {}) };
    stubs.push({
      ...rest,
      ...inner,
      ...(a ? { pc: tip } : { pa: tip }),
      ...(r.o !== undefined ? { o: r.o } : {}),
      id: r.id ?? `${r.a ?? "p"}-${r.b ?? "p"}`,
      stub: { part, side, label },
    });
    const w = labelWidth(label);
    if (side === "out") widen(tip[0], tip[0] + w);
    else widen(tip[0] - w, tip[0]);
  }

  // Free marks under the stations stay when they sit by a station that stays.
  const bySt = (x: number, y: number) =>
    st.some((s) => {
      const [sx, sy] = centre(s);
      return Math.abs(sx - x) < 130 && Math.abs(sy - y) < 70;
    });
  const x0 = Math.max(0, Math.floor(left - STUB.pad));
  const out: MetroScene = {
    ...scene,
    title: `Focus: ${nameOf(scene, spec)}`,
    x0,
    w: Math.ceil(right + STUB.pad) - x0,
    st,
    tr: [...kept, ...stubs],
    chips: (scene.chips ?? []).filter((c) => bySt(c.x, c.y)),
    frames: (scene.frames ?? []).filter((f) =>
      st.some((s) => {
        const [sx, sy] = centre(s);
        return sx >= f.x && sx <= f.x + f.w && sy >= f.y && sy <= f.y + f.h;
      }),
    ),
    folds: [],
  };
  return st.length ? out : { ...out, x0: 0, w: scene.w ?? 960 };
}

/** The stubs in a focused scene: where each comes from or goes to. */
export function stubsOf(scene: MetroScene) {
  return scene.tr.flatMap((r) => (r.stub ? [r.stub] : []));
}

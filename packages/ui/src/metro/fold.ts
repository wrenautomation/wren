/**
 * Zoom as data (designs/2026-10-23-metro-fold-tree.md). A map's stations sit in a fold tree of any
 * depth (tree.ts): line · column, the shape's groups, stations side by side. A closed node draws as
 * one capsule; an open one as its stations in a frame, with a tab that folds it back.
 *
 * A fold hides stations, never lines. The hub folds like any station; an exit folds with its source. Tracks
 * reattach to the capsule. A late track inside rings it amber; a bad station inside shows as a count.
 */
import { foldAt, foldSteps, foldWidth } from "./geometry.js";
import { type Frame, type PlaceBox, placeMetro } from "./place.js";
import { type FoldNode, openKey } from "./tree.js";
import {
  type CapsuleStation,
  isMark,
  type Mark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type OpenedSpec,
  type Point,
  type SceneStation,
} from "./types.js";
import { DEFAULT_COLUMNS, type MetroView, type ViewStation, type ViewTrack } from "./view.js";

/** The folds a hand-composed scene reads: one flag per node, true when open. */
export type Flags = Readonly<Record<string, boolean | undefined>>;

export interface MetroZoom {
  /** The fold tree. */
  nodes: readonly FoldNode[];
  /** The scene with these nodes open (`openSet`). A view's scene lays out async. */
  scene(open: ReadonlySet<string>): MetroScene | Promise<MetroScene>;
  /** After a fold tab closes a node, the folded mark to pick, when it is not the node's id. */
  foldId?: Readonly<Record<string, string>>;
  /** Marks with every node open, for the count line. */
  total: number;
}

/** Zoom for a hand-composed scene: a tree of fold flags and a `compose` that reads them. */
export function flagZoom(o: {
  nodes: readonly FoldNode[];
  compose: (g: Flags) => MetroScene;
  total: number;
  foldId?: MetroZoom["foldId"];
}): MetroZoom {
  return {
    nodes: o.nodes,
    scene: (open) => o.compose(Object.fromEntries(o.nodes.map((n) => [n.id, open.has(n.id)]))),
    total: o.total,
    ...(o.foldId ? { foldId: o.foldId } : {}),
  };
}

/**
 * The mark of a folded run: the mark all its stations share, else "changed" when anything inside
 * (a station or a track between them) carries one. A fold must not hide a diff.
 */
export function capsuleMark(
  stations: readonly { mark?: Mark | undefined }[],
  tracks: readonly { mark?: Mark | undefined }[],
): Mark | undefined {
  const first = stations[0]?.mark;
  if (first && stations.every((s) => s.mark === first)) return first;
  return [...stations, ...tracks].some((x) => x.mark) ? "changed" : undefined;
}

/** A leaf's path from the map down: the nodes it sits in, outermost first. */
interface Path {
  id: string;
  path: FoldNode[];
}

/**
 * The tree from each leaf's path. A node with fewer than 2 leaves goes; so does a node that holds
 * only one other node (the inner one stays, unless it opens by hand only). Parents follow the paths.
 */
function treeOf(paths: readonly Path[]): { nodes: FoldNode[]; chain: Map<string, string[]> } {
  const count = new Map<string, number>();
  for (const p of paths) for (const n of p.path) count.set(n.id, (count.get(n.id) ?? 0) + 1);
  let kept = paths.map((p) => ({
    id: p.id,
    path: p.path.filter((n) => (count.get(n.id) ?? 0) > 1),
  }));
  // A node and the node right inside it with the same leaves: one of them is enough.
  const drop = new Set<string>();
  for (const { path } of kept)
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [path[i] as FoldNode, path[i + 1] as FoldNode];
      if (count.get(a.id) === count.get(b.id)) drop.add(b.hand && !a.hand ? b.id : a.id);
    }
  kept = kept.map((p) => ({ id: p.id, path: p.path.filter((n) => !drop.has(n.id)) }));
  const nodes = new Map<string, FoldNode>();
  for (const { path } of kept)
    path.forEach((n, i) => {
      if (nodes.has(n.id)) return;
      const parent = path[i - 1]?.id;
      nodes.set(n.id, {
        id: n.id,
        label: n.label,
        ...(parent ? { parent } : {}),
        ...(n.hand ? { hand: true } : {}),
      });
    });
  return {
    nodes: [...nodes.values()],
    chain: new Map(kept.map((p) => [p.id, p.path.map((n) => n.id)])),
  };
}

/** The node a leaf folds into: the outermost closed node on its path, inside open ones. */
const foldOf = (chain: readonly string[] | undefined, open: ReadonlySet<string>) =>
  chain?.find((k) => !open.has(k));

const zoneOf = (scene: MetroScene, x: number) =>
  (scene.zones ?? []).findIndex(([a, b]) => x >= a && x < b);

const titleCase = (s: string) => s.toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** A placed scene's tree: line · zone, then its named groups (`station.g`). */
function sceneTree(scene: MetroScene) {
  return treeOf(
    scene.st.flatMap((s): Path[] => {
      if (!isMark(s) || s.t === "hub" || s.t === "exit" || !s.ln) return [];
      const line = scene.lines?.[s.ln] ?? { n: s.ln, l: s.ln };
      const z = zoneOf(scene, s.x);
      const zone = scene.zones?.[z]?.[2];
      const outer: FoldNode = {
        id: `${s.ln}@${z}`,
        label: line.l === "out" || !zone ? line.n : `${line.n} · ${titleCase(zone)}`,
      };
      const inner: FoldNode[] = s.g ? [{ id: s.g, label: scene.groups?.[s.g] ?? s.g }] : [];
      return [{ id: s.id, path: [outer, ...inner] }];
    }),
  );
}

/** Zoom for a placed scene that names its lines and groups: it folds in place (`foldScene`). */
export function autoZoom(scene: MetroScene): MetroZoom {
  return {
    nodes: sceneTree(scene).nodes,
    scene: (open) => foldScene(scene, open),
    total: scene.st.length,
  };
}

/**
 * A placed scene with its closed nodes folded in place: each one a capsule over its stations. An
 * open node is named in `opened`, so the map can offer to fold it.
 */
export function foldScene(scene: MetroScene, open: ReadonlySet<string>): MetroScene {
  const { nodes, chain } = sceneTree(scene);
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const groups = new Map<string, MarkStation[]>();
  const shown = new Map<string, MarkStation[]>();
  for (const s of scene.st) {
    if (!isMark(s)) continue;
    const path = chain.get(s.id) ?? [];
    const k = foldOf(path, open);
    if (k) groups.set(k, [...(groups.get(k) ?? []), s]);
    for (const o of path) {
      if (o === k) break;
      shown.set(o, [...(shown.get(o) ?? []), s]);
    }
  }
  const lineOf = (s: MarkStation | undefined, k: string) =>
    scene.lines?.[s?.ln ?? ""]?.l ?? s?.ln ?? k;
  // The leaf goes where the capsule's was: under the circle nearest its centre whose name is not
  // below it.
  const opened = [...shown].flatMap(([k, m]): OpenedSpec[] => {
    const first = m[0];
    if (!first) return [];
    const xs = m.filter((s) => s.y === first.y).map((s) => s.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const near = [...m].sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid));
    const under = near.find((s) => s.p !== "down") ?? first;
    return [
      {
        grp: k,
        t: label.get(k) ?? k,
        cap: [Math.min(...xs), Math.max(...xs)],
        y: first.y,
        l: lineOf(first, k),
        at: foldAt(under),
      },
    ];
  });
  const into = new Map<string, string>();
  const caps: CapsuleStation[] = [];
  for (const [k, m] of groups) {
    const first = m[0];
    if (!first) continue;
    const xs = m.map((s) => s.x);
    const ids = new Set(m.map((s) => s.id));
    const inside = scene.tr.filter((r) => r.a && r.b && ids.has(r.a) && ids.has(r.b));
    const mark = capsuleMark(m, inside);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const run = [...m].sort((a, b) => a.x - b.x);
    const last = run[run.length - 1] as MarkStation;
    const bad = m.filter((s) => s.bad).length;
    caps.push({
      id: k,
      grp: k,
      cap: [lo, hi],
      x: (lo + hi) / 2,
      y: first.y,
      l: lineOf(first, k),
      late: inside.some((r) => r.late),
      ...(mark ? { mark } : {}),
      t: last.t,
      ...(last.icon ? { icon: last.icon } : {}),
      steps: m.length,
      ...ioOf(run),
      ...(bad ? { bad } : {}),
      n: label.get(k) ?? k,
    });
    for (const s of m) into.set(s.id, k);
  }
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const cap = new Map(caps.map((c) => [c.id, c]));
  /** The end of a track: the station, or the centre of the circle its run folds into. */
  const end = (id: string | undefined, o: number): Point | undefined => {
    if (!id) return undefined;
    const k = into.get(id);
    const s = byId.get(id);
    if (!k) return s ? [s.x ?? 0, s.y + o] : undefined;
    const c = cap.get(k);
    return c ? [(c.cap[0] + c.cap[1]) / 2, c.y] : undefined;
  };
  const tr = scene.tr.flatMap((r): MetroTrack[] => {
    const ka = r.a ? into.get(r.a) : undefined;
    const kb = r.b ? into.get(r.b) : undefined;
    if (ka && ka === kb) return [];
    if (!ka && !kb) return [r];
    const { pts: _pts, at: _at, dot: _dot, cat: _cat, ...rest } = r;
    const pa = end(r.a, r.oa ?? r.o ?? 0) ?? r.pts?.[0];
    const pc = end(r.b, r.ob ?? r.o ?? 0) ?? r.pts?.[r.pts.length - 1];
    return [{ ...rest, ...(pa ? { pa } : {}), ...(pc ? { pc } : {}) }];
  });
  // A rail's label shows once: on the first track left on it.
  const lead = new Set<string>();
  for (const [i, r] of tr.entries()) {
    if (!r.back || !r.cond) continue;
    const k = `${r.b && into.has(r.b) ? into.get(r.b) : r.b}|${r.cond}|${r.back}`;
    const { condShared: _shared, ...rest } = r;
    tr[i] = lead.has(k) ? { ...rest, condShared: true } : rest;
    lead.add(k);
  }
  const st: SceneStation[] = scene.st.filter((s) => !into.has(s.id)).concat(caps);
  return { ...scene, st, tr, ...(opened.length ? { opened } : {}) };
}

/** People who reached a run's first and last station (else who sit there now), when both say. */
function ioOf(run: readonly { now?: number | undefined; arrived?: number | undefined }[]): {
  io?: [number, number];
} {
  const at = (s: (typeof run)[number] | undefined) => s?.arrived ?? s?.now;
  const a = at(run[0]);
  const b = at(run[run.length - 1]);
  return a !== undefined && b !== undefined ? { io: [a, b] } : {};
}

/** Its fold's chip and look, kept until the layout has placed it. */
interface FoldMeta {
  late: boolean;
  mark?: Mark;
  steps: number;
  io?: [number, number];
  each?: string;
  s?: string;
  bad?: number;
}

/** One run to fold: its name, its steps, and for side-by-side stations what the fold adds up. */
interface Run {
  m: ViewStation[];
  name: string;
  steps?: number;
  each?: { s: string; io?: [number, number]; now?: number; arrived?: number };
}

/**
 * Fold each run into one station in place of its first. Tracks reattach to the fold; one inside it
 * goes; two that now join the same ends are one.
 */
function foldRuns(
  view: MetroView,
  runs: ReadonlyMap<string, Run>,
): { view: MetroView; meta: Map<string, FoldMeta> } {
  const columns = [...(view.columns ?? DEFAULT_COLUMNS)];
  for (const s of view.stations) if (!columns.includes(s.column)) columns.push(s.column);
  const byColumn = (m: readonly ViewStation[]) =>
    [...m].sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column));
  const into = new Map<string, string>();
  const folds = new Map<string, ViewStation>();
  const meta = new Map<string, FoldMeta>();
  for (const [k, { m, name, steps, each }] of runs) {
    const run = byColumn(m);
    const first = run[0];
    // The fold wears its last station's kind; an exit inside counts as bad, not as the kind.
    const last = run.filter((s) => s.kind !== "exit").at(-1) ?? run.at(-1);
    if (!first || !last) continue;
    // A fold that holds the hub sits on the line that leaves it, not on an entry's.
    const on = m.some((s) => s.kind === "hub") ? last : first;
    const ids = new Set(m.map((s) => s.id));
    const spans = [...new Set(m.map((s) => s.column))].filter((c) => c !== first.column);
    const inside = view.tracks.filter((t) => ids.has(t.from) && ids.has(t.to));
    const line = view.lines.find((l) => l.id === on.line);
    const mark = capsuleMark(
      m.map((s) => ({ mark: s.mark ?? line?.mark })),
      inside,
    );
    const fold = {
      steps: steps ?? m.length,
      ...(each
        ? { each: "platforms", ...(each.io ? { io: each.io } : {}) }
        : ioOf(run.filter((s) => s.kind !== "exit"))),
    };
    const bad = m.filter((s) => s.bad).length;
    meta.set(k, {
      late: inside.some((t) => t.late),
      ...(mark ? { mark } : {}),
      ...fold,
      ...(each ? { s: each.s } : {}),
      ...(bad ? { bad } : {}),
    });
    // Under its name: the people inside now.
    const now = m.some((s) => s.now !== undefined)
      ? m.reduce((t, s) => t + (s.now ?? 0), 0)
      : undefined;
    folds.set(k, {
      id: k,
      kind: last.kind,
      ...(last.icon ? { icon: last.icon } : {}),
      line: on.line,
      column: first.column,
      ...(spans.length ? { spans } : {}),
      ...(first.group ? { group: first.group } : {}),
      ...(first.flow ? { flow: first.flow } : {}),
      label: name,
      ...(each
        ? {
            sub: each.s,
            bundle: true,
            ...(each.now !== undefined ? { now: each.now } : {}),
            ...(each.arrived !== undefined ? { arrived: each.arrived } : {}),
          }
        : {
            // Its steps, then the people in it now: the layout makes room for both.
            sub: [foldSteps(fold), now !== undefined ? `${now.toLocaleString("en-US")} now` : null]
              .filter(Boolean)
              .join(" \u00b7 "),
            ...(now !== undefined ? { now } : {}),
          }),
    });
    for (const s of m) into.set(s.id, k);
  }
  const at = (id: string) => into.get(id) ?? id;
  const seen = new Set<string>();
  const tracks = view.tracks.flatMap((t): ViewTrack[] => {
    const from = at(t.from);
    const to = at(t.to);
    if (from === to && from !== t.from) return [];
    if (from === t.from && to === t.to) return [t];
    const pair = `${from}>${to}`;
    if (seen.has(pair)) return [];
    seen.add(pair);
    return [{ ...t, id: t.id ?? `${t.from}-${t.to}`, from, to }];
  });
  // The fold takes the place of the run's first station, so the stations keep their order.
  const first = new Map([...runs].map(([k, r]) => [k, r.m[0]?.id]));
  const stations = view.stations.flatMap((s): ViewStation[] => {
    const k = into.get(s.id);
    if (!k) return [s];
    const f = folds.get(k);
    return f && first.get(k) === s.id ? [f] : [];
  });
  return { view: { ...view, stations, tracks }, meta };
}
/** A twin departs from the rest: stuck share (now over arrived) and how far, with how few people it says nothing. */
export const TWIN_OUTLIER = { margin: 0.25, people: 5 } as const;

/**
 * Stations side by side: one template on one line in one column, a station per platform. A twin
 * with a diff mark (or a track with one) stays out, so a fold never hides a diff; so does a twin
 * whose stuck share departs from the others' by more than the margin.
 */
export function twinRuns(view: MetroView): Map<string, Run> {
  const marked = new Set(view.tracks.filter((t) => t.mark).flatMap((t) => [t.from, t.to]));
  const sets = new Map<string, ViewStation[]>();
  for (const s of view.stations) {
    if (!s.template || s.kind === "hub" || s.kind === "exit") continue;
    const k = `tpl:${s.template}@${s.line}@${s.column}`;
    sets.set(k, [...(sets.get(k) ?? []), s]);
  }
  const share = (m: readonly ViewStation[]) => {
    const a = m.reduce((t, s) => t + (s.arrived ?? 0), 0);
    return a ? m.reduce((t, s) => t + (s.now ?? 0), 0) / a : undefined;
  };
  const runs = new Map<string, Run>();
  for (const [k, all] of sets) {
    const m = all.filter((s) => {
      if (s.mark || marked.has(s.id)) return false;
      const rest = share(all.filter((o) => o !== s));
      const own = share([s]);
      return (
        (s.arrived ?? 0) < TWIN_OUTLIER.people ||
        own === undefined ||
        rest === undefined ||
        Math.abs(own - rest) <= TWIN_OUTLIER.margin
      );
    });
    if (m.length < 2) continue;
    const words = m.map((s) => s.label?.split(" \u00b7 ") ?? []);
    const head = words[0]?.[0];
    const name =
      head && words.every((w) => w.length > 1 && w[0] === head) ? head : (m[0]?.template ?? k);
    const platforms = m.map((s, i) =>
      (words[i]?.length ?? 0) > 1 ? words[i]?.at(-1) : s.platform,
    );
    const sum = (f: (s: ViewStation) => number | undefined) =>
      m.some((s) => f(s) !== undefined) ? m.reduce((t, s) => t + (f(s) ?? 0), 0) : undefined;
    const now = sum((s) => s.now);
    const arrived = sum((s) => s.arrived);
    runs.set(k, {
      m,
      name,
      each: {
        s: platforms.filter(Boolean).join(", "),
        ...(now !== undefined && arrived !== undefined ? { io: [arrived, now] } : {}),
        ...(now !== undefined ? { now } : {}),
        ...(arrived !== undefined ? { arrived } : {}),
      },
    });
  }
  return runs;
}

/** A view with its side-by-side stations folded, each a stacked station: for a layout of its own. */
export const foldTwins = (view: MetroView): MetroView => foldRuns(view, twinRuns(view)).view;

interface ViewTree {
  nodes: FoldNode[];
  /** Each station's path, outermost first. A hub in no group has none. */
  chain: Map<string, string[]>;
  twins: Map<string, Run>;
  /** A twin's node, for the steps a fold counts (one per twin set). */
  twinOf: Map<string, string>;
}

const trees = new WeakMap<MetroView, ViewTree>();

/**
 * A view's fold tree. Outermost first: line · column, the shape's groups (`parent` nests them), the
 * stations side by side. A group sits in the line · column its stations share; one that spans
 * several sits in the map itself. An exit folds with its source.
 */
export function viewTree(view: MetroView): ViewTree {
  const known = trees.get(view);
  if (known) return known;
  const twins = twinRuns(view);
  const twinOf = new Map<string, string>();
  for (const [k, r] of twins) for (const s of r.m) twinOf.set(s.id, k);
  const groups = new Map((view.groups ?? []).map((g) => [g.id, g]));
  /** A group and the groups it sits in, outermost first. A loop ends the walk. */
  const groupPath = (id: string): string[] => {
    const out: string[] = [];
    for (let g: string | undefined = id; g && !out.includes(g); g = groups.get(g)?.parent)
      out.unshift(g);
    return out;
  };
  const lines = new Map(view.lines.map((l) => [l.id, l]));
  const lineCol = (s: ViewStation): FoldNode => {
    const line = lines.get(s.line);
    const n = line?.label ?? s.line;
    return { id: `${s.line}@${s.column}`, label: line?.tier === "out" ? n : `${n} · ${s.column}` };
  };
  // The hub joins every line, so it has no line · column: it folds only inside a group.
  const leaves = view.stations.filter((s) => s.kind !== "exit" && (s.kind !== "hub" || s.group));
  // The line · column each outermost group's stations share, if they share one.
  const shared = new Map<string, FoldNode | null>();
  for (const s of leaves) {
    const top = s.group ? groupPath(s.group)[0] : undefined;
    if (!top || s.kind === "hub") continue;
    const lc = lineCol(s);
    const was = shared.get(top);
    shared.set(top, was === undefined || was?.id === lc.id ? lc : null);
  }
  // A twin set nests only when its stations sit in the same groups.
  const gkey = (s: ViewStation) => (s.group ? groupPath(s.group).join(">") : "");
  const twinOk = new Set(
    [...twins]
      .filter(([, r]) => r.m.every((s) => gkey(s) === gkey(r.m[0] as ViewStation)))
      .map(([k]) => k),
  );
  const paths = new Map<string, FoldNode[]>();
  for (const s of leaves) {
    const gp = s.group ? groupPath(s.group) : [];
    const top = gp[0];
    const lc = top ? shared.get(top) : lineCol(s);
    const t = twinOf.get(s.id);
    paths.set(s.id, [
      ...(lc ? [lc] : []),
      ...gp.map((g) => ({ id: g, label: groups.get(g)?.label ?? g })),
      ...(t && twinOk.has(t) ? [{ id: t, label: twins.get(t)?.name ?? t, hand: true }] : []),
    ]);
  }
  for (const s of view.stations) {
    if (s.kind !== "exit") continue;
    const src = view.tracks.find((t) => t.to === s.id && paths.has(t.from))?.from;
    if (src) paths.set(s.id, paths.get(src) ?? []);
  }
  const { nodes, chain } = treeOf([...paths].map(([id, path]) => ({ id, path })));
  const out = { nodes, chain, twins, twinOf };
  trees.set(view, out);
  return out;
}

/** Laid-out scenes per view, by step and open set: a scene laid out once comes back at once. */
const SCENES = new WeakMap<MetroView, Map<string, MetroScene | Promise<MetroScene>>>();

/** Zoom for a view: each fold folds the view first, then lays it out, so a fold takes one place. */
export function viewZoom(view: MetroView, step?: number): MetroZoom {
  const done = SCENES.get(view) ?? new Map<string, MetroScene | Promise<MetroScene>>();
  SCENES.set(view, done);
  return {
    nodes: viewTree(view).nodes,
    scene: (open) => {
      const k = `${step ?? ""}:${openKey(open)}`;
      const hit = done.get(k);
      if (hit) return hit;
      const p = viewScene(view, open, step).then(
        (s) => {
          done.set(k, s);
          return s;
        },
        (e: unknown) => {
          done.delete(k);
          throw e;
        },
      );
      done.set(k, p);
      return p;
    },
    total: view.stations.length,
  };
}

/**
 * The scene of a view with these nodes open. A closed node is one station when the layout places
 * it, so it takes one step, not the room of its stations; it draws as a round capsule (side by
 * side, a stacked one). An open node in one column is a box: ELK keeps its stations together and
 * the map draws a frame round them, with a tab to fold it. One across columns keeps a faint pill
 * along its first row, with the tab under its first circle.
 */
export async function viewScene(
  view: MetroView,
  open: ReadonlySet<string>,
  step?: number,
): Promise<MetroScene> {
  const { nodes, chain, twins, twinOf } = viewTree(view);
  const by = new Map(nodes.map((n) => [n.id, n]));
  // Open as shown: open, inside open nodes.
  const shows = (k: string | undefined): boolean =>
    !!k && open.has(k) && (!by.get(k)?.parent || shows(by.get(k)?.parent));
  const runs = new Map<string, Run>();
  for (const s of view.stations) {
    const k = foldOf(chain.get(s.id), open);
    if (!k) continue;
    const r = runs.get(k);
    if (r) r.m.push(s);
    else runs.set(k, { m: [s], name: by.get(k)?.label ?? k });
  }
  for (const [k, r] of runs) {
    const twin = twins.get(k);
    if (twin?.each) r.each = twin.each;
    // A twin set counts each station; a larger fold counts the set as one step.
    const real = r.m.filter((s) => s.kind !== "exit");
    r.steps = twin ? real.length : new Set(real.map((s) => twinOf.get(s.id) ?? s.id)).size;
  }
  const folded = foldRuns(view, runs);
  // Where each station now sits: the innermost open node over it.
  const home = new Map<string, string | undefined>();
  for (const s of folded.view.stations) {
    if (folded.meta.has(s.id)) home.set(s.id, by.get(s.id)?.parent);
    else home.set(s.id, chain.get(s.id)?.at(-1));
  }
  const shown = nodes.filter((n) => shows(n.id));
  const columns = new Map(shown.map((n) => [n.id, new Set<string>()]));
  const members = new Map(shown.map((n) => [n.id, [] as ViewStation[]]));
  for (const s of folded.view.stations)
    for (let k = home.get(s.id); k; k = by.get(k)?.parent) {
      columns.get(k)?.add(s.column);
      members.get(k)?.push(s);
    }
  const boxed = new Set(shown.filter((n) => columns.get(n.id)?.size === 1).map((n) => n.id));
  const boxOf = (k: string | undefined): string | undefined => {
    for (let at = k; at; at = by.get(at)?.parent) if (boxed.has(at)) return at;
    return undefined;
  };
  const boxes: PlaceBox[] = [...boxed].map((k) => ({
    id: k,
    parent: boxOf(by.get(k)?.parent),
    stations: folded.view.stations.filter((s) => boxOf(home.get(s.id)) === k).map((s) => s.id),
  }));
  // A pill's tab sits under its first circle: the layout keeps its room, as a repeat chip's.
  const pills = shown.filter((n) => !boxed.has(n.id));
  const leafOn = new Map<string, string>();
  for (const n of pills) {
    const first = members.get(n.id)?.[0];
    if (first && !leafOn.has(first.id)) leafOn.set(first.id, n.id);
  }
  const stations = folded.view.stations.map((s): ViewStation => {
    const k = leafOn.get(s.id);
    return k && !s.repeat
      ? { ...s, repeat: by.get(k)?.label ?? k, repeatIcon: "shrink" as const }
      : s;
  });
  const { scene, frames } = await placeMetro(
    { ...folded.view, stations },
    { boxes, ...(step ? { step } : {}) },
  );
  // The leaf draws on its own: the station drops the stand-in chip that kept its room.
  scene.st = scene.st.map((s) => {
    if (!isMark(s) || !leafOn.has(s.id) || s.repGlyph !== "shrink") return s;
    const { rep: _rep, repGlyph: _glyph, ...rest } = s;
    return rest;
  });
  const lineKey = (ln: string | undefined) => scene.lines?.[ln ?? ""]?.l ?? ln ?? "";
  const placed = new Map(scene.st.map((s) => [s.id, s]));
  const opened = shown.flatMap((n): OpenedSpec[] => {
    const m = (members.get(n.id) ?? [])
      .map((s) => placed.get(s.id))
      .filter((s): s is MarkStation => !!s && isMark(s));
    const first = m[0];
    if (!first) return [];
    const t = n.label;
    const f: Frame | undefined = frames.get(n.id);
    if (f)
      return [
        {
          grp: n.id,
          t,
          cap: [f[0], f[2]],
          y: (f[1] + f[3]) / 2,
          l: lineKey(first.ln),
          at: [f[0] + foldWidth(t) / 2 + 6, f[1] + 15],
          box: f,
        },
      ];
    // The pill runs along the first station's row.
    const xs = m.filter((s) => s.y === first.y).map((s) => s.x);
    const leaf = m.find((s) => leafOn.get(s.id) === n.id) ?? first;
    return [
      {
        grp: n.id,
        t,
        cap: [Math.min(...xs), Math.max(...xs)],
        y: first.y,
        l: lineKey(first.ln),
        at: foldAt(leaf),
      },
    ];
  });
  const st = scene.st.map((s): SceneStation => {
    const m = folded.meta.get(s.id);
    if (!m || !isMark(s)) return s;
    return {
      id: s.id,
      grp: s.id,
      cap: [s.x, s.x],
      x: s.x,
      y: s.y,
      l: lineKey(s.ln),
      late: m.late,
      ...(m.mark ? { mark: m.mark } : {}),
      t: s.t,
      ...(s.icon ? { icon: s.icon } : {}),
      steps: m.steps,
      ...(m.io ? { io: m.io } : {}),
      ...(m.each ? { each: m.each } : {}),
      ...(m.s || s.s ? { s: m.s ?? s.s } : {}),
      ...(m.bad ? { bad: m.bad } : {}),
      n: s.n ?? s.id,
      ...(s.p ? { p: s.p } : {}),
    };
  });
  return { ...scene, st, ...(opened.length ? { opened } : {}) };
}

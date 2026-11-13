/**
 * Explorer's contract (designs/2026-11-12-explorer.md): every item has one home path; links join
 * any two items. Each product gives one adapter. Imports only Orrery (pure): the browser, the
 * server and the CLI all run it.
 */

import { type Bundle, bundle, type Fold, type FoldEdge, lift } from "@wrenautomation/orrery";

/** A row in a column. */
export interface Item {
  /** the home path; on an alias row, the route to it (its parent's home and its segment) */
  path: string;
  name: string;
  /** topic, layer, set, line, reference, record, file, folder, relation … */
  kind: string;
  /** one line under the name */
  sub?: string;
  count?: number;
  /** on an alias row: the home path */
  original?: string;
  /** on an alias row: where the home sits, for "from ui-design" */
  from?: string;
  /** on a moved item: the path asked for; the item is what took its place */
  was?: string;
  poster?: string;
  /** a gap or state the row shows: a line's backing, `missing`, `retired` */
  mark?: string;
  /** holds nothing under it */
  leaf?: boolean;
}

/** One relation of an item, one way. */
export interface Link {
  /** the segment of its folder: `backed-by`, `backs`, `cites`, `cited-by`, `used-by` */
  rel: string;
  dir: "out" | "in";
  label: string;
  items: Item[];
}

/** One item whole: what the preview and `cat` show. `data` is the adapter's own shape. */
export interface Whole extends Item {
  body?: string;
  links: Link[];
  data?: unknown;
}

export interface Page {
  items: Item[];
  next?: string;
}

/** One product's tree. Paths in and out are home paths. */
export interface Adapter {
  root: string;
  /** the rows under a home path, one page at a time; relation folders come last */
  children(path: string, after?: string): Promise<Page>;
  /** one row, light; an alias or relation segment resolves: `path` answers the home */
  item(path: string): Promise<Item>;
  whole(path: string): Promise<Whole>;
  find(q: string, under?: string): Promise<Item[]>;
  /** what an export's `.stamp` records: the version it read (a head commit, a ledger time) */
  stamp?(): Promise<Record<string, unknown>>;
  /**
   * every edge with an end under `home`, between home paths, one direction per pair (Map).
   * `open`: the boxes the Map opened; an adapter may skip an edge that costs a read and has both
   * ends in one closed box (it would only count as "inside"). No `open`: every edge.
   */
  edges?(home: string, open?: ReadonlySet<string>): Promise<PathEdge[]>;
}

/** A link between two homes, one way: `member` (an alias's other parent → the item), `backs` … */
export interface PathEdge extends FoldEdge {
  rel: string;
}

export type PathErrorCode = "not-indexed" | "offline" | "unknown-path" | "blind";
const PATH_ERRORS: readonly PathErrorCode[] = ["not-indexed", "offline", "unknown-path", "blind"];

export class PathError extends Error {
  constructor(
    readonly code: PathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PathError";
  }
}

/** A relation folder's label each way. */
export const RELATIONS: Record<string, string> = {
  "backed-by": "Backed by",
  backs: "Backs",
  cites: "Cites",
  "cited-by": "Cited by",
  "used-by": "Used by",
  "grew-from": "Grew from",
  "grew-into": "Grew into",
  applies: "Applies",
  "applied-in": "Applied in",
  "hit-by": "Hit by",
  hits: "Hits",
  into: "Replaced by",
};

export const segments = (path: string) => path.split("/").filter(Boolean);
const lastSegment = (path: string) => segments(path).at(-1) ?? "";
export const parentOf = (path: string) => segments(path).slice(0, -1).join("/");
export const rootOf = (path: string) => segments(path)[0] ?? "";
export const join = (...parts: string[]) => parts.flatMap(segments).join("/");
/** where a row leads: an alias row's home, else its own path */
export const homeOf = (i: Item) => i.original ?? i.path;

/** Rows in one page: Explorer's columns and `ls` read this many at a time. */
export const PAGE_SIZE = 50;

/** A page of rows held in memory, from `after` (an offset). */
export const pageOf = (rows: Item[], after?: string): Page => {
  const from = Number(after ?? 0) || 0;
  const items = rows.slice(from, from + PAGE_SIZE);
  return from + PAGE_SIZE < rows.length ? { items, next: String(from + PAGE_SIZE) } : { items };
};

/** A relation folder row under an item; none when it holds nothing. */
export function relationRow(home: string, rel: string, items: Item[]): Item[] {
  return items.length
    ? [
        {
          path: join(home, rel),
          name: RELATIONS[rel] ?? rel,
          kind: "relation",
          count: items.length,
        },
      ]
    : [];
}

/** An alias row: `target` (a home row) shown under `parent`. */
export function aliasOf(parent: string, target: Item, from?: string): Item {
  return {
    ...target,
    path: join(parent, lastSegment(target.path)),
    original: target.path,
    ...(from ? { from } : {}),
  };
}

/**
 * The row at `path` in its parent's children, pages read in turn. An adapter's `item` falls back
 * on this for any segment it cannot read straight.
 */
export async function itemFromParent(a: Adapter, path: string, pages = 20): Promise<Item> {
  const parent = parentOf(path);
  const seg = lastSegment(path);
  let after: string | undefined;
  for (let i = 0; i < pages; i++) {
    const p = await a.children(parent, after);
    const hit = p.items.find((x) => lastSegment(x.path) === seg);
    if (hit) return hit.original ? { ...hit, path: hit.original } : hit;
    if (!p.next) break;
    after = p.next;
  }
  throw new PathError("unknown-path", `nothing at ${path}`);
}

/** Each relation folder under an item's home, with what it holds; a leaf holds none. */
export async function linksOf(a: Adapter, item: Item): Promise<Link[]> {
  if (item.leaf) return [];
  const rels = (await a.children(homeOf(item))).items.filter((i) => i.kind === "relation");
  return Promise.all(
    rels.map(async (r) => ({
      rel: lastSegment(r.path),
      dir: (["backed-by", "cited-by", "used-by", "grew-into", "applied-in", "hit-by"].includes(
        lastSegment(r.path),
      )
        ? "in"
        : "out") as Link["dir"],
      label: r.name,
      items: (await a.children(r.path)).items,
    })),
  );
}

/** One step of a route: where the route stands and the home it reached. */
export interface Step {
  route: string;
  home: string;
  item: Item;
}
export interface Walked {
  steps: Step[];
  /** the step that failed; the steps before it stand */
  error?: { code: PathErrorCode; message: string; route: string };
}

const codeOf = (e: unknown): PathErrorCode | null =>
  e instanceof PathError
    ? e.code
    : e && typeof e === "object" && "code" in e && PATH_ERRORS.includes(e.code as PathErrorCode)
      ? (e.code as PathErrorCode)
      : null;

/**
 * A route to its homes, one segment at a time: `canon/topics/app-design/sets/ui-design-states/ST-2`
 * reaches ST-2's home under ui-design. An error stops the walk; the steps before it stand.
 * `stop(home)`: the walk ends at that step and `rest` holds the segments left (a home read elsewhere).
 */
export async function walk(
  a: Adapter,
  route: string,
  stop?: (home: string) => boolean,
): Promise<Walked & { rest?: string[] }> {
  const segs = segments(route);
  if (segs[0] !== a.root)
    return {
      steps: [],
      error: { code: "unknown-path", message: `${a.root} holds no ${route}`, route },
    };
  const steps: Step[] = [
    { route: a.root, home: a.root, item: { path: a.root, name: a.root, kind: "root" } },
  ];
  let home = a.root;
  let at: string = a.root;
  for (const [i, seg] of segs.slice(1).entries()) {
    at = join(at, seg);
    try {
      const item = await a.item(join(home, seg));
      home = item.path;
      // moved: the route goes on from the new home; the old name stops here
      if (item.was) at = home;
      steps.push({ route: at, home, item });
      if (stop?.(home)) return { steps, rest: segs.slice(i + 2) };
    } catch (e) {
      const code = codeOf(e);
      if (!code) throw e;
      return { steps, error: { code, message: (e as Error).message, route: at } };
    }
  }
  return { steps };
}

/** A route's columns: each step with its first page of rows, rebased onto the route. */
export interface Column extends Step {
  items: Item[];
  next?: string;
}

/** Rows read under a home, given paths under the route that reached it. */
export const rebase = (route: string, items: Item[]): Item[] =>
  items.map((i) => {
    const path = join(route, lastSegment(i.path));
    return path === i.path ? i : { ...i, path, original: i.original ?? i.path };
  });

/** What a route shows: its columns, and the last item whole for the preview. */
export interface Shown {
  columns: Column[];
  whole?: Whole;
  error?: Walked["error"];
}

// folders show their rows; only the rest open a preview
const FOLDERS = new Set(["root", "area", "layer", "relation", "folder", "type"]);
export const isFolder = (i: Pick<Item, "kind">) => FOLDERS.has(i.kind);

/** Bytes as B, KB or MB: a file row's sub and its page say one size. */
export const sizeLabel = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const columns = async (a: Adapter, route: string): Promise<Shown> =>
  columnsOf(a, await walk(a, route));

/** Each step's first page of rows, then the last item whole when it is no folder. */
async function columnsOf(a: Adapter, w: Walked, whole = true): Promise<Shown> {
  let error = w.error;
  const cols: Column[] = [];
  for (const s of w.steps) {
    if (s.item.leaf) {
      cols.push({ ...s, items: [] });
      continue;
    }
    try {
      const p = await a.children(s.home);
      cols.push({ ...s, items: rebase(s.route, p.items), ...(p.next ? { next: p.next } : {}) });
    } catch (e) {
      const code = codeOf(e);
      if (!code) throw e;
      error ??= { code, message: (e as Error).message, route: s.route };
      break;
    }
  }
  const last = cols.at(-1);
  if (error || !whole || !last || isFolder(last.item))
    return { columns: cols, ...(error ? { error } : {}) };
  try {
    return { columns: cols, whole: await a.whole(last.home) };
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    return { columns: cols, error: { code, message: (e as Error).message, route: last.route } };
  }
}

/** A route's home; a failed step throws its PathError. */
export async function homeAt(a: Adapter, route: string): Promise<string> {
  const w = await walk(a, route);
  if (w.error) throw new PathError(w.error.code, w.error.message);
  return w.steps.at(-1)?.home ?? a.root;
}

/** The rows under any route, an alias route too, with paths under that route. */
export async function childrenAt(a: Adapter, route: string, after?: string): Promise<Page> {
  const p = await a.children(await homeAt(a, route), after);
  return { ...p, items: rebase(join(route), p.items) };
}

/** Any route's item whole, read at its home. */
export const wholeAt = async (a: Adapter, route: string): Promise<Whole> =>
  a.whole(await homeAt(a, route));

/** Every page of rows under a home. */
export async function allChildren(a: Adapter, home: string): Promise<Item[]> {
  const out: Item[] = [];
  let after: string | undefined;
  do {
    const p = await a.children(home, after);
    out.push(...p.items);
    after = p.next;
  } while (after);
  return out;
}

/** Several roots as one adapter: each call goes to the root its path names. */
export function rooted(roots: Readonly<Record<string, Adapter>>, root: string): Adapter {
  const at = (path: string) => {
    const a = roots[rootOf(path)];
    if (!a) throw new PathError("unknown-path", `no root ${rootOf(path)} here`);
    return a;
  };
  const own = roots[root];
  return {
    root,
    children: async (path, after) => at(path).children(path, after),
    item: async (path) => at(path).item(path),
    whole: async (path) => at(path).whole(path),
    find: async (q, under) => at(under ?? root).find(q, under),
    ...(own?.stamp ? { stamp: own.stamp.bind(own) } : {}),
    ...(own?.edges ? { edges: own.edges.bind(own) } : {}),
  };
}

/** What Explorer reads: one host's routes (PathsConsole), or `across` roots read here and there. */
export interface Reads {
  columns(route: string): Promise<Shown>;
  children(path: string, after?: string): Promise<Page>;
  find(q: string, under: string): Promise<Item[]>;
  /** One root's Map: a root reads whole on its own host, never across */
  map(root: string, fold: Fold): Promise<PathMap>;
  line(from: LineEnd, to: LineEnd, after?: string): Promise<LinePage>;
}

const under = (path: string, top: string) => path === top || path.startsWith(`${top}/`);

/** Rows under `from` moved under `to`; a moved row keeps its home in `original`. */
function reroot(items: Item[], from: string, to: string): Item[] {
  return items.map((i) =>
    under(i.path, from)
      ? { ...i, path: to + i.path.slice(from.length), original: i.original ?? i.path }
      : i,
  );
}

/**
 * Roots read here (Weaver beside `weaver serve`, folders) and the rest on `far`
 * (designs/2026-11-12-explorer.md D5). A route that walks from a root here into a far root sends
 * its rest in one call; the answer reads as the route asked.
 */
export function across(here: Readonly<Record<string, Adapter>>, far: Reads): Reads {
  const isFar = (path: string) => !here[rootOf(path)];
  /** the walk here; `hand`: where it reached a far home, and the far route for the rest */
  const cross = async (route: string) => {
    const a = rooted(here, rootOf(route));
    const w = await walk(a, route, isFar);
    const last = w.steps.at(-1);
    const hand =
      w.rest && last ? { at: last.route, home: last.home, to: join(last.home, ...w.rest) } : null;
    return { a, w, hand, home: last?.home ?? a.root };
  };
  const failed = (w: Walked) => {
    if (w.error) throw new PathError(w.error.code, w.error.message);
  };
  return {
    columns: async (route) => {
      if (isFar(route)) return far.columns(route);
      const { a, w, hand } = await cross(route);
      if (!hand) return columnsOf(a, w);
      const near = await columnsOf(a, { steps: w.steps.slice(0, -1) }, false);
      if (near.error) return near;
      const shown = await far.columns(hand.to);
      const at = (r: string) => (under(r, hand.home) ? hand.at + r.slice(hand.home.length) : r);
      // the far walk's own steps above the home are this route's steps already
      const farCols = shown.columns.slice(segments(hand.home).length - 1).map((c) => ({
        ...c,
        route: at(c.route),
        items: reroot(c.items, hand.home, hand.at),
      }));
      const e = shown.error;
      return {
        columns: [...near.columns, ...farCols],
        ...(shown.whole ? { whole: shown.whole } : {}),
        ...(e ? { error: { ...e, route: under(e.route, hand.home) ? at(e.route) : hand.at } } : {}),
      };
    },
    children: async (route, after) => {
      if (isFar(route)) return far.children(route, after);
      const { a, w, hand, home } = await cross(route);
      failed(w);
      if (hand) {
        const p = await far.children(hand.to, after);
        return { ...p, items: reroot(p.items, hand.home, hand.at) };
      }
      const p = await a.children(home, after);
      return { ...p, items: rebase(join(route), p.items) };
    },
    find: async (q, at) => {
      if (isFar(at)) return far.find(q, at);
      const { a, w, hand, home } = await cross(at);
      failed(w);
      return hand ? far.find(q, hand.to) : a.find(q, home);
    },
    map: (root, fold) => (isFar(root) ? far.map(root, fold) : mapAt(rooted(here, root), fold)),
    line: (from, to, after) =>
      isFar(from.path)
        ? far.line(from, to, after)
        : lineAt(rooted(here, rootOf(from.path)), from, to, after),
  };
}

/** Boxes past this many do not open (designs/2026-11-12-explorer.md, Map: Cap). */
// ELK, warm: 150 boxes 193 ms, 300 boxes 473 ms; 200 keeps an open near 280 ms
const MAP_CAP = 200;

/** A box on the Map: a home row, in the open box `parent` (the root for the top). */
export interface MapBox extends Item {
  parent: string;
  open: boolean;
  /** asked open, held closed: past `MAP_CAP` */
  full?: boolean;
}
/** A bundle without its edges: the line preview pages them (`lineAt`). */
export interface MapLine extends Omit<Bundle<PathEdge>, "edges"> {
  count: number;
}
export interface PathMap {
  root: string;
  /** parents before their kids */
  boxes: MapBox[];
  lines: MapLine[];
  /** links with both ends in one closed box, by box */
  inside: Record<string, number>;
  /** links to another root, by root */
  outside: Record<string, number>;
}

/** depth 0: the root */
const depthOf = (path: string) => segments(path).length - 1;
/** The depth cut opens a box only up to this many rows: overview first, rows on a click. */
const FOLD_ROWS = 12;
/** A fold's own call on a box, else the depth cut (Orrery's `openSet` rule on paths). */
// no count: unknown cost (a Weaver run reads its whole view), so the cut keeps it closed
const asked = (fold: Fold, i: Item) =>
  fold.open[i.path] ?? (depthOf(i.path) < fold.depth && i.count != null && i.count <= FOLD_ROWS);

/**
 * The Map of a root under a fold: open boxes read all their rows (relation folders and aliases
 * become lines), then every edge lifts to the boxes that show (Orrery `lift`, `bundle`).
 */
export async function mapAt(a: Adapter, fold: Fold): Promise<PathMap> {
  const root = a.root;
  const boxes: MapBox[] = [];
  const open = new Set([root]);
  let level = [root];
  while (level.length) {
    const rows = await Promise.all(
      level.map(async (home) =>
        (await allChildren(a, home))
          .filter((i) => i.kind !== "relation" && !i.original)
          .map((i) => ({ i, home })),
      ),
    );
    const next: string[] = [];
    for (const { i, home } of rows.flat()) {
      const want = !i.leaf && asked(fold, i);
      boxes.push({ ...i, parent: home, open: want });
      if (want) next.push(i.path);
    }
    // a level opens whole or not at all, so a fold never draws half a box
    let room = MAP_CAP - boxes.length;
    level = [];
    for (const path of next) {
      const n = boxes.find((b) => b.path === path)?.count ?? 1;
      if (n <= room) {
        room -= n;
        level.push(path);
        open.add(path);
      }
    }
    for (const b of boxes)
      if (b.open && !open.has(b.path)) Object.assign(b, { open: false, full: true });
  }
  const shown = new Set(boxes.map((b) => b.path));
  const { lines, inside, outside } = lift(
    a.edges ? await a.edges(root, open) : [],
    open,
    (p) => parentOf(p) || undefined,
    root,
  );
  const out: PathMap = { root, boxes, lines: [], inside: {}, outside: {} };
  for (const [k, es] of inside) out.inside[k] = es.length;
  const far = (e: PathEdge) => (under(e.from, root) ? rootOf(e.to) : rootOf(e.from));
  for (const e of outside) out.outside[far(e)] = (out.outside[far(e)] ?? 0) + 1;
  // an end the rows never named (a gone record) draws nowhere
  out.lines = bundle(lines.filter((l) => shown.has(l.from) && shown.has(l.to))).map(
    ({ edges, ...b }) => ({ ...b, count: edges.length }),
  );
  return out;
}

/** One end of a Map line: a closed box takes every end under it; an open one only its own path. */
export interface LineEnd {
  path: string;
  open: boolean;
}

export interface LinePage {
  edges: PathEdge[];
  count: number;
  next?: string;
}

/** A Map line's edges, one page (`PAGE_SIZE`) from `after`, without the fold's child reads. */
export async function lineAt(
  a: Adapter,
  from: LineEnd,
  to: LineEnd,
  after?: string,
): Promise<LinePage> {
  const at = (id: string, end: LineEnd) => id === end.path || (!end.open && under(id, end.path));
  // a shown box's parents are all open: the fold that drew this line, as far as it reaches
  const open = new Set<string>();
  for (const end of [from, to]) {
    const s = segments(end.path);
    for (let k = 1; k < s.length; k++) open.add(s.slice(0, k).join("/"));
    if (end.open) open.add(end.path);
  }
  const all = (a.edges ? await a.edges(a.root, open) : []).filter(
    (e) => at(e.from, from) && at(e.to, to),
  );
  const start = Number(after ?? 0) || 0;
  const edges = all.slice(start, start + PAGE_SIZE);
  return start + PAGE_SIZE < all.length
    ? { edges, count: all.length, next: String(start + PAGE_SIZE) }
    : { edges, count: all.length };
}

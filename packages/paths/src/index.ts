/**
 * Explorer's contract (designs/2026-11-12-explorer.md): every item has one home path; links join
 * any two items. Each product gives one adapter. No imports: the browser, the server and the CLI
 * all run it.
 */

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
  into: "Replaced by",
};

export const segments = (path: string) => path.split("/").filter(Boolean);
const lastSegment = (path: string) => segments(path).at(-1) ?? "";
export const parentOf = (path: string) => segments(path).slice(0, -1).join("/");
export const rootOf = (path: string) => segments(path)[0] ?? "";
export const join = (...parts: string[]) => parts.flatMap(segments).join("/");
/** where a row leads: an alias row's home, else its own path */
export const homeOf = (i: Item) => i.original ?? i.path;

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
 */
export async function walk(a: Adapter, route: string): Promise<Walked> {
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
  for (const seg of segs.slice(1)) {
    at = join(at, seg);
    try {
      const item = await a.item(join(home, seg));
      home = item.path;
      steps.push({ route: at, home, item });
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

// folders show their rows; only these open a preview
const FOLDERS = new Set(["root", "area", "layer", "relation", "folder", "type"]);

export async function columns(a: Adapter, route: string): Promise<Shown> {
  const w = await walk(a, route);
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
  if (error || !last || FOLDERS.has(last.item.kind))
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

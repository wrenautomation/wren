/**
 * Folders as a tree (designs/2026-11-12-explorer.md D4; designs/2026-11-08-folders.md):
 * `folders/<id>/<child id>/…`, three levels at most. A filed item is an alias of its home
 * (`vireo/subjects/<slug>`, `weaver/<run>`), so a folder move changes no item's home. A chat has
 * no root yet: it stays out. Browser-safe: core only. One adapter per request: the tree loads once.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PAGE_SIZE,
  PathError,
  pageOf,
  segments,
} from "@wren/core/paths";
import { subjectRow, type VireoSubject } from "./vireo-tree.js";
import { runRow, type WeaverRun } from "./weaver-tree.js";

const ROOT = "folders";
/** a filed row's "from <home>": the root it lives in */
const HOME_NAME: Record<string, string> = { vireo: "Vireo", weaver: "Weaver" };

export interface FolderRow {
  id: number;
  parent: number | null;
  name: string;
}
export interface FiledRow {
  kind: string;
  ref: string;
  folder: number;
}

/** What the tree reads. */
export interface FoldersSource {
  tree(): Promise<{ folders: FolderRow[]; filed: FiledRow[] }>;
  /** names a filed subject: its ref is the subject id */
  subjects(): Promise<VireoSubject[]>;
  /** names a filed run; a reject (`weaver serve` off) shows runs by id */
  runs(): Promise<WeaverRun[]>;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function foldersTree(src: FoldersSource): Adapter {
  const load = async () => {
    const t = await src.tree();
    const byId = new Map(t.folders.map((f) => [f.id, f]));
    const kinds = new Set(t.filed.map((f) => f.kind));
    const [subjects, runs] = await Promise.all([
      kinds.has("subject") ? src.subjects() : [],
      kinds.has("run") ? src.runs().catch(() => null) : [],
    ]);
    const subject = new Map(subjects.map((s) => [String(s.id), s]));
    const run = runs && new Map(runs.map((r) => [r.run, r]));
    /** a filed item's home row; null: gone (the join drops it) or a chat */
    const homeOf = (f: FiledRow): Item | null => {
      if (f.kind === "subject") {
        const s = subject.get(f.ref);
        return s ? subjectRow(s) : null;
      }
      if (f.kind !== "run") return null;
      if (!run) return { path: join("weaver", f.ref), name: f.ref, kind: "run", sub: "Weaver run" };
      const r = run.get(f.ref);
      return r ? runRow(r) : null;
    };
    const items = new Map<number, Item[]>();
    for (const f of t.filed) {
      const h = homeOf(f);
      if (h) items.set(f.folder, [...(items.get(f.folder) ?? []), h]);
    }
    const kids = new Map<number | null, FolderRow[]>();
    for (const f of [...t.folders].sort(byName))
      kids.set(f.parent, [...(kids.get(f.parent) ?? []), f]);
    /** a folder's home: its ids from the top */
    const pathOf = (id: number) => {
      const ids: number[] = [];
      // depth ≤ 3; the cap stops a bad row from looping
      for (
        let f = byId.get(id);
        f && ids.length < 8;
        f = f.parent == null ? undefined : byId.get(f.parent)
      )
        ids.unshift(f.id);
      return join(ROOT, ...ids.map(String));
    };
    const folderRow = (f: FolderRow): Item => {
      const n = (kids.get(f.id)?.length ?? 0) + (items.get(f.id)?.length ?? 0);
      return { path: pathOf(f.id), name: f.name, kind: "folder", count: n };
    };
    return { byId, items, kids, pathOf, folderRow };
  };
  let loaded: ReturnType<typeof load> | undefined;
  const tree = () => {
    loaded ??= load();
    return loaded;
  };

  /** The folder a path names; a folder that moved answers with its new home in `was`. */
  const folderAt = async (path: string) => {
    const segs = segments(path);
    if (segs[0] !== ROOT) throw new PathError("unknown-path", `not a folders path: ${path}`);
    const t = await tree();
    let parent: number | null = null;
    let moved = false;
    for (const seg of segs.slice(1)) {
      const f = /^\d+$/.test(seg) ? t.byId.get(Number(seg)) : undefined;
      if (!f) throw new PathError("unknown-path", `no folder ${seg}`);
      // ids are fixed: a folder moved since the link was made is still this folder
      if (f.parent !== parent) moved = true;
      parent = f.id;
    }
    const f = parent == null ? null : (t.byId.get(parent) ?? null);
    return { t, f, moved };
  };

  const adapter: Adapter = {
    root: ROOT,
    children: async (path, after) => {
      const { t, f, moved } = await folderAt(path);
      if (moved && f) throw new PathError("unknown-path", `folder ${f.id} is at ${t.pathOf(f.id)}`);
      const home = f ? t.pathOf(f.id) : ROOT;
      const folders = (t.kids.get(f?.id ?? null) ?? []).map(t.folderRow);
      const filed = f
        ? [...(t.items.get(f.id) ?? [])]
            .sort(byName)
            .map((i) => aliasOf(home, i, HOME_NAME[segments(i.path)[0] ?? ""]))
        : [];
      return pageOf([...folders, ...filed], after);
    },
    item: async (path) => {
      if (segments(path).length === 1) {
        if (path !== ROOT) throw new PathError("unknown-path", `not a folders path: ${path}`);
        return { path: ROOT, name: "Folders", kind: "root" };
      }
      try {
        const { t, f, moved } = await folderAt(path);
        if (f) return { ...t.folderRow(f), ...(moved ? { was: path } : {}) };
      } catch (e) {
        // the last segment may be a filed item, not a folder
        if (!(e instanceof PathError)) throw e;
      }
      return itemFromParent(adapter, path);
    },
    whole: async (path) => {
      const it = await adapter.item(path);
      return { ...it, links: await linksOf(adapter, it) };
    },
    find: async (q, under) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const t = await tree();
      const top = under && under !== ROOT ? (await folderAt(under)).f?.id : undefined;
      const within = (id: number) => {
        for (let f = t.byId.get(id); f; f = f.parent == null ? undefined : t.byId.get(f.parent))
          if (f.id === top) return true;
        return top == null;
      };
      const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
      const folders = [...t.byId.values()].filter(
        (f) => f.id !== top && within(f.id) && has(f.name),
      );
      const filed = [...t.items].flatMap(([id, rows]) =>
        within(id) ? rows.filter((i) => has(`${i.name} ${i.sub ?? ""}`)) : [],
      );
      return [...folders.sort(byName).map(t.folderRow), ...filed.sort(byName)].slice(0, PAGE_SIZE);
    },
  };
  return adapter;
}

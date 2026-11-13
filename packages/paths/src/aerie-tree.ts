/**
 * Aerie as a tree (aerie D16 "Columns", explorer D4): `aerie/<area path>/<task id>`, a child task under its
 * parent (`aerie/dev/wren/WA-1364/WA-1364.1`). An alias area (`task_area`) shows the task as an alias row;
 * `waits-on` and `blocks` are relation folders. Reads only through an `AerieTreeSource`: the Tasks page's
 * rows in the browser, so its filters hold. Browser-safe: core and types only.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PathError,
  pageOf,
  relationRow,
  segments,
  type Whole,
} from "@wren/core/paths";

const ROOT = "aerie";

/** what the tree reads of a task (Aerie's `TaskRow` has it) */
export interface AerieTreeTask {
  id: string;
  title: string;
  status: string;
  /** the home area's path: `dev/wren` */
  area: string;
  /** areas it also shows in */
  aliases: readonly string[];
  parentId?: string | undefined;
  dependencies: readonly string[];
  summary?: string | undefined;
}

export interface AerieTreeArea {
  path: string;
  name: string;
  description: string | null;
}

export interface AerieTreeSource {
  areas: readonly AerieTreeArea[];
  /** every task, in the order rows show */
  tasks: readonly AerieTreeTask[];
  /** the ids a filter keeps; null: no filter, every task and area shows */
  kept: ReadonlySet<string> | null;
}

/** marks a row that shows only because a task under it matches */
export const OUTSIDE = "outside";

const below = (area: string, under: string) => area === under || area.startsWith(`${under}/`);

/** each task's home path: a child under its parent; a loop in the parents stops at the area */
function homesOf(tasks: readonly AerieTreeTask[]): Map<string, string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const homes = new Map<string, string>();
  const homeOf = (t: AerieTreeTask, seen: Set<string>): string => {
    const known = homes.get(t.id);
    if (known) return known;
    seen.add(t.id);
    const p = t.parentId ? byId.get(t.parentId) : undefined;
    const home = p && !seen.has(p.id) ? join(homeOf(p, seen), t.id) : join(ROOT, t.area, t.id);
    homes.set(t.id, home);
    return home;
  };
  for (const t of tasks) homeOf(t, new Set());
  return homes;
}

/** a task's route in the tree; null: no such task */
export const aerieRouteOf = (tasks: readonly AerieTreeTask[], id: string): string | null =>
  homesOf(tasks).get(id) ?? null;

export function aerieTree(src: AerieTreeSource): Adapter {
  const byId = new Map(src.tasks.map((t) => [t.id, t]));

  const homes = homesOf(src.tasks);
  // the parent it sits under (none past a loop in the parents)
  const parentOf = (t: AerieTreeTask) => {
    const p = t.parentId ? byId.get(t.parentId) : undefined;
    return p && homes.get(t.id) === join(homes.get(p.id) ?? "", t.id) ? p : undefined;
  };

  // shown: kept, plus every parent of a kept task (the way to it)
  const shown = new Set<string>();
  for (const t of src.tasks) {
    if (src.kept && !src.kept.has(t.id)) continue;
    for (let at: AerieTreeTask | undefined = t; at && !shown.has(at.id); at = parentOf(at))
      shown.add(at.id);
  }
  const visible = (t: AerieTreeTask) => shown.has(t.id);

  const kids = new Map<string, AerieTreeTask[]>();
  const blockers = new Map<string, AerieTreeTask[]>();
  for (const t of src.tasks) {
    const p = parentOf(t);
    if (p) kids.set(p.id, [...(kids.get(p.id) ?? []), t]);
    for (const d of t.dependencies)
      if (byId.has(d)) blockers.set(d, [...(blockers.get(d) ?? []), t]);
  }
  const waitsOn = (t: AerieTreeTask) => t.dependencies.flatMap((d) => byId.get(d) ?? []);
  const blocking = (t: AerieTreeTask) => blockers.get(t.id) ?? [];

  // areas: the named ones, plus any a task names, with their parents
  const areas = new Map(src.areas.map((a) => [a.path, a]));
  for (const t of src.tasks)
    for (const path of [t.area, ...t.aliases]) {
      const s = segments(path);
      for (let i = 1; i <= s.length; i++) {
        const at = s.slice(0, i).join("/");
        if (!areas.has(at)) areas.set(at, { path: at, name: s[i - 1] ?? at, description: null });
      }
    }
  const shownIn = (area: string) =>
    src.tasks.filter(
      (t) => visible(t) && !parentOf(t) && [t.area, ...t.aliases].some((a) => below(a, area)),
    ).length;
  const areaShows = (a: AerieTreeArea) => !src.kept || shownIn(a.path) > 0;
  const areaRow = (a: AerieTreeArea): Item => {
    const n = shownIn(a.path);
    return {
      path: join(ROOT, a.path),
      name: a.name,
      kind: "area",
      ...(a.description ? { sub: a.description } : {}),
      ...(n ? { count: n } : {}),
    };
  };
  const childAreas = (under: string | null) =>
    [...areas.values()].filter((a) => {
      const s = segments(a.path);
      return (
        areaShows(a) &&
        (under === null
          ? s.length === 1
          : s.length === segments(under).length + 1 && below(a.path, under))
      );
    });

  const taskRow = (t: AerieTreeTask): Item => {
    const rels = waitsOn(t).length + blocking(t).length;
    const held = (kids.get(t.id) ?? []).some(visible);
    return {
      path: homes.get(t.id) ?? join(ROOT, t.area, t.id),
      name: t.title,
      kind: "task",
      sub: `${t.id} · ${t.status}`,
      ...(src.kept && !src.kept.has(t.id) ? { mark: OUTSIDE } : {}),
      ...(held || rels ? {} : { leaf: true }),
    };
  };

  /** what a path names: the root, an area, a task, or a relation under a task */
  const at = (path: string) => {
    const s = segments(path);
    if (s[0] !== ROOT) throw new PathError("unknown-path", `not an Aerie path: ${path}`);
    if (s.length === 1) return { kind: "root" as const };
    const area = s.slice(1).join("/");
    if (areas.has(area)) return { kind: "area" as const, area: areas.get(area) as AerieTreeArea };
    const last = s.at(-1) ?? "";
    const t = byId.get(last);
    if (t && homes.get(t.id) === join(...s)) return { kind: "task" as const, t };
    const owner = byId.get(s.at(-2) ?? "");
    if (
      owner &&
      homes.get(owner.id) === join(...s.slice(0, -1)) &&
      (last === "waits-on" || last === "blocks")
    )
      return { kind: "relation" as const, t: owner, rel: last };
    return null;
  };

  const rowsUnder = (path: string): Item[] => {
    const x = at(path);
    if (!x) throw new PathError("unknown-path", `Aerie has nothing at ${path}`);
    if (x.kind === "root") return childAreas(null).map(areaRow);
    if (x.kind === "area") {
      const here = x.area.path;
      const homed = src.tasks.filter((t) => visible(t) && !parentOf(t) && t.area === here);
      const aliased = src.tasks.filter(
        (t) => visible(t) && t.aliases.includes(here) && t.area !== here,
      );
      return [
        ...childAreas(here).map(areaRow),
        ...homed.map(taskRow),
        ...aliased.map((t) => aliasOf(path, taskRow(t), areas.get(t.area)?.name ?? t.area)),
      ];
    }
    if (x.kind === "relation")
      return (x.rel === "waits-on" ? waitsOn(x.t) : blocking(x.t)).map(taskRow);
    // a task reached by a relation shows all its children, though the filter drops them
    const all = kids.get(x.t.id) ?? [];
    const sub = visible(x.t) ? all.filter(visible) : all;
    const home = homes.get(x.t.id) ?? path;
    return [
      ...sub.map(taskRow),
      ...relationRow(home, "waits-on", waitsOn(x.t).map(taskRow)),
      ...relationRow(home, "blocks", blocking(x.t).map(taskRow)),
    ];
  };

  const adapter: Adapter = {
    root: ROOT,
    children: async (path, after) => pageOf(rowsUnder(path), after),
    item: async (path) => {
      const x = at(path);
      if (x?.kind === "root") return { path: ROOT, name: "Aerie", kind: "root" };
      if (x?.kind === "area") return areaRow(x.area);
      if (x?.kind === "task") return taskRow(x.t);
      return itemFromParent(adapter, path);
    },
    whole: async (path): Promise<Whole> => {
      const item = await adapter.item(path);
      const x = at(item.path);
      const t = x?.kind === "task" ? x.t : undefined;
      return {
        ...item,
        // the preview's head: the row's status shows as the task's own pick
        ...(t ? { sub: t.id } : {}),
        ...(t?.summary ? { body: t.summary } : {}),
        links: await linksOf(adapter, item),
        ...(t ? { data: { id: t.id } } : {}),
      };
    },
    find: async (q, under) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const base = under && under !== ROOT ? under : ROOT;
      return src.tasks
        .filter((t) => {
          const home = homes.get(t.id) ?? "";
          const text = `${t.id} ${t.title}`.toLowerCase();
          return visible(t) && below(home, base) && words.every((w) => text.includes(w));
        })
        .map(taskRow);
    },
  };
  return adapter;
}

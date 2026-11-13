/**
 * The business map as a tree (designs/2026-11-12-explorer.md D4, "Map"): homes from the shape's own
 * line, group and station ids, never the fold tree. `metro/lines/<line>/<group>…/<station>`; a
 * group on no line under `metro/groups`; a station on no line (the hub) under `metro/stations`; a
 * shared flow's stations under `metro/flows/<flow>`. Tracks are relations (`goes-to`,
 * `transfers-to`, `loops-to`) and Map edges; a link station `opens` its flow. Reads the newest
 * shape through a `MetroSource`. Browser-safe: core only (pipeline types).
 * One adapter per request: the shape loads once.
 */

import {
  type Adapter,
  aliasOf,
  type Item,
  itemFromParent,
  join,
  linksOf,
  PAGE_SIZE,
  type Page,
  type PathEdge,
  PathError,
  pageOf,
  parentOf,
  relationRow,
  segments,
  type Whole,
} from "@wren/core/paths";
import type {
  MetroBody,
  MetroGroup,
  MetroLine,
  MetroStation,
  MetroTrack,
} from "@wren/pipeline/metro";

const ROOT = "metro";

/** The newest shape, drawn as a metro body. */
export interface MetroShape {
  body: MetroBody;
  version: number;
  at: string;
}
/** What the tree reads. null: no shape yet, or the newest cannot be drawn. */
export interface MetroSource {
  shape(): Promise<MetroShape | null>;
}

const KIND_WORD: Record<string, string> = { att: "attention", ab: "A/B split" };
const TIER_WORD: Record<string, string> = {
  out: "outreach",
  front: "front end",
  core: "core",
  content: "content",
};
/** a track's relation by its kind; the reverse folder is `REVERSE[rel]` */
const relOf = (t: Pick<MetroTrack, "kind">) =>
  t.kind === "xfer" ? "transfers-to" : t.kind === "back" ? "loops-to" : "goes-to";
const REVERSE: Record<string, string> = {
  "goes-to": "comes-from",
  "transfers-to": "transferred-from",
  "loops-to": "looped-from",
  opens: "opened-by",
};
const STATION_RELS = ["goes-to", "comes-from", "transfers-to", "transferred-from", "loops-to"];
const RELS = new Set([...STATION_RELS, "looped-from", "opens", "opened-by"]);

/** `key: value` lines: an agent greps them, a person reads them */
const fieldsText = (o: object, skip: readonly string[]) =>
  Object.entries(o)
    .filter(([k, v]) => !skip.includes(k) && v !== undefined && v !== null && k !== "attach")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .concat(
      ((o as { attach?: { kind: string; ref: string; label?: string }[] }).attach ?? []).map(
        (a) => `attached ${a.kind}: ${a.label ? `${a.label} (${a.ref})` : a.ref}`,
      ),
    )
    .join("\n");

interface Node {
  row: Item;
  /** body order of its first station: rows keep the map's order */
  rank: number;
  station?: MetroStation;
  /** the flow a flow station sits in */
  flow?: string;
  line?: MetroLine;
  group?: MetroGroup;
  /** a flow's own home */
  flowOf?: string;
}

/** The shape as homes: every node by its home path, each folder's rows, every track as an edge. */
function indexOf(body: MetroBody) {
  const nodes = new Map<string, Node>();
  const kids = new Map<string, string[]>();
  const add = (parent: string, n: Node) => {
    nodes.set(n.row.path, n);
    kids.set(parent, [...(kids.get(parent) ?? []), n.row.path]);
  };
  const lineBy = new Map(body.lines.map((l) => [l.id, l]));
  const groupBy = new Map(body.groups.map((g) => [g.id, g]));
  const groupOf = new Map<string, string>();
  for (const g of body.groups) for (const s of g.stations) groupOf.set(s, g.id);
  // the groups each home holds: a station that shares a sibling group's id takes `station:<id>`
  const childGroups = new Map<string, Set<string>>();

  const lineHome = (id: string) => join(ROOT, "lines", id);
  const groupHomes = new Map<string, string>();
  const groupHome = (id: string, depth = 0): string => {
    const known = groupHomes.get(id);
    if (known) return known;
    const g = groupBy.get(id);
    // a parent loop (refused by checkMetro) or a lost parent: the group sits at the top
    const up =
      g?.parent && groupBy.has(g.parent) && depth < 32
        ? groupHome(g.parent, depth + 1)
        : g?.line && lineBy.has(g.line)
          ? lineHome(g.line)
          : join(ROOT, "groups");
    const home = join(up, id);
    groupHomes.set(id, home);
    childGroups.set(up, (childGroups.get(up) ?? new Set()).add(id));
    return home;
  };
  for (const g of body.groups) groupHome(g.id);
  const holderOf = (s: MetroStation) => {
    const g = groupOf.get(s.id);
    if (g && groupBy.has(g)) return groupHome(g);
    return s.line && lineBy.has(s.line) ? lineHome(s.line) : join(ROOT, "stations");
  };
  const stationHome = (s: MetroStation) => {
    const up = holderOf(s);
    return join(up, childGroups.get(up)?.has(s.id) ? `station:${s.id}` : s.id);
  };
  const stationRow = (s: MetroStation, path: string, flow?: string): Item => ({
    path,
    name: s.label || s.id,
    kind: "station",
    sub: [
      KIND_WORD[s.kind] ?? s.kind,
      s.action,
      flow ? `in ${flow}` : s.line && !lineBy.has(s.line) ? `on ${s.line}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
    ...(s.planned ? { mark: "planned" } : s.failure ? { mark: "failure" } : {}),
  });

  const homeOfStation = new Map<string, string>();
  body.stations.forEach((s, i) => {
    const path = stationHome(s);
    homeOfStation.set(s.id, path);
    add(parentOf(path), { row: stationRow(s, path), rank: i, station: s });
  });
  // a folder's rank: its first station's; rows sort by it, so a line reads in its own order
  const rankUnder = (home: string) => {
    let best = Number.POSITIVE_INFINITY;
    for (const [p, n] of nodes)
      if (n.station && !n.flow && p.startsWith(`${home}/`)) best = Math.min(best, n.rank);
    return best;
  };
  for (const g of body.groups) {
    const path = groupHome(g.id);
    const c = g.campaign;
    add(parentOf(path), {
      row: {
        path,
        name: g.label || g.id,
        kind: "group",
        ...(c ? { sub: ["campaign", c.status, c.offer].filter(Boolean).join(" · ") } : {}),
      },
      rank: rankUnder(path),
      group: g,
    });
  }
  body.lines.forEach((l, i) => {
    const path = lineHome(l.id);
    add(join(ROOT, "lines"), {
      row: {
        path,
        name: l.label || l.id,
        kind: "metro-line",
        sub: [TIER_WORD[l.tier] ?? l.tier, l.offer].filter(Boolean).join(" · "),
        ...(l.planned ? { mark: "planned" } : {}),
      },
      rank: i,
      line: l,
    });
  });
  const flowStation = new Map<string, string>();
  for (const f of body.flows ?? []) {
    const home = join(ROOT, "flows", f.id);
    add(join(ROOT, "flows"), {
      row: { path: home, name: f.label || f.id, kind: "flow" },
      rank: nodes.size,
      flowOf: f.id,
    });
    f.stations.forEach((s, i) => {
      const path = join(home, s.id);
      flowStation.set(`${f.id}/${s.id}`, path);
      add(home, { row: stationRow(s, path, f.label), rank: i, station: s, flow: f.id });
    });
  }
  for (const [parent, list] of kids) {
    list.sort((a, b) => (nodes.get(a)?.rank ?? 0) - (nodes.get(b)?.rank ?? 0));
    kids.set(parent, list);
  }

  // every track between two homes; a flow's tracks stay inside it
  const edges: (PathEdge & { track?: MetroTrack })[] = [];
  for (const t of body.tracks) {
    const from = homeOfStation.get(t.from);
    const to = homeOfStation.get(t.to);
    if (from && to) edges.push({ id: `track:${t.id}`, from, to, rel: relOf(t), track: t });
  }
  for (const f of body.flows ?? [])
    for (const t of f.tracks) {
      const from = flowStation.get(`${f.id}/${t.from}`);
      const to = flowStation.get(`${f.id}/${t.to}`);
      if (from && to) edges.push({ id: `flow:${f.id}:${t.id}`, from, to, rel: relOf(t), track: t });
    }
  for (const s of body.stations) {
    const from = homeOfStation.get(s.id);
    if (s.kind === "link" && s.flow && from && nodes.has(join(ROOT, "flows", s.flow)))
      edges.push({ id: `opens:${s.id}`, from, to: join(ROOT, "flows", s.flow), rel: "opens" });
  }
  const area = (seg: string, name: string, always: boolean): Item[] => {
    const n = kids.get(join(ROOT, seg))?.length ?? 0;
    return n || always ? [{ path: join(ROOT, seg), name, kind: "area", count: n }] : [];
  };
  kids.set(ROOT, []);
  const areas = [
    ...area("lines", "Lines", true),
    ...area("groups", "Groups across lines", false),
    ...area("stations", "Stations on no line", true),
    ...area("flows", "Shared flows", false),
  ];
  for (const a of areas) nodes.set(a.path, { row: a, rank: 0 });
  kids.set(
    ROOT,
    areas.map((a) => a.path),
  );
  // a folder's count: its rows
  for (const [p, n] of nodes)
    if (n.row.kind !== "station" && n.row.kind !== "area")
      n.row = { ...n.row, count: kids.get(p)?.length ?? 0 };
  return { nodes, kids, edges, homeOfStation, groupHomes };
}

type Index = ReturnType<typeof indexOf>;

export function metroTree(src: MetroSource): Adapter {
  let shapeP: Promise<{ shape: MetroShape; ix: Index } | null> | undefined;
  const load = () => {
    shapeP ??= src.shape().then((shape) => (shape ? { shape, ix: indexOf(shape.body) } : null));
    return shapeP;
  };
  const need = async () => {
    const got = await load();
    if (!got) throw new PathError("unknown-path", "no business map yet: start one on Map");
    return got;
  };
  const inside = (at: string, p: string) => at === ROOT || p === at || p.startsWith(`${at}/`);

  /** A station's relations: the rows each folder holds, each target once. */
  const relsOf = (ix: Index, home: string) => {
    const out = new Map<string, Item[]>();
    const put = (rel: string, target: string) => {
      const n = ix.nodes.get(target);
      if (!n) return;
      const list = out.get(rel) ?? [];
      if (!list.some((r) => r.path === target)) list.push(n.row);
      out.set(rel, list);
    };
    for (const e of ix.edges) {
      if (e.from === home) put(e.rel, e.to);
      if (e.to === home) put(REVERSE[e.rel] ?? e.rel, e.from);
    }
    return out;
  };
  const relRows = (ix: Index, home: string): Item[] => {
    const rels = relsOf(ix, home);
    return [...STATION_RELS, "looped-from", "opens", "opened-by"].flatMap((r) =>
      relationRow(home, r, rels.get(r) ?? []),
    );
  };

  const children = async (path: string, after?: string): Promise<Page> => {
    const segs = segments(path);
    if (segs[0] !== ROOT) throw new PathError("unknown-path", `not a map path: ${path}`);
    const got = await load();
    if (!got) return { items: [] };
    const { ix } = got;
    const n = ix.nodes.get(path);
    if (path === ROOT || (n && n.row.kind !== "station")) {
      const rows = (ix.kids.get(path) ?? []).flatMap((p) => {
        const r = ix.nodes.get(p)?.row;
        return r ? [r] : [];
      });
      // a flow lists who opens it after its stations
      return pageOf(n?.flowOf ? [...rows, ...relRows(ix, path)] : rows, after);
    }
    if (n) return { items: relRows(ix, path) };
    const rel = segs.at(-1) ?? "";
    const home = parentOf(path);
    if (RELS.has(rel) && ix.nodes.has(home)) {
      const rows = relsOf(ix, home).get(rel) ?? [];
      return pageOf(
        rows.map((r) => aliasOf(path, r)),
        after,
      );
    }
    throw new PathError("unknown-path", `nothing at ${path}`);
  };

  /** A moved station or group: found by its id, wherever it lives now. */
  const moved = (ix: Index, path: string): Item | undefined => {
    const seg = (segments(path).at(-1) ?? "").replace(/^station:/, "");
    const home = ix.homeOfStation.get(seg) ?? ix.groupHomes.get(seg);
    const row = home ? ix.nodes.get(home)?.row : undefined;
    return row && home !== path ? { ...row, was: path } : undefined;
  };

  const adapter: Adapter = {
    root: ROOT,
    children,
    item: async (path) => {
      const segs = segments(path);
      if (segs[0] !== ROOT) throw new PathError("unknown-path", `not a map path: ${path}`);
      if (segs.length === 1) {
        const got = await load();
        return {
          path: ROOT,
          name: got?.shape.body.name ?? "Business map",
          kind: "root",
          ...(got ? { sub: `version ${got.shape.version}` } : {}),
        };
      }
      const { ix } = await need();
      const n = ix.nodes.get(path);
      if (n) return n.row;
      if (RELS.has(segs.at(-1) ?? "") || RELS.has(segs.at(-2) ?? ""))
        return itemFromParent(adapter, path);
      // only lines and stations areas hold movable things
      const re = segs[1] === "lines" || segs[1] === "groups" ? moved(ix, path) : undefined;
      if (re) return re;
      throw new PathError("unknown-path", `the map holds nothing at ${path}`);
    },
    whole: async (path) => {
      const it = await adapter.item(path);
      const out: Whole = { ...it, links: await linksOf(adapter, it) };
      const got = await load();
      if (!got) return out;
      const { shape, ix } = got;
      if (it.path === ROOT) {
        const b = shape.body;
        return {
          ...out,
          body: [
            `version: ${shape.version}`,
            `saved: ${shape.at}`,
            `lines: ${b.lines.length}`,
            `stations: ${b.stations.length}`,
            `tracks: ${b.tracks.length}`,
            `groups: ${b.groups.length}`,
            `flows: ${b.flows?.length ?? 0}`,
          ].join("\n"),
          data: { name: b.name, version: shape.version, at: shape.at },
        };
      }
      const n = ix.nodes.get(it.path);
      if (n?.station) {
        const s = n.station;
        const own = ix.edges.filter((e) => e.track && (e.from === it.path || e.to === it.path));
        return {
          ...out,
          body: fieldsText(s, ["id", "label"]),
          data: {
            station: s,
            ...(n.flow ? { flow: n.flow } : {}),
            tracks: own.map((e) => ({ ...e.track, rel: e.rel })),
          },
        };
      }
      if (n?.group)
        return { ...out, body: fieldsText(n.group, ["id", "label", "stations"]), data: n.group };
      if (n?.line) return { ...out, body: fieldsText(n.line, ["id", "label"]), data: n.line };
      return out;
    },
    find: async (q, under) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const got = await load();
      if (!words.length || !got) return [];
      const at = under ?? ROOT;
      const hits: Item[] = [];
      for (const [p, n] of got.ix.nodes) {
        if (n.row.kind === "area" || !inside(at, p)) continue;
        const raw = n.station ?? n.group ?? n.line;
        const t = [n.row.name, n.row.sub, raw ? JSON.stringify(raw) : ""].join(" ").toLowerCase();
        if (words.every((w) => t.includes(w))) hits.push(n.row);
        if (hits.length >= PAGE_SIZE) break;
      }
      return hits;
    },
    stamp: async () => {
      const got = await load();
      return got ? { version: got.shape.version, at: got.shape.at } : {};
    },
    edges: async (at) => {
      const got = await load();
      if (!got) return [];
      return got.ix.edges
        .filter((e) => inside(at, e.from) || inside(at, e.to))
        .map(({ track: _t, ...e }) => e);
    },
  };
  return adapter;
}

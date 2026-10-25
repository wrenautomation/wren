/**
 * What changed between two metro bodies, by id (designs/2026-10-20-design-language.md, area C1).
 * The metro twin of `diff.ts`: pure and free of the database. A line, station or group renamed
 * and changed in one diff is two changes. A track or a frame has no name, so it is added,
 * removed or changed. A flow is named: renamed is its label, changed is anything else in it, a
 * station or a track inside it included. An `attach` change is `changed` on the part that holds it.
 */
import { canonicalJson } from "./diff.js";
import type { MetroBody } from "./metro.js";

/** The six kinds of thing a metro body lists, in the order a diff reads them. */
export const METRO_ONS = ["line", "station", "track", "group", "frame", "flow"] as const;
export type MetroOn = (typeof METRO_ONS)[number];

/** The body list each kind lives in. */
export const METRO_LISTS = {
  line: "lines",
  station: "stations",
  track: "tracks",
  group: "groups",
  frame: "frames",
  flow: "flows",
} as const satisfies Record<MetroOn, keyof MetroBody>;

/** The kinds with a name (`label`): only these can be renamed. */
const NAMED_ONS = ["line", "station", "group", "flow"] as const satisfies readonly MetroOn[];
export const isNamed = (on: MetroOn): on is (typeof NAMED_ONS)[number] =>
  (NAMED_ONS as readonly MetroOn[]).includes(on);

type Item = { id: string; label?: string };

/** The items of kind `on`, as plain id and label. A body with no `flows` has none. */
export const itemsOf = (body: MetroBody, on: MetroOn): Item[] => body[METRO_LISTS[on]] ?? [];

/** What changed in one list. */
export interface MetroPart {
  added: string[];
  removed: string[];
  /** Same id, new label. Lines, stations and groups only. */
  renamed: Array<{ id: string; from: string; to: string }>;
  /** Same id, any other field changed. */
  changed: string[];
}

export interface MetroDiff {
  lines: MetroPart;
  stations: MetroPart;
  tracks: MetroPart;
  groups: MetroPart;
  frames: MetroPart;
  flows: MetroPart;
  /** The shape's own name changed. */
  name: { from: string; to: string } | null;
}

const sameJson = (x: unknown, y: unknown): boolean => canonicalJson(x) === canonicalJson(y);

/** The item with its label blanked: what is left is "any other field". */
const withoutLabel = (x: Item): Item => ({ ...x, label: "" });

/** One way an item changed. A rename carries the old and the new label. */
export interface How {
  how: "added" | "removed" | "renamed" | "changed";
  from?: string;
  to?: string;
}

/**
 * How item `was` became item `now`, as the lines a reader sees: renamed first, then changed.
 * Either one may be missing. Shared by the diff and by blame so both say the same thing.
 */
export function howOf(on: MetroOn, was: Item | undefined, now: Item | undefined): How[] {
  if (!was && now) return [{ how: "added" }];
  if (was && !now) return [{ how: "removed" }];
  if (!was || !now) return [];
  if (!isNamed(on)) return sameJson(was, now) ? [] : [{ how: "changed" }];
  const out: How[] = [];
  if (was.label !== now.label)
    out.push({ how: "renamed", from: was.label ?? "", to: now.label ?? "" });
  if (!sameJson(withoutLabel(was), withoutLabel(now))) out.push({ how: "changed" });
  return out;
}

function partOf(on: MetroOn, a: MetroBody, b: MetroBody): MetroPart {
  const by = (xs: Item[]) => new Map(xs.map((x) => [x.id, x] as const));
  const was = by(itemsOf(a, on));
  const now = by(itemsOf(b, on));
  const part: MetroPart = { added: [], removed: [], renamed: [], changed: [] };
  for (const [id, n] of now) {
    for (const h of howOf(on, was.get(id), n)) {
      if (h.how === "added") part.added.push(id);
      else if (h.how === "renamed") part.renamed.push({ id, from: h.from ?? "", to: h.to ?? "" });
      else if (h.how === "changed") part.changed.push(id);
    }
  }
  for (const id of was.keys()) if (!now.has(id)) part.removed.push(id);
  return part;
}

/** Lines, stations, tracks, groups, frames and flows added, removed, renamed and changed. Pure. */
export function diffMetro(a: MetroBody, b: MetroBody): MetroDiff {
  return {
    lines: partOf("line", a, b),
    stations: partOf("station", a, b),
    tracks: partOf("track", a, b),
    groups: partOf("group", a, b),
    frames: partOf("frame", a, b),
    flows: partOf("flow", a, b),
    name: a.name === b.name ? null : { from: a.name, to: b.name },
  };
}

/**
 * One line of a diff, by what changed. `metroChangeKey` is how the CLI prints it and how undo
 * names it: `name`, `station:<id>:<how>`, `track:<id>:<how>`, and so on. The prefixes never clash
 * with `node:` and `edge:` of the graph model.
 */
export type MetroChange =
  | { on: "name" }
  | {
      on: "line" | "station" | "group" | "flow";
      id: string;
      how: "added" | "removed" | "renamed" | "changed";
    }
  | { on: "track" | "frame"; id: string; how: "added" | "removed" | "changed" };

/** Every change of a diff, in the order its lines read. */
export function metroChangesOf(d: MetroDiff): MetroChange[] {
  const out: MetroChange[] = d.name ? [{ on: "name" }] : [];
  for (const on of METRO_ONS) {
    const p = d[METRO_LISTS[on]];
    const add = (how: "added" | "removed" | "renamed" | "changed", id: string) =>
      out.push({ on, id, how } as MetroChange);
    for (const id of p.added) add("added", id);
    for (const id of p.removed) add("removed", id);
    for (const r of p.renamed) add("renamed", r.id);
    for (const id of p.changed) add("changed", id);
  }
  return out;
}

export const metroChangeKey = (c: MetroChange): string =>
  c.on === "name" ? "name" : `${c.on}:${c.id}:${c.how}`;

const NAMED_HOWS = ["added", "removed", "renamed", "changed"] as const;
const PLAIN_HOWS = ["added", "removed", "changed"] as const;

/** A key back to its change; null when it names none. */
export function parseMetroChangeKey(key: string): MetroChange | null {
  if (key === "name") return { on: "name" };
  const m = /^(line|station|track|group|frame|flow):(.+):([a-z]+)$/.exec(key);
  if (!m) return null;
  const [, on = "", id = "", how = ""] = m;
  const hows: readonly string[] = isNamed(on as MetroOn) ? NAMED_HOWS : PLAIN_HOWS;
  if (!hows.includes(how)) return null;
  return { on, id, how } as MetroChange;
}

/** A word for each kind, as a plain line says it. */
export const METRO_WORD: Record<MetroOn, string> = {
  line: "line",
  station: "station",
  track: "track",
  group: "group",
  frame: "frame",
  flow: "flow",
};

/**
 * The name of item `id` of kind `on` for a reader: a label, a track as "<from> to <to>" by station
 * label, else the id. `bodies` are searched in order, so the newer body comes first for an added
 * item and the older one for a removed item.
 */
export function metroNameOf(bodies: readonly MetroBody[], on: MetroOn, id: string): string {
  const station = (sid: string) =>
    bodies.map((b) => b.stations.find((s) => s.id === sid)?.label).find((l) => l) ?? sid;
  for (const b of bodies) {
    const item = itemsOf(b, on).find((x) => x.id === id);
    if (!item) continue;
    if (on === "track") {
      const t = b.tracks.find((x) => x.id === id);
      if (t) return `${station(t.from)} to ${station(t.to)}`;
    }
    if (item.label) return item.label;
  }
  return id;
}

/** One change as a plain line, by label: `a` is the older body, `b` the newer. */
export function metroChangeLine(a: MetroBody, b: MetroBody, c: MetroChange): string {
  if (c.on === "name") return `Shape renamed from ${a.name} to ${b.name}.`;
  const word = METRO_WORD[c.on];
  const newer = metroNameOf([b, a], c.on, c.id);
  const older = metroNameOf([a, b], c.on, c.id);
  if (c.how === "added") return `Added ${word} ${newer}.`;
  if (c.how === "removed") return `Removed ${word} ${older}.`;
  if (c.how === "renamed") return `Renamed ${word} ${older} to ${newer}.`;
  return `Changed ${word} ${newer}.`;
}

/** Every change of `diff` (from `a` to `b`) as a plain line. */
export const metroChangeLines = (a: MetroBody, b: MetroBody, diff: MetroDiff): string[] =>
  metroChangesOf(diff).map((c) => metroChangeLine(a, b, c));

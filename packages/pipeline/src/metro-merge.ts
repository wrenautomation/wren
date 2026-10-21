/**
 * The three-way merge of metro bodies, by id (designs/2026-10-20-design-language.md, proposal G).
 * `base` is the version a draft forked from, `live` is the newest version, `draft` is the edited
 * body. Pure: no database, no check of the merged body (apply checks it).
 *
 * Per item: if one side did not change it, the other side's item wins. If both changed it, it is
 * merged field by field: a field changed on one side only merges, a field changed on both sides
 * to different values is a conflict. Lists of members (a group's stations, a track's entries, an
 * attach list, a flow's stations and tracks) merge by member, so an add on one side and a remove
 * on the other both stay. A conflict never changes the merged body: it holds live's value.
 */
import { canonicalJson } from "./diff.js";
import type { MetroBody } from "./metro.js";
import {
  isNamed,
  itemsOf,
  METRO_ONS,
  METRO_WORD,
  type MetroOn,
  metroNameOf,
  parseMetroChangeKey,
} from "./metro-diff.js";

export interface Conflict {
  /** The change key of the item, as metro-diff gives it: `station:<id>:changed`, `name`. */
  key: string;
  /** The field both sides changed; none when the whole item clashes (removed on one side, changed on the other). */
  field?: string;
  /** Undefined when the field or item was not in base. */
  base: unknown;
  /** Undefined: removed or unset on live. */
  live: unknown;
  draft: unknown;
}

type Item = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** A member list: how to key a member, and whether an empty list drops the field. */
interface Members {
  keyOf: (m: unknown) => string;
  dropEmpty: boolean;
}

const text = (m: unknown): string => String(m);
const byId = (m: unknown): string => String((m as { id?: unknown }).id);
const byAttach = (m: unknown): string => {
  const a = m as { kind?: unknown; ref?: unknown };
  return `${String(a.kind)}\u0000${String(a.ref)}`;
};

const ATTACH: Members = { keyOf: byAttach, dropEmpty: true };
const STATIONS: Members = { keyOf: text, dropEmpty: false };

/** The fields that merge by member, per kind. */
const MEMBERS: Record<MetroOn, Record<string, Members>> = {
  line: { attach: ATTACH },
  station: { attach: ATTACH },
  track: { entries: { keyOf: text, dropEmpty: true } },
  group: { stations: STATIONS, attach: ATTACH },
  frame: { stations: STATIONS },
  flow: {
    stations: { keyOf: byId, dropEmpty: false },
    tracks: { keyOf: byId, dropEmpty: false },
  },
};

const sameSeq = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Did `xs` put the keys it shares with `base` in another order? */
function reordered(base: readonly string[], xs: readonly string[]): boolean {
  const inX = new Set(xs);
  const inBase = new Set(base);
  return !sameSeq(
    base.filter((k) => inX.has(k)),
    xs.filter((k) => inBase.has(k)),
  );
}

/**
 * The order of the kept keys. Live's order, then the draft's new keys in its order. When live did
 * not move anything and the draft did (or live is still base), the draft's order leads instead,
 * so a reorder in the draft survives and a draft equal to its merge keeps its own order.
 */
function orderOf(
  base: readonly string[],
  live: readonly string[],
  draft: readonly string[],
  keep: ReadonlySet<string>,
): string[] {
  const draftLeads = sameSeq(live, base) || (!reordered(base, live) && reordered(base, draft));
  const [first, second] = draftLeads ? [draft, live] : [live, draft];
  return [...new Set([...first, ...second])].filter((k) => keep.has(k));
}

/** One item or member by the three-way rule. `clash` is true when both sides changed it. */
function pick<T>(
  b: T | undefined,
  l: T | undefined,
  d: T | undefined,
): { v: T | undefined; clash: boolean } {
  if (same(l, d)) return { v: l, clash: false };
  if (same(l, b)) return { v: d, clash: false };
  if (same(d, b)) return { v: l, clash: false };
  return { v: l, clash: true };
}

/** Merge three member lists by member key. A member both sides changed differently clashes. */
function mergeMembers(
  b: unknown[] | undefined,
  l: unknown[] | undefined,
  d: unknown[] | undefined,
  keyOf: (m: unknown) => string,
): { list: unknown[]; clash: boolean } {
  const mapOf = (xs: unknown[] | undefined) => new Map((xs ?? []).map((x) => [keyOf(x), x]));
  const [bm, lm, dm] = [mapOf(b), mapOf(l), mapOf(d)];
  const kept = new Map<string, unknown>();
  let clash = false;
  for (const k of new Set([...lm.keys(), ...dm.keys(), ...bm.keys()])) {
    const r = pick(bm.get(k), lm.get(k), dm.get(k));
    if (r.clash) clash = true;
    if (r.v !== undefined) kept.set(k, r.v);
  }
  const keys = orderOf([...bm.keys()], [...lm.keys()], [...dm.keys()], new Set(kept.keys()));
  return { list: keys.map((k) => kept.get(k)), clash };
}

/** What both sides did to one field, or the whole item when `field` is none. */
interface Clash {
  field?: string;
  base: unknown;
  live: unknown;
  draft: unknown;
}

const isListOrNone = (x: unknown): x is unknown[] | undefined =>
  x === undefined || Array.isArray(x);

/** Merge one item of kind `on`. Any side may be missing. */
function mergeItem(
  on: MetroOn,
  b: Item | undefined,
  l: Item | undefined,
  d: Item | undefined,
): { item: Item | undefined; clashes: Clash[] } {
  const whole = pick(b, l, d);
  if (!whole.clash) return { item: whole.v, clashes: [] };
  if (!l || !d) return { item: l, clashes: [{ base: b, live: l, draft: d }] };

  const members = MEMBERS[on];
  const clashes: Clash[] = [];
  const out: Item = {};
  const fields = new Set([...Object.keys(l), ...Object.keys(d), ...Object.keys(b ?? {})]);
  for (const k of fields) {
    const [bv, lv, dv] = [b?.[k], l[k], d[k]];
    const r = pick(bv, lv, dv);
    let v = r.v;
    const how = members[k];
    if (r.clash && how && isListOrNone(bv) && isListOrNone(lv) && isListOrNone(dv)) {
      const m = mergeMembers(bv, lv, dv, how.keyOf);
      v = how.dropEmpty && m.list.length === 0 ? undefined : m.list;
      if (m.clash) clashes.push({ field: k, base: bv, live: lv, draft: dv });
    } else if (r.clash) {
      clashes.push({ field: k, base: bv, live: lv, draft: dv });
    }
    if (v !== undefined) out[k] = v;
  }
  return { item: out, clashes };
}

/** How metro-diff names a change to this field of this kind. */
const howOf = (on: MetroOn, field: string | undefined): "renamed" | "changed" =>
  field === "label" && isNamed(on) ? "renamed" : "changed";

/**
 * The three-way merge. Items of every kind merge by id, frames and flows included. List order:
 * live's items in live's order, then the draft's added items in the draft's order. A line the
 * draft moved keeps its new place when live did not reorder. `conflicts` come in a fixed order:
 * the name, then each kind of `METRO_ONS` by id, then field.
 */
export function mergeMetro(
  base: MetroBody,
  live: MetroBody,
  draft: MetroBody,
): { body: MetroBody; conflicts: Conflict[] } {
  const conflicts: Array<Conflict & { on: number; id: string }> = [];
  const lists: Partial<Record<MetroOn, Item[]>> = {};

  const name = pick(base.name, live.name, draft.name);
  if (name.clash) {
    conflicts.push({
      on: -1,
      id: "",
      key: "name",
      base: base.name,
      live: live.name,
      draft: draft.name,
    });
  }

  for (const [at, on] of METRO_ONS.entries()) {
    const rows = (body: MetroBody) => itemsOf(body, on) as Item[];
    const index = (body: MetroBody) => new Map(rows(body).map((r) => [String(r.id), r]));
    const [bm, lm, dm] = [index(base), index(live), index(draft)];
    const kept = new Map<string, Item>();
    for (const id of new Set([...lm.keys(), ...dm.keys(), ...bm.keys()])) {
      const r = mergeItem(on, bm.get(id), lm.get(id), dm.get(id));
      if (r.item) kept.set(id, r.item);
      for (const c of r.clashes) {
        conflicts.push({ on: at, id, key: `${on}:${id}:${howOf(on, c.field)}`, ...c });
      }
    }
    const ids = orderOf([...bm.keys()], [...lm.keys()], [...dm.keys()], new Set(kept.keys()));
    lists[on] = ids.map((id) => kept.get(id) as Item);
  }

  // The flows key stays when a side had it, so a body with no flows reads back as it was.
  const hasFlows = (lists.flow?.length ?? 0) > 0;
  const flowsKey = same(live.flows, base.flows)
    ? draft.flows !== undefined
    : live.flows !== undefined;
  const body = {
    model: "metro",
    name: name.v,
    lines: lists.line,
    stations: lists.station,
    tracks: lists.track,
    groups: lists.group,
    frames: lists.frame,
    ...(hasFlows || flowsKey ? { flows: lists.flow } : {}),
  } as unknown as MetroBody;

  conflicts.sort(
    (x, y) =>
      x.on - y.on ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) ||
      (x.field ?? "").localeCompare(y.field ?? ""),
  );
  return {
    body,
    conflicts: conflicts.map(({ on: _on, id: _id, ...c }) => c),
  };
}

// --- Saying a conflict --------------------------------------------------------------------------

/** A value for a plain line: JSON, `not set`, or `(changed)` when it is long. */
function show(v: unknown): string {
  if (v === undefined) return "not set";
  const t = JSON.stringify(v);
  return t.length > 60 ? "(changed)" : t;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One plain line for a conflict, with both values. `names` are the bodies to find an item's label
 * in, newest first (as `metroNameOf` takes them).
 */
export function conflictLine(c: Conflict, names: readonly MetroBody[]): string {
  const was = c.base === undefined ? "was not set" : `was ${show(c.base)}`;
  const change = c.key === "name" ? null : parseMetroChangeKey(c.key);
  if (!change || change.on === "name") {
    return `Shape name: ${show(c.live)} on live and ${show(c.draft)} in the draft (${was}).`;
  }
  const who = `${cap(METRO_WORD[change.on])} ${metroNameOf(names, change.on, change.id)}`;
  if (c.field !== undefined) {
    const live = c.live === undefined ? "not set on live" : `${show(c.live)} on live`;
    return `${who}: ${c.field} is ${live} and ${show(c.draft)} in the draft (${was}).`;
  }
  if (c.live === undefined) return `${who}: removed on live, changed in the draft.`;
  if (c.draft === undefined) return `${who}: changed on live, removed in the draft.`;
  return `${who}: changed on live and in the draft.`;
}

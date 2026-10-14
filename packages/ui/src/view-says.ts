/**
 * What a view or a filter keeps, in plain words, for the hover on its tab, chip or pill. Read from
 * the same `where` and `sort` the server runs, so it cannot drift from what the tab shows. A view
 * may carry its own `hint` and that wins. Pure; no React.
 */

import type { FieldMeta, Filter, RecordMeta, SavedView, Where } from "@wren/core/records";
import { DATE_PRESETS, readFilter } from "./fields.js";
import { num } from "./format.js";

type Named = Pick<RecordMeta, "fields" | "name">;

/** "a", "a or b", "a, b or c". */
export const orList = (xs: readonly string[]): string =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`;

const NUMBERS = new Set(["number", "money", "percent", "rate", "duration", "score"]);

/** A date from a filter value as it reads: "Oct 1", the year added when it isn't this one. */
function dayOf(v: unknown, now: Date): string {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** One filter on a field: "Type: comment or dm", "Seen: from Oct 1", "Email: empty". */
export function sayFilter(
  f: Pick<FieldMeta, "key" | "label" | "kind" | "states"> | undefined,
  key: string,
  filter: Filter,
  now = new Date(),
): string {
  const label = f?.label ?? key;
  const word = (v: unknown) => f?.states?.[String(v)]?.label ?? String(v);
  const date = f?.kind === "date";
  const show = (v: unknown) =>
    date ? dayOf(v, now) : NUMBERS.has(f?.kind ?? "") ? num(Number(v)) : String(v);
  if (typeof filter === "string" || typeof filter === "number") return `${label}: ${word(filter)}`;
  if (Array.isArray(filter)) return `${label}: ${orList(filter.map(word))}`;
  const o = filter as Partial<Record<string, unknown>>;
  const says: string[] = [];
  if (o.eq !== undefined) says.push(word(o.eq));
  if (Array.isArray(o.in)) says.push(orList(o.in.map(word)));
  if (o.contains !== undefined) says.push(`has “${String(o.contains)}”`);
  if (o.gte !== undefined && o.lte !== undefined)
    says.push(`between ${show(o.gte)} and ${show(o.lte)}`);
  else if (o.gte !== undefined) says.push(date ? `from ${show(o.gte)}` : `at least ${show(o.gte)}`);
  else if (o.lte !== undefined) says.push(date ? `until ${show(o.lte)}` : `at most ${show(o.lte)}`);
  if (o.empty !== undefined) says.push(o.empty ? "empty" : "has a value");
  return `${label}: ${says.join(", ") || "any"}`;
}

/** A filter as it rides in the address ("moved,hiring", "7d", "10..50", "~acme", "+"). */
export function sayRaw(f: FieldMeta, raw: string, now = new Date()): string {
  const preset = f.kind === "date" ? DATE_PRESETS.find((p) => p.id === raw) : undefined;
  if (preset) return `${f.label}: ${preset.says}`;
  const filter = readFilter(f, raw, now);
  return filter === undefined ? `${f.label}: ${raw}` : sayFilter(f, f.key, filter, now);
}

/** Every filter a view keeps, in the order its record declares the fields. */
export function sayWhere(
  meta: Pick<RecordMeta, "fields">,
  where: Where | undefined,
  now = new Date(),
) {
  const rest = Object.keys(where ?? {});
  const known = meta.fields.map((f) => f.key).filter((k) => rest.includes(k));
  return [...known, ...rest.filter((k) => !known.includes(k))].flatMap((k) => {
    const filter = where?.[k];
    return filter === undefined
      ? []
      : [
          sayFilter(
            meta.fields.find((f) => f.key === k),
            k,
            filter,
            now,
          ),
        ];
  });
}

/** "Sort: Received, newest first". `-` leads a descending sort. */
export function saySort(meta: Pick<RecordMeta, "fields">, sort: string | undefined): string | null {
  if (!sort) return null;
  const down = sort.startsWith("-");
  const key = down ? sort.slice(1) : sort;
  const f = meta.fields.find((x) => x.key === key);
  const kind = f?.kind ?? "";
  const dir =
    kind === "date"
      ? down
        ? "newest first"
        : "oldest first"
      : NUMBERS.has(kind)
        ? down
          ? "highest first"
          : "lowest first"
        : down
          ? "Z to A"
          : "A to Z";
  return `Sort: ${f?.label ?? key}, ${dir}`;
}

/** What a built-in tab shows: its `hint`, else its filters and sort. */
export function sayView(meta: Named, v: SavedView, now = new Date()): string {
  if (v.hint) return v.hint;
  const parts = [...sayWhere(meta, v.where, now), ...(v.mine ? ["Only yours"] : [])];
  const sort = saySort(meta, v.sort);
  return [parts.length ? parts.join(" · ") : `All ${meta.name.many}`, sort]
    .filter(Boolean)
    .join(" · ");
}

/** The tab a saved view starts from, its filters and its sort: what the address it keeps says. */
export function saySaved(
  meta: Named & Pick<RecordMeta, "views">,
  params: string,
  now = new Date(),
): string {
  const p = new URLSearchParams(params);
  const parts: string[] = [];
  const view = p.get("view");
  const from = view ? meta.views.find((v) => v.id === view) : undefined;
  if (from) parts.push(`From the ${from.label} tab`);
  for (const f of meta.fields) {
    const raw = p.get(f.key);
    if (raw) parts.push(sayRaw(f, raw, now));
  }
  const q = p.get("q");
  if (q) parts.push(`Search: “${q}”`);
  const sort = saySort(meta, p.get("sort") ?? undefined);
  if (sort) parts.push(sort);
  const group = p.get("group");
  if (group) parts.push(`Grouped by ${group}`);
  return parts.length ? parts.join(" · ") : `Every ${meta.name.one} in the tab`;
}

/** The filters set on a list now, as the Filter button says them. */
export function sayFilters(
  params: URLSearchParams,
  fields: readonly FieldMeta[],
  now = new Date(),
): string {
  const on = fields.flatMap((f) => {
    const raw = params.get(f.key);
    return raw ? [sayRaw(f, raw, now)] : [];
  });
  return on.length ? on.join(" · ") : "Narrow the list by any field";
}

/** The props that put `text` on hover (a native tooltip) and read it aloud on focus. */
export const tipProps = (text: string | undefined | null) =>
  text ? ({ title: text, "aria-description": text } as const) : {};

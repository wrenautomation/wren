/**
 * His calls on a breakdown's facts (designs/2026-10-25-competitor-analyzer.md, Decide): keep,
 * tune or drop, with his words, on the item (`learn:<id>`) or on one fact of it
 * (`learn:<id>/beats/2`, `learn:<id>/facts/shots/5`). Written through `recordCall` as the kind
 * `learn_fact`, so they sit in `decision_calls` beside his worth/skip calls and the agreement
 * numbers; Wren's workspace only. The rows a page or the CLI shows (`factRows`) are the paths a
 * call may name: a path outside them is refused, never written on nothing. A breakdown row is
 * never regenerated, so an index path stays what he called.
 */
import { WREN } from "@wren/core/access";
import { recordCall } from "@wren/core/decide";
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { type Beat, type BreakdownRow, breakdowns, items } from "./schema.js";

export const FACT_CALLS = ["keep", "tune", "drop"] as const;
export type FactCall = (typeof FACT_CALLS)[number];
export const isFactCall = (c: string): c is FactCall =>
  (FACT_CALLS as readonly string[]).includes(c);

/** The whole item. */
export const ITEM_PATH = "/";

export interface FactRow {
  /** `hook`, `beats/2`, `facts/shots/5`. */
  path: string;
  label: string;
  /** The whole value as words: never cut. */
  value: string;
}

export interface FactCallRow {
  path: string;
  call: FactCall;
  comment: string | null;
  by: string | null;
  at: Date;
}

export const factSubject = (id: number, path: string) =>
  path === ITEM_PATH ? `learn:${id}` : `learn:${id}/${path}`;

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const beatText = (b: Beat) => (b.t === null ? b.beat : `[${mmss(b.t)}] ${b.beat}`);

/** A fact's value as words: a list joined, an object as `k v` pairs, a scalar as is. */
function words(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map(words).join(", ");
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k} ${words(x)}`)
      .join(", ");
  return String(v);
}

/** A film shot as one line: when, how long, then each label it has. */
function shotText(s: Record<string, unknown>): string {
  const labels = (["type", "move", "in", "sound", "text"] as const)
    .map((k) => s[k])
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  return [`${mmss(Number(s.t))} · ${Number(s.len).toFixed(1)} s`, ...labels].join(" · ");
}

/** Names for a fact key as people read them; a key not here reads as itself. */
const FACT_LABELS: Record<string, string> = {
  format: "Format",
  shape: "Shape",
  chars: "Characters",
  lines: "Lines",
  first_line_chars: "First line",
  link: "Link",
  hashtags: "Hashtags",
  duration_s: "Length (s)",
  cuts: "Cuts",
  cuts_by_signal: "Cuts by detector",
  cuts_trust: "Cut count trust",
  shot_median_s: "Median shot (s)",
  shot_p90_s: "Longest shots (p90, s)",
  cuts_per_10s: "Cuts per 10 s",
  first_product_s: "Product first seen (s)",
  logo_s: "Logo (s)",
  cta_s: "Call to action (s)",
  music: "Music",
  vo: "Voice-over",
};

/** Every fact of a breakdown he can call, in reading order: the hook first, then beats, the ask, the kind's facts. */
export function factRows(
  b: Pick<
    BreakdownRow,
    "hookStyle" | "hook" | "hookWhy" | "topic" | "beats" | "ctaKind" | "cta" | "facts"
  >,
): FactRow[] {
  const rows: FactRow[] = [
    { path: "hook_style", label: "Hook style", value: b.hookStyle },
    { path: "hook", label: "Hook", value: `${b.hook} (${b.hookWhy})` },
    { path: "topic", label: "Topic", value: b.topic },
    ...b.beats.map((beat, i) => ({
      path: `beats/${i}`,
      label: `Beat ${i + 1}`,
      value: beatText(beat),
    })),
    { path: "cta", label: "Call to action", value: b.cta ? `${b.ctaKind}: ${b.cta}` : b.ctaKind },
  ];
  const facts = b.facts as Record<string, unknown>;
  for (const [k, v] of Object.entries(facts)) {
    if (k === "cta" || v === null || v === undefined) continue;
    if (k === "shots" && Array.isArray(v)) {
      rows.push(
        ...v.map((s, i) => ({
          path: `facts/shots/${i}`,
          label: `Shot ${i + 1}`,
          value: shotText(s as Record<string, unknown>),
        })),
      );
      continue;
    }
    rows.push({ path: `facts/${k}`, label: FACT_LABELS[k] ?? k, value: words(v) });
  }
  return rows;
}

/** A breakdown's own row, in `client`'s workspace. */
async function breakdownOf(
  db: Queryable,
  client: string,
  id: number,
): Promise<BreakdownRow | null> {
  const [row] = await db
    .select({ b: breakdowns })
    .from(breakdowns)
    .innerJoin(items, eq(items.id, breakdowns.itemId))
    .where(and(eq(breakdowns.itemId, id), eq(items.client, client)));
  return row?.b ?? null;
}

export class FactCallRefusal extends Error {}

/**
 * Record his call on an item or one of its facts. Refuses a workspace that is not Wren's, an
 * item with no breakdown, or a path the breakdown has not got. The newest call on a subject is
 * his standing one: a second call is a change of mind, never a replay, so no `ref`.
 */
export async function recordFactCall(
  db: Queryable,
  p: {
    client: string;
    id: number;
    path: string;
    call: FactCall;
    comment?: string | null | undefined;
    by: string | null;
    source: "console" | "cli";
  },
): Promise<{ subject: string; row: FactRow | null }> {
  if (p.client !== WREN) throw new FactCallRefusal("calls are Wren's own for now");
  const b = await breakdownOf(db, p.client, p.id);
  if (!b) throw new FactCallRefusal("no breakdown yet");
  const row = p.path === ITEM_PATH ? null : (factRows(b).find((r) => r.path === p.path) ?? null);
  if (p.path !== ITEM_PATH && !row) throw new FactCallRefusal(`no fact at ${p.path}`);
  const subject = factSubject(p.id, p.path);
  const comment = p.comment?.trim() || null;
  await recordCall(db, {
    kind: "learn_fact",
    subject,
    label: p.call,
    source: p.source,
    by: p.by,
    comment,
  });
  return { subject, row };
}

/** His standing call on each subject of an item: the newest per path. `/` is the item itself. */
export async function factCalls(db: Queryable, id: number): Promise<FactCallRow[]> {
  const rows = (await db.execute(sql`
    select distinct on (c.subject) c.subject, c.label, c.comment, c.by, c.at
    from decision_calls c
    where c.kind = 'learn_fact' and (c.subject = ${factSubject(id, ITEM_PATH)}
      or c.subject like ${`${factSubject(id, ITEM_PATH)}/%`})
    order by c.subject, c.at desc, c.id desc`)) as unknown as Record<string, unknown>[];
  const prefix = `${factSubject(id, ITEM_PATH)}/`;
  return rows
    .map((r) => ({
      path: String(r.subject).startsWith(prefix)
        ? String(r.subject).slice(prefix.length)
        : ITEM_PATH,
      call: String(r.label) as FactCall,
      comment: (r.comment as string | null) ?? null,
      by: (r.by as string | null) ?? null,
      at: new Date(String(r.at)),
    }))
    .filter((r) => isFactCall(r.call));
}

/**
 * Learn back (designs/2026-10-25-competitor-analyzer.md, Learn back): our own posted pieces go
 * through the same breakdown as anyone's, as Learn items tied to their draft (`draft_id`). Their
 * real numbers then test his calls: a pattern he kept whose pieces of ours sit under the median of
 * all ours in the SOP's scope comes back on each piece he kept it on as "check this". His calls
 * stay as he made them; he re-calls there. Ours never reach Competitors or the standard.
 */
import type { Db } from "@wren/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { saveLink } from "./items.js";
import { breakdowns, type CheckMeasure, checks, type ItemKind, items } from "./schema.js";
import { MIN_STANDARD, median, PATTERN_PATHS, type PatternRule, patternValue } from "./standard.js";

/** One of our posted pieces, as content gives it: what it is, and its real number. */
export interface OurPiece {
  draftId: string;
  kind: ItemKind;
  platform: string;
  url: string;
  title: string;
  /** The words we posted: a post's whole text, a video's caption. */
  text: string;
  /** Its real number on `measure`, as a share (0.42 = 42%). */
  outcome: number;
  measure: CheckMeasure;
}

/** The number each kind is judged on: a reel by its 3 s hook, a video or film by the share watched, a post by engagement per view. */
export const MEASURE_OF: Partial<Record<ItemKind, CheckMeasure>> = {
  reel: "hook",
  video: "watched",
  film: "watched",
  post: "engagement",
};

/**
 * Our pieces as Learn items, once each. A post is read already: its words are ours, so they are
 * its transcript. A video waits for the reader, like anyone's. Gives each piece's item id.
 */
export async function saveOurs(
  db: Db,
  client: string,
  pieces: OurPiece[],
): Promise<{ ids: Map<string, number>; saved: number }> {
  const out = new Map<string, number>();
  if (!pieces.length) return { ids: out, saved: 0 };
  const known = await db
    .select({ id: items.id, draftId: items.draftId })
    .from(items)
    .where(
      inArray(
        items.draftId,
        pieces.map((p) => p.draftId),
      ),
    );
  for (const k of known) if (k.draftId) out.set(k.draftId, k.id);
  const before = out.size;
  for (const p of pieces) {
    if (out.has(p.draftId)) continue;
    const saved = await saveLink(db, {
      client,
      url: p.url,
      by: null,
      via: "cli",
      title: p.title,
      kind: p.kind,
      worth: false,
    });
    const now = new Date();
    await db
      .update(items)
      .set({
        draftId: p.draftId,
        text: p.text,
        ...(p.kind === "post" ? { transcript: p.text, readAt: now, needsMac: null } : {}),
      })
      .where(eq(items.id, saved.id));
    out.set(p.draftId, saved.id);
  }
  return { ids: out, saved: out.size - before };
}

/** Each of our pieces' pattern values, off its breakdown, keyed by pattern path. Pieces not broken down yet are left out. */
export async function ourPatterns(
  db: Db,
  ids: readonly number[],
): Promise<Map<number, Map<string, string>>> {
  const out = new Map<number, Map<string, string>>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      id: breakdowns.itemId,
      hookStyle: breakdowns.hookStyle,
      ctaKind: breakdowns.ctaKind,
      facts: breakdowns.facts,
    })
    .from(breakdowns)
    .innerJoin(items, eq(items.id, breakdowns.itemId))
    .where(and(inArray(breakdowns.itemId, [...ids]), isNotNull(items.draftId)));
  for (const r of rows) out.set(r.id, patternsOf(r));
  return out;
}

/** A breakdown's closed-set values, as `rulesOf` counts them. */
export function patternsOf(b: {
  hookStyle: string;
  ctaKind: string;
  facts: Record<string, unknown>;
}): Map<string, string> {
  const m = new Map<string, string>([
    ["hook_style", b.hookStyle],
    ["cta", b.ctaKind],
  ]);
  for (const path of PATTERN_PATHS) {
    if (!path.startsWith("facts/")) continue;
    const v = b.facts[path.slice("facts/".length)];
    if (v !== null && v !== undefined) m.set(path, patternValue(path, String(v)));
  }
  return m;
}

/** A kept pattern our numbers disagree with, on one piece he kept it on. */
export type CheckRow = typeof checks.$inferInsert;

/**
 * The checks for one SOP and kind: for each pattern that is a rule (kept, never dropped), ours
 * that carry it against all ours. Both sides need `MIN_STANDARD` pieces; under that, nothing is
 * said. A rule whose pieces sit under the median of all comes back on every piece he kept it on.
 */
export function checksOf(
  sop: string,
  kind: ItemKind,
  patterns: PatternRule[],
  ours: { values: Map<string, string>; outcome: number }[],
  measure: CheckMeasure,
): CheckRow[] {
  if (ours.length < MIN_STANDARD) return [];
  const all = median(ours.map((o) => o.outcome));
  return patterns
    .filter((r) => r.rule)
    .flatMap((r) => {
      const carry = ours.filter((o) => o.values.get(r.path) === r.value).map((o) => o.outcome);
      if (carry.length < MIN_STANDARD) return [];
      const withMedian = median(carry);
      if (withMedian >= all) return [];
      const kept = [...new Set(r.calls.filter((c) => c.call === "keep").map((c) => c.id))];
      return kept.map((itemId) => ({
        itemId,
        sop,
        path: r.path,
        label: r.label,
        value: r.value,
        kind,
        measure,
        withN: carry.length,
        withMedian,
        allN: ours.length,
        allMedian: all,
      }));
    });
}

/** An SOP's checks, written whole: the last run's rows go. */
export async function writeChecks(db: Db, sop: string, rows: CheckRow[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(checks).where(eq(checks.sop, sop));
    if (rows.length) await tx.insert(checks).values(rows);
  });
}

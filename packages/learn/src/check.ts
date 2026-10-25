/**
 * One of our pieces held to an SOP (designs/2026-10-25-competitor-analyzer.md, Use): each standard
 * number beside ours, each closed set beside ours, and each pattern he kept or dropped that ours
 * meets or breaks. Pure: the caller reads the standard, the calls and our own facts. A post draft
 * (content `checkDraft`) and a Studio film (content video page) share it.
 */
import {
  type KindStandard,
  NUMBERS,
  type PatternRule,
  patternValue,
  SHARES,
  type StandardRow,
} from "./standard.js";

/** Where our number sits against the middle half of the standard. */
export type Where = "below" | "inside" | "above";
/** A pattern ours meets (one he kept), breaks (one he dropped), or neither. */
export type PatternVerdict = "meets" | "breaks" | "off";

export interface PieceCheck {
  kind: string;
  /** Pieces the standard counts; 0 with no standard. */
  n: number;
  numbers: {
    label: string;
    ours: number | null;
    median: number;
    p25: number;
    p75: number;
    where: Where | null;
  }[];
  shares: { label: string; ours: string | null; n: number; of: [string, number][] }[];
  patterns: { label: string; ours: string | null; kept: string[]; dropped: string[]; verdict: PatternVerdict }[];
}

/** Our facts, keyed like a `learn.standards` row. */
export type Ours = Partial<Record<keyof StandardRow, string | number | boolean | null>>;

/** The standards column each pattern path counts. */
const PATTERN_KEYS: Record<string, keyof StandardRow> = {
  hook_style: "hookStyle",
  cta: "ctaKind",
  "facts/format": "format",
  "facts/shape": "shape",
  "facts/link": "link",
  "facts/music": "music",
  "facts/vo": "vo",
};

const valueOf = (v: Ours[keyof Ours]): string | null =>
  v === null || v === undefined ? null : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

export function checkPiece(
  kind: string,
  standard: KindStandard | null,
  patterns: PatternRule[],
  ours: Ours,
): PieceCheck {
  const numberKeys = new Map((NUMBERS[kind] ?? []).map((x) => [x.label, x.key]));
  const shareKeys = new Map(
    [
      { key: "hookStyle" as const, label: "Hook style" },
      { key: "ctaKind" as const, label: "Call to action" },
      ...(SHARES[kind] ?? []),
    ].map((x) => [x.label, x.key]),
  );
  const numbers = (standard?.numbers ?? []).map((x) => {
    const key = numberKeys.get(x.label);
    const raw = key ? ours[key] : null;
    const v = typeof raw === "number" && !Number.isNaN(raw) ? raw : null;
    const where: Where | null =
      v === null ? null : v < x.p25 ? "below" : v > x.p75 ? "above" : "inside";
    return { ...x, ours: v, where };
  });
  const shares = (standard?.shares ?? []).map((x) => {
    const key = shareKeys.get(x.label);
    return { ...x, ours: key ? valueOf(ours[key]) : null };
  });
  const byPath = new Map<string, PatternRule[]>();
  for (const p of patterns) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p]);
  const checked = [...byPath].flatMap(([path, rs]) => {
    const key = PATTERN_KEYS[path];
    if (!key) return [];
    const kept = rs.filter((r) => r.rule).map((r) => r.value);
    const dropped = rs.filter((r) => r.drops > 0).map((r) => r.value);
    if (!kept.length && !dropped.length) return [];
    const raw = valueOf(ours[key]);
    const v = raw === null ? null : patternValue(path, raw);
    const verdict: PatternVerdict =
      v !== null && dropped.includes(v) ? "breaks" : v !== null && kept.includes(v) ? "meets" : "off";
    return [{ label: rs[0]?.label ?? path, ours: v, kept, dropped, verdict }];
  });
  return { kind, n: standard?.n ?? 0, numbers, shares, patterns: checked };
}

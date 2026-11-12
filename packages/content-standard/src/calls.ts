/**
 * His calls on a breakdown's facts (designs/2026-10-25-competitor-analyzer.md, Decide): keep,
 * tune or drop, with his words, on the whole piece (`/`) or on one fact of it (`beats/2`,
 * `facts/shots/5`). Each is a Canon `verdict` from `owner` citing the source (`wren source call`).
 * The rows `factRows` lists are the paths a call may name: a path outside them is refused.
 */
import type { Beat, Breakdown } from "./labels.js";

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
  /** Where it is in the video, when the breakdown says. */
  proof?: { t: number; len?: number };
}

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
    Breakdown,
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
      ...(beat.t === null ? {} : { proof: { t: beat.t } }),
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
          proof: { t: Number(s.t), len: Number(s.len) },
        })),
      );
      continue;
    }
    rows.push({ path: `facts/${k}`, label: FACT_LABELS[k] ?? k, value: words(v) });
  }
  return rows;
}

/**
 * What an SOP's pieces measure and what he called on them (designs/2026-10-25-competitor-analyzer.md,
 * Write; designs/2026-11-09-knowledge-repo.md, WA-1317). An SOP names what it governs in its
 * `notes.md` front matter: `kinds`, `platforms`, `topic` and `set` (the creators and brands the
 * standard counts). Pure: rows come from Canon sources (`canon.ts`), and the result goes to
 * `standard.md` and `calls.md` beside his notes and, on `wren topic push`, onto the playbook.
 */
import { type FactCall, ITEM_PATH } from "./calls.js";
import type { BreakdownBy } from "./labels.js";

export interface SopScope {
  kinds: string[];
  platforms: string[];
  topic: string;
  set: string[];
  /** The SOP's own name. */
  sop?: string;
}

/** `a, b` or `[a, b]` as a list; lower-cased, so a set of brands matches a creator however it is cased. */
const list = (v: string | undefined) =>
  (v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) =>
      x
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);

/** The scope in `notes.md`'s front matter; null when the notes name no kinds (the SOP governs no pieces). */
export function scopeOf(notes: string, sop?: string): SopScope | null {
  const fm = notes.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!fm) return null;
  const field = (k: string) => fm.match(new RegExp(`^${k}:[ \\t]*([^\\n]*)`, "m"))?.[1]?.trim();
  const kinds = list(field("kinds"));
  if (!kinds.length) return null;
  return {
    kinds,
    platforms: list(field("platforms")),
    topic: (field("topic") ?? "").replace(/^["']|["']$/g, ""),
    set: list(field("set")),
    ...(sop ? { sop } : {}),
  };
}

/** One picked piece's breakdown as a flat row: the kind's facts as columns, so a standard is a filter and a median. */
export interface StandardRow {
  /** The Canon source id. */
  id: string;
  kind: string;
  platform: string | null;
  creator: string | null;
  title: string;
  reach: number | null;
  at: string | null;
  by: BreakdownBy;
  hookStyle: string | null;
  ctaKind: string | null;
  format: string | null;
  shape: string | null;
  link: string | null;
  chars: number | null;
  lines: number | null;
  firstLineChars: number | null;
  hashtags: number | null;
  durationS: number | null;
  cuts: number | null;
  shotMedianS: number | null;
  shotP90S: number | null;
  firstProductS: number | null;
  logoS: number | null;
  ctaS: number | null;
  cutsTrust: string | null;
  music: boolean | null;
  vo: boolean | null;
}

/** A row in the scope: its kind, on its platforms, by its set (each empty = any). */
export const inScope = (r: StandardRow, scope: SopScope): boolean =>
  scope.kinds.includes(r.kind) &&
  (!scope.platforms.length || scope.platforms.includes((r.platform ?? "").toLowerCase())) &&
  (!scope.set.length || scope.set.includes((r.creator ?? "").toLowerCase()));

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
/** Linear interpolation between the two ranks the quantile falls on. */
const quartile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = s[Math.floor(pos)] ?? 0;
  const hi = s[Math.ceil(pos)] ?? lo;
  return lo + (hi - lo) * (pos - Math.floor(pos));
};
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The number columns each kind reports, in reading order. A film's cut numbers count trusted films only. */
export const NUMBERS: Record<
  string,
  { key: keyof StandardRow; label: string; trusted?: boolean }[]
> = {
  post: [
    { key: "chars", label: "Characters" },
    { key: "lines", label: "Lines" },
    { key: "firstLineChars", label: "First line (characters)" },
    { key: "hashtags", label: "Hashtags" },
  ],
  film: [
    { key: "durationS", label: "Length (s)" },
    { key: "cuts", label: "Cuts", trusted: true },
    { key: "shotMedianS", label: "Median shot (s)", trusted: true },
    { key: "shotP90S", label: "Longest shots (p90, s)", trusted: true },
    { key: "firstProductS", label: "Product first seen (s)" },
    { key: "logoS", label: "Logo (s)" },
    { key: "ctaS", label: "Call to action (s)" },
  ],
};
/** The closed-set columns each kind reports as shares. */
export const SHARES: Record<string, { key: keyof StandardRow; label: string }[]> = {
  reel: [{ key: "format", label: "Format" }],
  video: [{ key: "format", label: "Format" }],
  post: [
    { key: "shape", label: "Shape" },
    { key: "format", label: "Format" },
    { key: "link", label: "Link" },
  ],
  film: [
    { key: "music", label: "Music" },
    { key: "vo", label: "Voice-over" },
  ],
};

export interface KindStandard {
  kind: string;
  n: number;
  /** Films whose cut count both detectors agree on. */
  trusted: number;
  numbers: { label: string; n: number; median: number; p25: number; p75: number }[];
  shares: { label: string; n: number; of: [string, number][] }[];
}

/** The standard for one kind's rows: each number's median and middle half, each closed set's counts. */
export function kindStandard(kind: string, rows: StandardRow[]): KindStandard {
  const trusted = rows.filter((r) => r.cutsTrust === "ok");
  const numbers = (NUMBERS[kind] ?? []).flatMap(({ key, label, trusted: t }) => {
    const xs = (t ? trusted : rows)
      .map((r) => r[key])
      .filter((v) => v !== null && v !== undefined)
      .map(Number)
      .filter((v) => !Number.isNaN(v));
    return xs.length
      ? [
          {
            label,
            n: xs.length,
            median: median(xs),
            p25: quartile(xs, 0.25),
            p75: quartile(xs, 0.75),
          },
        ]
      : [];
  });
  const share = (key: keyof StandardRow, label: string) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[key];
      if (v === null || v === undefined) continue;
      const k = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const of = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { label, n: of.reduce((n, [, c]) => n + c, 0), of };
  };
  return {
    kind,
    n: rows.length,
    trusted: kind === "film" ? trusted.length : rows.length,
    numbers,
    shares: [
      share("hookStyle", "Hook style"),
      share("ctaKind", "Call to action"),
      ...(SHARES[kind] ?? []).map((s) => share(s.key, s.label)),
    ].filter((s) => s.n > 0),
  };
}

/** The standard for a scope: one block per kind that has pieces, in the scope's order. */
export function standardOf(all: StandardRow[], scope: SopScope): KindStandard[] {
  const rows = all.filter((r) => inScope(r, scope));
  return scope.kinds
    .map((k) =>
      kindStandard(
        k,
        rows.filter((r) => r.kind === k),
      ),
    )
    .filter((k) => k.n > 0);
}

/** One kind's standard as lines: each number's median and middle half, each closed set's counts. */
export function standardLines(k: KindStandard): string[] {
  const numbers = k.numbers.map(
    (x) =>
      `- ${x.label}: median ${num(x.median)}, half between ${num(x.p25)} and ${num(x.p75)}${x.n < k.n ? ` (${x.n} of ${k.n})` : ""}`,
  );
  const shares = k.shares.map(
    (s) => `- ${s.label}: ${s.of.map(([v, c]) => `${v} ${c}`).join(", ")} (of ${s.n})`,
  );
  return [...numbers, ...shares];
}

/** Pieces a standard needs before a draft is held to it: fewer, and a median says nothing. */
export const MIN_STANDARD = 5;

/**
 * The scope one draft is held to: its own kind on its own platform, by the SOP's set. An SOP with
 * no scope in its notes still governs its platform's posts, by everyone in Canon.
 */
export const draftScope = (
  playbook: { sop: string; scope: SopScope | null } | null,
  kind: string,
  platform: string,
): SopScope => ({
  kinds: [kind],
  platforms: [platform],
  topic: playbook?.scope?.topic ?? "",
  set: playbook?.scope?.set ?? [],
  ...(playbook ? { sop: playbook.sop } : {}),
});

/**
 * What `wren topic push` stores on the playbook (`content_playbooks.standard`): prod cannot read
 * Canon, so the draft and film checks read this snapshot.
 */
export interface PlaybookStandard {
  at: string;
  kinds: KindStandard[];
  calls: SopCall[];
}

/** One kind's standard in a snapshot; null under `MIN_STANDARD` pieces or none. */
export function kindStandardIn(
  snap: PlaybookStandard | null | undefined,
  kind: string,
): KindStandard | null {
  const k = snap?.kinds.find((x) => x.kind === kind);
  return k && k.n >= MIN_STANDARD ? k : null;
}

const scopeLine = (scope: SopScope) =>
  [
    `kinds ${scope.kinds.join(", ")}`,
    `platforms ${scope.platforms.join(", ") || "any"}`,
    `set ${scope.set.join(", ") || "any"}`,
  ].join("; ");

/** `standard.md`: the numbers as the SOP's prompt reads them. */
export function standardMarkdown(scope: SopScope, kinds: KindStandard[], at = new Date()): string {
  const n = kinds.reduce((s, k) => s + k.n, 0);
  const head = [
    "# Standard",
    "",
    `Numbers from Canon sources' breakdowns for ${scopeLine(scope)}: ${n} piece${n === 1 ? "" : "s"} as of ${at.toISOString().slice(0, 10)}. Code writes this file; it is rewritten on every \`wren topic sync\` and \`wren topic build\`.`,
  ];
  if (!kinds.length) return `${head.join("\n")}\n\nNo pieces yet: nothing to measure.\n`;
  const blocks = kinds.map((k) => {
    const title =
      k.kind === "film"
        ? `## ${k.kind} (${k.n} piece${k.n === 1 ? "" : "s"}, ${k.trusted} with a trusted cut count)`
        : `## ${k.kind} (${k.n} piece${k.n === 1 ? "" : "s"})`;
    return [title, ...standardLines(k)].join("\n");
  });
  return `${[...head, "", ...blocks].join("\n\n").replace(/\n\n\n/g, "\n\n")}\n`;
}

export interface SopCall {
  /** The Canon source id. */
  id: string;
  title: string;
  creator: string | null;
  path: string;
  label: string;
  value: string;
  call: FactCall;
  comment: string | null;
  at: string;
}

/** Keeps on one pattern, with no drop, that make it a rule on its own. */
export const RULE_KEEPS = 3;
/** The paths whose value is a pattern across pieces (a closed set), not this piece's own words. */
export const PATTERN_PATHS = new Set([
  "hook_style",
  "cta",
  "facts/format",
  "facts/shape",
  "facts/link",
  "facts/music",
  "facts/vo",
]);
/** A closed-set value as the standard counts it: a call to action by its kind, a boolean as yes / no. */
export const patternValue = (path: string, value: string): string => {
  const v = path === "cta" ? (value.split(":")[0] ?? "") : value;
  return v === "true" ? "yes" : v === "false" ? "no" : v.trim();
};

/** One closed-set value his calls touched, counted across pieces. */
export interface PatternRule {
  path: string;
  label: string;
  value: string;
  keeps: number;
  tunes: number;
  drops: number;
  /** Kept on `RULE_KEEPS` pieces with no drop: a rule. */
  rule: boolean;
  calls: SopCall[];
}

/** His calls as rules: patterns counted across pieces, and each call on a piece's own words. */
export function rulesOf(calls: SopCall[]): { patterns: PatternRule[]; own: SopCall[] } {
  const by = new Map<string, PatternRule>();
  for (const c of calls.filter((c) => PATTERN_PATHS.has(c.path))) {
    const value = patternValue(c.path, c.value);
    const label = c.path === "cta" ? "Call to action" : c.label;
    const k = `${c.path}\u0000${value}`;
    const r = by.get(k) ?? {
      path: c.path,
      label,
      value,
      keeps: 0,
      tunes: 0,
      drops: 0,
      rule: false,
      calls: [],
    };
    r.calls.push(c);
    if (c.call === "keep") r.keeps++;
    else if (c.call === "tune") r.tunes++;
    else r.drops++;
    r.rule = r.keeps >= RULE_KEEPS && !r.drops;
    by.set(k, r);
  }
  return {
    patterns: [...by.values()].sort((a, b) =>
      `${a.label}: ${a.value}`.localeCompare(`${b.label}: ${b.value}`),
    ),
    own: calls.filter((c) => !PATTERN_PATHS.has(c.path)),
  };
}

const cite = (c: SopCall) => c.id;
const who = (c: SopCall) => `${c.title}${c.creator ? `, ${c.creator}` : ""}`;
const said = (c: SopCall) => (c.comment ? ` "${c.comment}"` : "");

/** `calls.md`: patterns counted across pieces, then each call on a piece's own words, by call. */
export function callsMarkdown(scope: SopScope, calls: SopCall[], at = new Date()): string {
  const head = [
    "# Calls",
    "",
    `His keep / tune / drop calls on the pieces this SOP covers (${scopeLine(scope)}), as of ${at.toISOString().slice(0, 10)}. Code writes this file from his Canon verdicts; a call changes with \`wren source call\`.`,
  ];
  if (!calls.length) return `${head.join("\n")}\n\nNo calls yet.\n`;
  const { patterns, own } = rulesOf(calls);
  const patternLines = patterns.map((r) => {
    const counts = (
      [
        ["keep", r.keeps],
        ["tune", r.tunes],
        ["drop", r.drops],
      ] as const
    )
      .filter(([, n]) => n)
      .map(([call, n]) => `${call} ${n}`)
      .join(", ");
    const words = r.calls
      .filter((c) => c.comment)
      .map((c) => `"${c.comment}" [${cite(c)}]`)
      .join("; ");
    return `- ${r.label}: ${r.value}: ${counts}${r.rule ? " → rule" : ""} [${r.calls.map(cite).join(", ")}]${words ? ` (${words})` : ""}`;
  });
  const section = (call: FactCall, title: string) => {
    const cs = own.filter((c) => c.call === call);
    if (!cs.length) return [];
    return [
      `## ${title}`,
      ...cs.map((c) =>
        c.path === ITEM_PATH
          ? `- Whole piece: ${who(c)}${said(c)} [${cite(c)}]`
          : `- ${c.label} "${c.value}" (${who(c)})${said(c)} [${cite(c)}]`,
      ),
    ];
  };
  const body = [
    ...(patternLines.length ? ["## Patterns", ...patternLines] : []),
    ...section("keep", "Keep"),
    ...section("tune", "Tune: do this, with the change in his words"),
    ...section("drop", "Drop: never do this"),
  ];
  return `${[...head, "", ...body].join("\n").replace(/\n(## )/g, "\n\n$1")}\n`;
}

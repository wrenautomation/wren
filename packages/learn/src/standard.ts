/**
 * What an SOP's pieces measure and what he called on them (designs/2026-10-25-competitor-analyzer.md,
 * Write). An SOP names what it governs in its `notes.md` front matter: `kinds`, `platforms`,
 * `topic` and `set` (the creators and brands the standard counts). From that scope code writes two
 * files beside his notes: `standard.md`, the numbers off `learn.standards`, and `calls.md`, his
 * keep / tune / drop calls rolled up with his words and the piece ids. `sop build` reads both as
 * files (`@wren/research/sops`), so research never imports learn.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type FactCall, factRows, ITEM_PATH, isFactCall } from "./calls.js";
import { breakdowns, items, sopSources, standards } from "./schema.js";

export interface SopScope {
  kinds: string[];
  platforms: string[];
  topic: string;
  set: string[];
  /** The SOP's own name, so the standard reads its content line when it has one (`lineItems`). */
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

export type StandardRow = typeof standards.$inferSelect;

/**
 * The Wren items on the SOP's content line (designs/2026-10-25-ingestion-engine.md): the standard
 * is a reader over the line, so once the line has taken a document only its documents count. Null
 * while no instance names the SOP: the scope alone decides.
 */
async function lineItems(db: Queryable, sop: string | undefined): Promise<Set<number> | null> {
  if (!sop) return null;
  const rows = (await db.execute(sql`
    select i.id from learn.items i
    where i.client = 'wren' and i.document_id in (select j.document_id from pipeline.instances j
      where j.subject_kind = 'document' and j.entry_ref->>'sop' = ${sop})`)) as unknown as {
    id: number;
  }[];
  return rows.length ? new Set(rows.map((r) => Number(r.id))) : null;
}

/**
 * The in-scope rows of `learn.standards`: the SOP's kinds, on its platforms, by its set (each
 * empty = any), and on its line when it has one.
 */
export async function standardRows(db: Queryable, scope: SopScope): Promise<StandardRow[]> {
  const [rows, line] = await Promise.all([
    db.select().from(standards).where(inArray(standards.kind, scope.kinds)),
    lineItems(db, scope.sop),
  ]);
  return rows.filter(
    (r) =>
      (!line || line.has(Number(r.id))) &&
      (!scope.platforms.length || scope.platforms.includes((r.platform ?? "").toLowerCase())) &&
      (!scope.set.length || scope.set.includes((r.creator ?? "").toLowerCase())),
  );
}

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
export async function standardOf(db: Queryable, scope: SopScope): Promise<KindStandard[]> {
  const rows = await standardRows(db, scope);
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
 * The scope one draft is held to: its own kind on its own platform, by the SOP's set and line. An
 * SOP with no scope in its notes still governs its platform's posts, by everyone Learn read.
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

/** The standard for one kind in a scope; null under `MIN_STANDARD` pieces. */
export async function kindStandardOf(db: Queryable, scope: SopScope): Promise<KindStandard | null> {
  const [k] = await standardOf(db, scope);
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
    `Numbers from \`learn.standards\` for ${scopeLine(scope)}: ${n} piece${n === 1 ? "" : "s"} as of ${at.toISOString().slice(0, 10)}. Code writes this file; it is rewritten on every \`wren sop sync\` and \`wren sop build\`.`,
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
  id: number;
  title: string;
  creator: string | null;
  path: string;
  label: string;
  value: string;
  call: FactCall;
  comment: string | null;
  at: Date;
}

/**
 * His standing calls on the pieces an SOP covers: on its line when it has one (a dropped piece
 * too), else in its scope or asked into it ("Add to SOP"). The newest call per subject; a call
 * on a path the breakdown no longer lists is dropped.
 */
export async function callsOf(db: Queryable, scope: SopScope, sop: string): Promise<SopCall[]> {
  const line = await lineItems(db, sop);
  const inScope = line ? [] : (await standardRows(db, scope)).map((r) => Number(r.id));
  const asked = line
    ? []
    : (
        await db
          .select({ id: sopSources.itemId })
          .from(sopSources)
          .where(and(eq(sopSources.sop, sop), eq(sopSources.state, "added")))
      ).map((r) => Number(r.id));
  const ids = [...new Set([...(line ?? []), ...inScope, ...asked])];
  if (!ids.length) return [];
  const rows = await db
    .select({ b: breakdowns, doc: items.documentId, title: items.title, creator: items.creator })
    .from(breakdowns)
    .innerJoin(items, eq(items.id, breakdowns.itemId))
    .where(inArray(breakdowns.itemId, ids));
  if (!rows.length) return [];
  // Two items can share one document: each shows the calls on it.
  const byDoc = new Map<number, typeof rows>();
  for (const r of rows) byDoc.set(r.doc, [...(byDoc.get(r.doc) ?? []), r]);
  const docs = sql.raw(`array[${[...byDoc.keys()].join(",")}]::int[]`);
  const calls = (await db.execute(sql`
    select distinct on (c.subject) c.subject, c.label, c.comment, c.at
    from decision_calls c
    where c.kind in ('document', 'finding')
      and split_part(split_part(c.subject, ':', 2), '/', 1)::int = any(${docs})
    order by c.subject, c.at desc, c.id desc`)) as unknown as Record<string, unknown>[];
  const out: SopCall[] = [];
  for (const c of calls) {
    const subject = String(c.subject);
    const [docPart, ...rest] = subject.slice("doc:".length).split("/");
    const path = rest.length ? rest.join("/") : ITEM_PATH;
    const call = String(c.label);
    if (!isFactCall(call)) continue;
    for (const row of byDoc.get(Number(docPart)) ?? []) {
      const fact =
        path === ITEM_PATH
          ? { label: "Whole piece", value: "" }
          : factRows(row.b).find((r) => r.path === path);
      if (!fact) continue;
      out.push({
        id: Number(row.b.itemId),
        title: row.title,
        creator: row.creator,
        path,
        label: fact.label,
        value: fact.value,
        call,
        comment: (c.comment as string | null) ?? null,
        at: new Date(String(c.at)),
      });
    }
  }
  return out.sort((a, b) => a.id - b.id || a.path.localeCompare(b.path));
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

const cite = (c: SopCall) => `learn:${c.id}`;
const who = (c: SopCall) => `${c.title}${c.creator ? `, ${c.creator}` : ""}`;
const said = (c: SopCall) => (c.comment ? ` "${c.comment}"` : "");

/** `calls.md`: patterns counted across pieces, then each call on a piece's own words, by call. */
export function callsMarkdown(scope: SopScope, calls: SopCall[], at = new Date()): string {
  const head = [
    "# Calls",
    "",
    `His keep / tune / drop calls on the pieces this SOP covers (${scopeLine(scope)}), as of ${at.toISOString().slice(0, 10)}. Code writes this file from \`decision_calls\`; a call changes on the item page or with \`wren learn call\`.`,
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

/**
 * Write `standard.md` and `calls.md` into an SOP's folder from its scope. Null when the notes
 * name no kinds: the SOP governs no pieces, and the two files are not written.
 */
export async function writeSopFiles(
  db: Queryable,
  dir: string,
  sop: string,
  notes: string,
): Promise<{ scope: SopScope; files: string[]; pieces: number; calls: number } | null> {
  const scope = scopeOf(notes, sop);
  if (!scope) return null;
  const [standard, calls] = await Promise.all([standardOf(db, scope), callsOf(db, scope, sop)]);
  const files = [join(dir, "standard.md"), join(dir, "calls.md")];
  await writeFile(files[0] as string, standardMarkdown(scope, standard));
  await writeFile(files[1] as string, callsMarkdown(scope, calls));
  return { scope, files, pieces: standard.reduce((n, k) => n + k.n, 0), calls: calls.length };
}

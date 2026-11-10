/**
 * The content playbook (designs/2026-11-10-content-playbook.md, WA-1289). Canon's guide
 * `content-playbook` holds the content types (`types:` in its frontmatter: type, kind, the rule sets
 * it loads). A locked Vireo tip becomes one line in the proven set of each type it reaches; code
 * writes the line (the tip's own words + its verdict id), never a model. Unlock retires the line.
 */
import {
  type Change,
  loadWorking,
  type Pushed,
  push,
  readRecord,
  renderMany,
} from "@wrenautomation/knowledge";
import { KINDS, type Kind } from "@wrenautomation/vireo";

export const PLAYBOOK = "content-playbook";

export interface ContentType {
  type: string;
  kind: Kind;
  /** rule set ids, owner topics' */
  sets: string[];
}

type Fields = Record<string, unknown>;

/** The guide's type table; every set a row names must be one the guide cites (lint checks those live). */
export function typesOf(guide: Fields | null | undefined): ContentType[] {
  if (!guide) return [];
  const raw = guide.types;
  if (!Array.isArray(raw)) throw new Error(`${PLAYBOOK}: no types list in its frontmatter`);
  const cites = new Set((guide.cites as string[] | undefined) ?? []);
  const seen = new Set<string>();
  return raw.map((r: Fields) => {
    const type = String(r.type ?? "");
    const kind = r.kind as Kind;
    const sets = Array.isArray(r.sets) ? r.sets.map(String) : [];
    if (!/^[a-z][a-z0-9-]*$/.test(type))
      throw new Error(`${PLAYBOOK}: bad type ${JSON.stringify(type)}`);
    if (seen.has(type)) throw new Error(`${PLAYBOOK}: type ${type} twice`);
    if (!KINDS.includes(kind))
      throw new Error(`${PLAYBOOK}: ${type} kind: one of ${KINDS.join(", ")}`);
    const loose = sets.filter((s) => !cites.has(s));
    if (loose.length)
      throw new Error(`${PLAYBOOK}: ${type} names ${loose.join(", ")}; cite it in the guide`);
    seen.add(type);
    return { type, kind, sets };
  });
}

/** The types a tip reaches: its subject's, its kind's, or all. */
export function reachOf(
  tip: { subjectId: number | null; kind: string | null },
  subjectType: string | null,
  types: readonly ContentType[],
): string[] {
  if (tip.subjectId != null)
    return subjectType && types.some((t) => t.type === subjectType) ? [subjectType] : [];
  return types.filter((t) => !tip.kind || t.kind === tip.kind).map((t) => t.type);
}

/** The type names in a Canon checkout; none there (prod has no checkout): [] = any text. */
export function contentTypesIn(root: string): string[] {
  try {
    const g = readRecord(root, PLAYBOOK);
    return g ? typesOf(g.fm as Fields).map((t) => t.type) : [];
  } catch {
    return [];
  }
}

/** Push Canon (merges a moved origin; refuses new lint errors). */
export const pushCanon = (root: string): Pushed => push(root);

export const provenId = (type: string) => `${PLAYBOOK}-proven-${type}`;
/** `P` + the type's word initials (`short-video` → PSV), or its first two letters (`thread` → PTH). */
export const provenPrefix = (type: string) => {
  const w = type.toUpperCase().split("-").filter(Boolean);
  return `P${
    w.length > 1
      ? w
          .map((x) => x[0])
          .join("")
          .slice(0, 2)
      : (w[0] ?? "").slice(0, 2)
  }`;
};

const LINE = /^- \*\*([A-Z]{2,3})-(\d+)\*\* (.*) \[([a-z0-9][a-z0-9-]*)\]$/;

export interface ProvenLine {
  id: string;
  n: number;
  text: string;
  verdict: string;
}

export function provenLines(body: string): ProvenLine[] {
  return body.split("\n").flatMap((l) => {
    const m = LINE.exec(l.trim());
    return m
      ? [{ id: `${m[1]}-${m[2]}`, n: Number(m[2]), text: m[3] as string, verdict: m[4] as string }]
      : [];
  });
}

export interface LockedTip {
  verdict: string;
  text: string;
  reach: string[];
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Changes that bring each proven set up to the locked tips. A kept line keeps its id; a new one takes
 * last + 1; an id is never used again. A set with no line keeps its last cites (lint: a rule cites).
 */
export function provenChanges(
  have: ReadonlyMap<string, { fm: Fields; body: string }>,
  types: readonly ContentType[],
  tips: readonly LockedTip[],
): Change[] {
  const out: Change[] = [];
  for (const t of types) {
    const id = provenId(t.type);
    const cur = have.get(id);
    const want = tips.filter((x) => x.reach.includes(t.type));
    if (!cur && !want.length) continue;
    if (cur && cur.fm.status !== "live")
      throw new Error(`${id} is retired; a proven set stays live`);
    const prefix = (cur?.fm.prefix as string | undefined) ?? provenPrefix(t.type);
    const old = provenLines(cur?.body ?? "");
    let last = Math.max(Number(cur?.fm.last ?? 0), 0, ...old.map((l) => l.n));
    const lines: ProvenLine[] = [];
    for (const l of old) {
      const w = want.find((x) => x.verdict === l.verdict);
      if (w) lines.push({ ...l, text: oneLine(w.text) });
    }
    for (const w of want)
      if (!lines.some((l) => l.verdict === w.verdict))
        lines.push({
          id: `${prefix}-${++last}`,
          n: last,
          text: oneLine(w.text),
          verdict: w.verdict,
        });
    const body = [
      `# Proven: ${t.type}`,
      "",
      `Tips locked in Vireo that reach ${t.type}. Code writes each line from the tip and its verdict; \`wren playbook ${t.type}\` prints the numbers. A line here wins over a set line it disagrees with.`,
      "",
      ...lines.map((l) => `- **${l.id}** ${l.text} [${l.verdict}]`),
    ].join("\n");
    const cites = lines.length ? lines.map((l) => l.verdict) : ((cur?.fm.cites as string[]) ?? []);
    if (!cur) {
      out.push({
        op: "add",
        type: "rule",
        id,
        title: `Content playbook: proven ${t.type}`,
        topic: PLAYBOOK,
        prefix,
        last,
        contentType: t.type,
        cites,
        body,
      });
      continue;
    }
    const patch: Fields = {};
    if (cur.body.trim() !== body.trim()) patch.body = body;
    if (JSON.stringify(cur.fm.cites ?? []) !== JSON.stringify(cites)) patch.cites = cites;
    if (cur.fm.last !== last) patch.last = last;
    if (Object.keys(patch).length) out.push({ op: "edit", id, ...patch });
  }
  return out;
}

interface Arm {
  good: number;
  n: number;
}
const pct = (a: Arm) => (a.n ? `${Math.round((100 * a.good) / a.n)}%` : "none");

export interface Playbook {
  type: string;
  kind: Kind;
  proven: {
    id: string;
    text: string;
    verdict: string;
    with: Arm | null;
    without: Arm | null;
    judged: number;
    early: boolean;
    /** the tip's reach: a subject slug, a kind, or `all` */
    over: string;
  }[];
  sets: string[];
  references: { id: string; title: string; score: number | null; media?: string; body: string }[];
  text: string;
}

/** What an agent reads before it makes a piece of this type: guide, type's sets, proven lines with numbers, top kept samples. */
export function readPlaybook(root: string, type: string): Playbook {
  const docs = new Map(loadWorking(root).docs.map((l) => [l.doc.fm.id, l.doc]));
  const guide = docs.get(PLAYBOOK);
  if (guide?.fm.status !== "live") throw new Error(`no live ${PLAYBOOK} guide in ${root}`);
  const types = typesOf(guide.fm as Fields);
  const t = types.find((x) => x.type === type);
  if (!t) throw new Error(`type: one of ${types.map((x) => x.type).join(", ")}`);

  const set = docs.get(provenId(type));
  const proven = (set?.fm.status === "live" ? provenLines(set.body) : []).map((l) => {
    const v = docs.get(l.verdict)?.fm as Fields | undefined;
    const e = v?.effect as { with: Arm; without: Arm; early: boolean } | undefined;
    const scope = String(v?.scope ?? "all");
    return {
      id: l.id,
      text: l.text,
      verdict: l.verdict,
      with: e?.with ?? null,
      without: e?.without ?? null,
      judged: (e?.with.n ?? 0) + (e?.without.n ?? 0),
      early: e?.early ?? true,
      over: scope,
    };
  });
  const references = [...docs.values()]
    .filter(
      (d) =>
        d.fm.type === "verdict" &&
        d.fm.status === "live" &&
        (d.fm.tags as string[] | undefined)?.includes(`content-type:${type}`),
    )
    .map((d) => {
      const f = d.fm as Fields;
      return {
        id: String(f.id),
        title: String(f.title),
        score: typeof f.score === "number" ? f.score : null,
        ...(typeof f.media === "string" ? { media: f.media } : {}),
        body: d.body,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 5);

  const over = (s: string) =>
    s === "all" ? "over all types" : KINDS.includes(s as Kind) ? `over all ${s}` : `over ${s}`;
  const text = [
    renderMany(root, [PLAYBOOK, ...t.sets]).trim(),
    "",
    `# Proven for ${type}`,
    "",
    proven.length
      ? proven
          .map(
            (p) =>
              `- **${p.id}** ${p.text} [${p.verdict}]: good ${p.with ? pct(p.with) : "?"} with, ${p.without ? pct(p.without) : "?"} without; ${p.judged} judged ${over(p.over)}${p.early ? "; early" : ""}`,
          )
          .join("\n")
      : "None yet. A tip locked in Vireo that reaches this type lands here.",
    "",
    `# Kept samples (${type}, top ${references.length})`,
    "",
    references.length
      ? references
          .map(
            (r) =>
              `## ${r.title} (score ${r.score ?? "?"}) [${r.id}]\n\n${r.media ? `media: ${r.media}\n\n` : ""}${r.body.trim()}`,
          )
          .join("\n\n")
      : "None yet.",
  ].join("\n");
  return { type, kind: t.kind, proven, sets: t.sets, references, text: `${text}\n` };
}

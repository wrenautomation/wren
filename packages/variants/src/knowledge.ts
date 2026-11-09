/**
 * Vireo's results as verdict records in the knowledge repo (designs/2026-11-09-knowledge-repo.md,
 * WA-1230): a kept sample (the catalog) and a locked tip. Scores and notes stay hot in Postgres;
 * a verdict copies what the person decided. One keep or one lock = one record (key: `sample` +
 * `keptAt`, `guide` + `decidedAt`); un-keep, unlock or drop retires it; a re-keep is a new record.
 */
import type { Db } from "@wren/db";
import { type Change, idOf, loadWorking, write } from "@wrenautomation/knowledge";
import {
  batches,
  type GuideRow,
  guideStats,
  guides,
  lineage,
  notes,
  type SampleRow,
  samples,
  subjects,
} from "@wrenautomation/vireo";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

type Fields = Record<string, unknown>;
export interface VerdictIn {
  key: string;
  title: string;
  fields: Fields;
  tags: string[];
  body: string;
}

const stamp = (d: Date | null | undefined) => d?.toISOString();
const defined = (o: Fields) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length),
    ),
  );
const b36 = (d: Date) => Math.floor(d.getTime() / 1000).toString(36);
const firstLine = (s: string | null) =>
  s
    ?.replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
    ?.slice(0, 100);

export interface KeptRow {
  sample: SampleRow;
  subject: { slug: string; name: string; kind: string };
  batch: { n: number; title: string | null; why: string; note: string | null };
  parents: { id: number; took: string | null }[];
  notes: {
    tone: string | null;
    text: string | null;
    anchor: unknown;
    by: string | null;
    at: Date;
  }[];
}

/** A kept sample as a verdict. */
export function keptVerdict(r: KeptRow): VerdictIn {
  const s = r.sample;
  const kept = s.keptAt as Date;
  const title = `${r.subject.name}: ${s.name ?? firstLine(s.body) ?? `sample ${s.id}`}`;
  return {
    key: `sample:${s.id}:${stamp(kept)}`,
    title,
    tags: ["vireo", r.subject.slug, r.subject.kind],
    fields: defined({
      from: "vireo",
      ref: `${r.subject.slug}:${r.batch.n}`,
      sample: s.id,
      subject: r.subject.slug,
      kind: r.subject.kind,
      score: s.score,
      zone: s.verdict,
      keptAt: stamp(kept),
      name: s.name,
      media: s.media,
      poster: s.poster,
      batchTitle: r.batch.title,
      batchWhy: r.batch.why,
      batchNote: r.batch.note,
      change: s.change,
      agent: s.agent,
      parents: r.parents.map((p) => defined({ id: p.id, took: p.took })),
      notes: r.notes.map((n) =>
        defined({ tone: n.tone, text: n.text, anchor: n.anchor, by: n.by, at: stamp(n.at) }),
      ),
      guides: s.guides,
    }),
    body: s.body?.trim() || (s.media ? `media: ${s.media}` : title),
  };
}

/** A locked tip as a verdict, with its with-vs-without good rate over the samples it reached. */
export function lockedVerdict(
  g: GuideRow & { effect: unknown },
  subject: string | null,
): VerdictIn {
  const decided = g.decidedAt as Date;
  return {
    key: `guide:${g.id}:${stamp(decided)}`,
    title: g.text.split("\n")[0]?.slice(0, 160) || `tip ${g.id}`,
    tags: ["vireo", "tip", ...(subject ? [subject] : []), ...(g.kind ? [g.kind] : [])],
    fields: defined({
      from: "vireo",
      ref: `guide:${g.id}`,
      guide: g.id,
      scope: subject ?? g.kind ?? "all",
      tipSource: g.source,
      tipRef: g.ref,
      lockedAt: stamp(decided),
      lockedBy: g.by,
      effect: g.effect,
    }),
    body: g.text.trim(),
  };
}

const keyOf = (fm: Fields) =>
  typeof fm.sample === "number" && fm.keptAt
    ? `sample:${fm.sample}:${fm.keptAt}`
    : typeof fm.guide === "number" && fm.lockedAt
      ? `guide:${fm.guide}:${fm.lockedAt}`
      : null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The changes that bring the repo's Vireo verdicts up to these. */
export function verdictChanges(
  have: ReadonlyMap<string, { fm: Fields; body: string }>,
  want: readonly VerdictIn[],
): Change[] {
  const live = new Map<string, { id: string; fm: Fields; body: string }>();
  const taken = new Set<string>();
  for (const [id, d] of have) {
    taken.add(id);
    const k = d.fm.type === "verdict" && d.fm.from === "vireo" ? keyOf(d.fm) : null;
    if (k && d.fm.status === "live") live.set(k, { id, ...d });
  }
  const out: Change[] = [];
  const keys = new Set(want.map((w) => w.key));
  for (const w of want) {
    const cur = live.get(w.key);
    if (!cur) {
      const tail =
        w.key.split(":").slice(0, 2).join("") + b36(new Date(w.key.split(":").slice(2).join(":")));
      let id = idOf(w.title, tail);
      for (let n = 2; taken.has(id); n++) id = idOf(w.title, `${tail}-${n}`);
      taken.add(id);
      out.push({
        op: "add",
        type: "verdict",
        id,
        title: w.title,
        ...w.fields,
        tags: w.tags,
        body: w.body,
      });
      continue;
    }
    const patch: Fields = {};
    for (const [k, v] of Object.entries(w.fields)) if (!same(cur.fm[k], v)) patch[k] = v;
    for (const k of Object.keys(cur.fm)) if (k in VIREO_FIELDS && !(k in w.fields)) patch[k] = null;
    if (cur.fm.title !== w.title) patch.title = w.title;
    if (!same(cur.fm.tags, w.tags)) patch.tags = w.tags;
    if (cur.body !== w.body) patch.body = w.body;
    if (Object.keys(patch).length) out.push({ op: "edit", id: cur.id, ...patch });
  }
  for (const [k, cur] of live) if (!keys.has(k)) out.push({ op: "retire", id: cur.id });
  return out;
}

/** Fields a Vireo verdict may carry: one that empties (a note deleted) is dropped on edit. */
const VIREO_FIELDS: Record<string, true> = Object.fromEntries(
  [
    "score",
    "zone",
    "name",
    "media",
    "poster",
    "batchTitle",
    "batchWhy",
    "batchNote",
    "change",
    "agent",
    "parents",
    "notes",
    "guides",
    "tipRef",
    "lockedBy",
    "effect",
  ].map((k) => [k, true]),
);

/** Every kept sample and locked tip into the repo: one commit, or none when nothing changed. */
export async function promoteVerdicts(
  db: Db,
  root: string,
  who: { by: string; why: string },
): Promise<{
  kept: number;
  locked: number;
  added: number;
  edited: number;
  retired: number;
  commit: string | null;
}> {
  const kept = await db
    .select({
      sample: samples,
      subject: { slug: subjects.slug, name: subjects.name, kind: subjects.kind },
      batch: { n: batches.n, title: batches.title, why: batches.why, note: batches.note },
    })
    .from(samples)
    .innerJoin(subjects, eq(subjects.id, samples.subjectId))
    .innerJoin(batches, eq(batches.id, samples.batchId))
    .where(isNotNull(samples.keptAt))
    .orderBy(samples.id);
  const ids = kept.map((k) => k.sample.id);
  const ps = ids.length
    ? await db.select().from(lineage).where(inArray(lineage.childId, ids)).orderBy(lineage.position)
    : [];
  const ns = ids.length
    ? await db.select().from(notes).where(inArray(notes.sampleId, ids)).orderBy(notes.id)
    : [];

  const locked = await db
    .select({ guide: guides, subject: subjects.slug })
    .from(guides)
    .leftJoin(subjects, eq(subjects.id, guides.subjectId))
    .where(eq(guides.state, "locked"))
    .orderBy(guides.id);
  // a tip's effect: over judged samples it could reach (its subject, its kind, or all)
  const judged = locked.length
    ? await db
        .select({ sample: samples, kind: subjects.kind })
        .from(samples)
        .innerJoin(batches, and(eq(batches.id, samples.batchId), eq(batches.state, "closed")))
        .innerJoin(subjects, eq(subjects.id, samples.subjectId))
    : [];
  const reach = (g: GuideRow) =>
    judged
      .filter((j) =>
        g.subjectId != null ? j.sample.subjectId === g.subjectId : !g.kind || j.kind === g.kind,
      )
      .map((j) => j.sample);

  const want = [
    ...kept.map((k) =>
      keptVerdict({
        ...k,
        parents: ps
          .filter((p) => p.childId === k.sample.id)
          .map((p) => ({ id: p.parentId, took: p.took })),
        notes: ns
          .filter((n) => n.sampleId === k.sample.id)
          .map((n) => ({
            tone: n.tone,
            text: n.text,
            anchor: n.anchor,
            by: n.by,
            at: n.createdAt,
          })),
      }),
    ),
    ...locked.map(({ guide, subject }) => {
      const [g] = guideStats([guide], reach(guide));
      return lockedVerdict(g as GuideRow & { effect: unknown }, subject);
    }),
  ];
  const have = new Map(
    loadWorking(root).docs.map((l) => [l.doc.fm.id, { fm: l.doc.fm as Fields, body: l.doc.body }]),
  );
  const changes = verdictChanges(have, want);
  const count = (op: Change["op"]) => changes.filter((c) => c.op === op).length;
  const commit = changes.length ? (await write(root, changes, who)).commit : null;
  return {
    kept: kept.length,
    locked: locked.length,
    added: count("add"),
    edited: count("edit"),
    retired: count("retire"),
    commit,
  };
}

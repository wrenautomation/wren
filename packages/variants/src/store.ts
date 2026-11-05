/**
 * The Variants ledger: one function per thing the CLI, the agent or the portal does. Pure SQL over
 * `schema.ts`; ranking is `@wren/experiments` (Plackett-Luce, with-vs-without rates).
 */
import { PortalRefusal } from "@wren/core/refusal";
import { atomic, type Db, setAuditActor, type Tx } from "@wren/db";
import { fitPlackettLuce, rateSplit, type Strength, tiersToChoices } from "@wren/experiments";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { live } from "./live.js";
import {
  type Anchor,
  batches,
  type Channel,
  type GuideState,
  guides,
  type Kind,
  notes,
  samples,
  ships,
  subjects,
  type Tone,
  type Verdict,
} from "./schema.js";
import { isSource, type Source } from "./sync.js";

/** A "no" to the caller: the portal answers its status, the CLI prints it. */
export class VariantsError extends PortalRefusal {}

export interface NewSample {
  body?: string | null;
  /** s3:// uri; the CLI uploads a local file first. */
  media?: string | null;
  poster?: string | null;
  parent?: number | null;
  guides?: number[];
  change?: string | null;
  /** A video's footage and kept spans, for synced play. */
  source?: Source | null;
}

type SubjectRow = typeof subjects.$inferSelect;
type SampleRow = typeof samples.$inferSelect;
type NoteRow = typeof notes.$inferSelect;
type GuideRow = typeof guides.$inferSelect;

const GOOD: readonly (string | null)[] = ["amazing", "good"];
/** amazing > good > unmarked > bad; amazing's wins count double. */
const TIER_WEIGHTS = [2, 1, 1];

const write = <T>(db: Db, by: string | null, fn: (tx: Tx) => Promise<T>) =>
  atomic(db, async (tx) => {
    if (by) await setAuditActor(tx, by);
    return fn(tx);
  });

/** Fisher-Yates with Math.random: positions only hide the agent's order. */
const shuffled = <T>(xs: readonly T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
};

export async function subjectOf(db: Db | Tx, ref: string | number): Promise<SubjectRow> {
  const id = typeof ref === "number" || /^\d+$/.test(ref) ? Number(ref) : null;
  const [row] = await db
    .select()
    .from(subjects)
    .where(id ? eq(subjects.id, id) : eq(subjects.slug, String(ref)));
  if (!row) throw new VariantsError(`no subject ${ref}`, 404);
  return row;
}

export function newSubject(
  db: Db,
  s: {
    slug: string;
    name: string;
    kind: Kind;
    brief?: string | null;
    seeds?: string[];
    by?: string | null;
  },
) {
  return write(db, s.by ?? null, async (tx) => {
    const [row] = await tx
      .insert(subjects)
      .values({
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        brief: s.brief ?? null,
        seeds: s.seeds ?? [],
        by: s.by ?? null,
      })
      .returning();
    return row as SubjectRow;
  });
}

export async function listSubjects(db: Db) {
  const rows = await db.select().from(subjects).orderBy(desc(subjects.createdAt));
  const counts = await db
    .select({
      subjectId: samples.subjectId,
      samples: sql<number>`count(*)::int`,
      kept: sql<number>`count(${samples.keptAt})::int`,
      open: sql<number>`count(*) filter (where ${batches.state} = 'open')::int`,
    })
    .from(samples)
    .innerJoin(batches, eq(batches.id, samples.batchId))
    .groupBy(samples.subjectId);
  const by = new Map(counts.map((c) => [c.subjectId, c]));
  return rows.map((s) => ({
    ...s,
    samples: by.get(s.id)?.samples ?? 0,
    kept: by.get(s.id)?.kept ?? 0,
    toPick: by.get(s.id)?.open ?? 0,
  }));
}

/** One batch for review: samples in their shuffled order. */
export async function addBatch(
  db: Db,
  ref: string | number,
  b: { why: string; agent?: string | null; samples: NewSample[] },
) {
  if (!b.why.trim()) throw new VariantsError("say why: what changed and what it tests");
  if (!b.samples.length) throw new VariantsError("a batch needs samples");
  for (const s of b.samples)
    if (!s.body?.trim() && !s.media) throw new VariantsError("each sample needs a body or a file");
  for (const s of b.samples)
    if (s.source != null && !isSource(s.source))
      throw new VariantsError("source needs a ref and spans of {s, e} seconds, e > s");
  return write(db, b.agent ?? null, async (tx) => {
    const subject = await subjectOf(tx, ref);
    const [batch] = await tx
      .insert(batches)
      .values({ subjectId: subject.id, why: b.why, agent: b.agent ?? null })
      .returning();
    const order = shuffled(b.samples.map((_, i) => i));
    const rows = await tx
      .insert(samples)
      .values(
        b.samples.map((s, i) => ({
          batchId: batch?.id as number,
          subjectId: subject.id,
          position: order.indexOf(i),
          body: s.body ?? null,
          media: s.media ?? null,
          poster: s.poster ?? null,
          source: s.source ?? null,
          parentId: s.parent ?? null,
          guides: s.guides ?? [],
          change: s.change ?? null,
          agent: b.agent ?? null,
        })),
      )
      .returning({ id: samples.id });
    return { batch: batch?.id as number, subject: subject.slug, samples: rows.map((r) => r.id) };
  });
}

/** Open batches, oldest first, with their samples and notes: what William has to pick. */
export async function queue(db: Db, ref?: string | number) {
  const subjectId = ref == null ? null : (await subjectOf(db, ref)).id;
  const open = await db
    .select({ batch: batches, subject: subjects })
    .from(batches)
    .innerJoin(subjects, eq(subjects.id, batches.subjectId))
    .where(and(eq(batches.state, "open"), subjectId ? eq(batches.subjectId, subjectId) : undefined))
    .orderBy(asc(batches.createdAt));
  if (!open.length) return [];
  const ids = open.map((o) => o.batch.id);
  const rows = await db
    .select()
    .from(samples)
    .where(inArray(samples.batchId, ids))
    .orderBy(asc(samples.position));
  const ns = rows.length
    ? await db
        .select()
        .from(notes)
        .where(
          inArray(
            notes.sampleId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(notes.createdAt))
    : [];
  return open.map((o) => ({
    batch: o.batch,
    subject: o.subject,
    samples: rows
      .filter((r) => r.batchId === o.batch.id)
      .map((r) => ({ ...r, notes: ns.filter((n) => n.sampleId === r.id) })),
  }));
}

export function judge(db: Db, sampleId: number, verdict: Verdict | null, by: string | null) {
  return write(db, by, async (tx) => {
    const [row] = await tx
      .update(samples)
      .set({ verdict })
      .where(eq(samples.id, sampleId))
      .returning({ id: samples.id, verdict: samples.verdict });
    if (!row) throw new VariantsError(`no sample ${sampleId}`, 404);
    return row;
  });
}

export function addNote(
  db: Db,
  sampleId: number,
  n: { anchor?: Anchor | null; tone?: Tone | null; text?: string | null },
  by: string | null,
) {
  if (!n.tone && !n.text?.trim()) throw new VariantsError("a note needs a tone or words");
  return write(db, by, async (tx) => {
    const [row] = await tx
      .insert(notes)
      .values({
        sampleId,
        anchor: n.anchor ?? null,
        tone: n.tone ?? null,
        text: n.text?.trim() || null,
        by,
      })
      .returning();
    return row as NoteRow;
  });
}

export function dropNote(db: Db, noteId: number, by: string | null) {
  return write(db, by, async (tx) => {
    const rows = await tx.delete(notes).where(eq(notes.id, noteId)).returning({ id: notes.id });
    return { done: rows.map((r) => r.id) };
  });
}

/** Close a batch: William's note goes to the agent with the marks. */
export function closeBatch(db: Db, batchId: number, note: string | null, by: string | null) {
  return write(db, by, async (tx) => {
    const [row] = await tx
      .update(batches)
      .set({ state: "closed", note: note?.trim() || null, closedAt: new Date() })
      .where(eq(batches.id, batchId))
      .returning({ id: batches.id, subjectId: batches.subjectId });
    if (!row) throw new VariantsError(`no batch ${batchId}`, 404);
    return row;
  });
}

export function keep(db: Db, sampleId: number, on: boolean, by: string | null) {
  return write(db, by, async (tx) => {
    const [row] = await tx
      .update(samples)
      .set({ keptAt: on ? new Date() : null })
      .where(eq(samples.id, sampleId))
      .returning({ id: samples.id, keptAt: samples.keptAt });
    if (!row) throw new VariantsError(`no sample ${sampleId}`, 404);
    return row;
  });
}

export function addGuide(
  db: Db,
  g: {
    text: string;
    source?: GuideRow["source"];
    ref?: string | null;
    subject?: string | number | null;
    kind?: Kind | null;
    by?: string | null;
  },
) {
  if (!g.text.trim()) throw new VariantsError("say the tip");
  return write(db, g.by ?? null, async (tx) => {
    const subjectId = g.subject == null ? null : (await subjectOf(tx, g.subject)).id;
    const [row] = await tx
      .insert(guides)
      .values({
        text: g.text.trim(),
        source: g.source ?? "william",
        ref: g.ref ?? null,
        subjectId,
        kind: g.kind ?? null,
        by: g.by ?? null,
      })
      .returning();
    return row as GuideRow;
  });
}

export function setGuide(db: Db, id: number, state: GuideState, by: string | null) {
  return write(db, by, async (tx) => {
    const [row] = await tx
      .update(guides)
      .set({ state, decidedAt: state === "testing" ? null : new Date() })
      .where(eq(guides.id, id))
      .returning();
    if (!row) throw new VariantsError(`no guide ${id}`, 404);
    return row;
  });
}

/** Guides that reach a subject: its own, its kind's, and everyone's. */
async function guidesFor(db: Db, s: SubjectRow) {
  return db
    .select()
    .from(guides)
    .where(
      or(
        eq(guides.subjectId, s.id),
        and(isNull(guides.subjectId), eq(guides.kind, s.kind)),
        and(isNull(guides.subjectId), isNull(guides.kind)),
      ),
    )
    .orderBy(asc(guides.createdAt));
}

/** Strength per judged sample: each batch with a verdict is a partial ranking. */
export function strengths(
  rows: readonly Pick<SampleRow, "id" | "batchId" | "verdict">[],
): Strength[] {
  const byBatch = new Map<number, (typeof rows)[number][]>();
  for (const r of rows) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
  const judged = [...byBatch.values()].filter((b) => b.some((r) => r.verdict));
  const ids = judged.flat().map((r) => String(r.id));
  const choices = judged.flatMap((b) => {
    const of = (v: Verdict | null) => b.filter((r) => r.verdict === v).map((r) => String(r.id));
    return tiersToChoices([of("amazing"), of("good"), of(null), of("bad")], TIER_WEIGHTS);
  });
  return fitPlackettLuce(ids, choices);
}

/** With-vs-without good rate per guide, over judged samples. */
export function guideStats(guideRows: readonly GuideRow[], judged: readonly SampleRow[]) {
  return guideRows.map((g) => ({
    ...g,
    effect: rateSplit(
      judged.map((s) => ({ has: s.guides.includes(g.id), good: GOOD.includes(s.verdict) })),
    ),
  }));
}

/** Everything about a subject: for the agent's next batch and the portal's subject view. */
export async function feedback(db: Db, ref: string | number) {
  const s = await subjectOf(db, ref);
  const bs = await db
    .select()
    .from(batches)
    .where(eq(batches.subjectId, s.id))
    .orderBy(asc(batches.createdAt));
  const ss = await db
    .select()
    .from(samples)
    .where(eq(samples.subjectId, s.id))
    .orderBy(asc(samples.batchId), asc(samples.position));
  const ns = ss.length
    ? await db
        .select()
        .from(notes)
        .where(
          inArray(
            notes.sampleId,
            ss.map((r) => r.id),
          ),
        )
        .orderBy(asc(notes.createdAt))
    : [];
  const judgedBatches = new Set(bs.filter((b) => b.state === "closed").map((b) => b.id));
  const judged = ss.filter((r) => judgedBatches.has(r.batchId));
  const strength = new Map(strengths(ss).map((x) => [Number(x.id), x]));
  const gs = guideStats(await guidesFor(db, s), judged);
  return {
    subject: s,
    guides: gs,
    batches: bs.map((b) => {
      const mine = ss.filter((r) => r.batchId === b.id);
      return {
        ...b,
        goodRate: mine.length
          ? mine.filter((r) => GOOD.includes(r.verdict)).length / mine.length
          : null,
        samples: mine.map((r) => ({
          ...r,
          strength: strength.get(r.id) ?? null,
          notes: ns.filter((n) => n.sampleId === r.id),
        })),
      };
    }),
    leaders: [...strength.values()]
      .slice(0, 5)
      .map((x) => ({ sample: Number(x.id), strength: x.strength, se: x.se })),
    live: await live(db, s.id),
  };
}

/** A sample goes live on a channel's target; `collect` reads its numbers from then on. */
export function ship(
  db: Db,
  sampleId: number,
  o: { channel: Channel; target: string; why?: string | null },
  by: string | null,
) {
  if (!o.target.trim()) throw new VariantsError("a ship needs the channel's target id");
  return write(db, by, async (tx) => {
    const [sample] = await tx
      .select({ id: samples.id })
      .from(samples)
      .where(eq(samples.id, sampleId));
    if (!sample) throw new VariantsError(`no sample ${sampleId}`, 404);
    const [row] = await tx
      .insert(ships)
      .values({ sampleId, channel: o.channel, target: o.target.trim(), why: o.why ?? null, by })
      .onConflictDoUpdate({
        target: [ships.channel, ships.target, ships.sampleId],
        set: { endedAt: null },
      })
      .returning();
    if (!row) throw new Error("ship not written");
    return row;
  });
}

/** Ends a ship: its numbers stay, frozen at the next collect. */
export function unship(db: Db, shipId: number, by: string | null) {
  return write(db, by, async (tx) => {
    const [row] = await tx
      .update(ships)
      .set({ endedAt: sql`now()` })
      .where(and(eq(ships.id, shipId), isNull(ships.endedAt)))
      .returning();
    if (!row) throw new VariantsError(`no live ship ${shipId}`, 404);
    return row;
  });
}

/** A subject's ships, newest first. */
export async function shipsOf(db: Db, ref: string | number) {
  const s = await subjectOf(db, ref);
  return db
    .select({ ship: ships })
    .from(ships)
    .innerJoin(samples, eq(samples.id, ships.sampleId))
    .where(eq(samples.subjectId, s.id))
    .orderBy(desc(ships.startedAt))
    .then((r) => r.map((x) => x.ship));
}

/** Kept samples, newest first, with their subject. */
export async function catalog(db: Db, opts: { kind?: Kind; subject?: string | number } = {}) {
  const subjectId = opts.subject == null ? null : (await subjectOf(db, opts.subject)).id;
  return db
    .select({
      sample: samples,
      subject: { slug: subjects.slug, name: subjects.name, kind: subjects.kind },
    })
    .from(samples)
    .innerJoin(subjects, eq(subjects.id, samples.subjectId))
    .where(
      and(
        isNotNull(samples.keptAt),
        opts.kind ? eq(subjects.kind, opts.kind) : undefined,
        subjectId ? eq(samples.subjectId, subjectId) : undefined,
      ),
    )
    .orderBy(desc(samples.keptAt));
}

export type { GuideRow, NoteRow, SampleRow, SubjectRow };

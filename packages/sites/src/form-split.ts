/**
 * A/B per hosted form (designs/2026-10-07-forms-and-pay.md, "A/B per form"): the form's address
 * serves the form as it is (A) or `b`, by B's weight, and the `wab` cookie keeps a visitor on
 * their arm. Start copies A as B; ship makes B the form; stop keeps A. All direct: a form only
 * collects, so no To approve. A page's form section always shows A.
 */
import { type Db, type Queryable, serializable, snapshot } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { FormProblem, type FormSpec, parseSpec } from "./forms.js";
import type { FormArm } from "./model.js";
import { type SiteFormDef, type SiteFormSplit, siteFormDefs, siteFormSplits } from "./schema.js";
import { SPLIT_COOKIE } from "./split.js";
import { type SplitCall, splitCall } from "./split-call.js";
import { SitesRefusal, UUID } from "./store.js";

/** The split running on a form; null when none. */
export async function runningFormSplit(db: Queryable, form: string): Promise<SiteFormSplit | null> {
  const [row] = await db
    .select()
    .from(siteFormSplits)
    .where(and(eq(siteFormSplits.form, form), eq(siteFormSplits.state, "running")));
  return row ?? null;
}

export async function formSplitById(db: Queryable, id: string): Promise<SiteFormSplit | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(siteFormSplits).where(eq(siteFormSplits.id, id));
  return row ?? null;
}

/** A form's last five splits, newest first: the running one and those that ended. */
export function formSplitsOf(db: Queryable, form: string) {
  return db
    .select()
    .from(siteFormSplits)
    .where(eq(siteFormSplits.form, form))
    .orderBy(desc(siteFormSplits.startedAt))
    .limit(5);
}

const weightOf = (w: unknown): number => {
  const n = typeof w === "string" && w.trim() ? Number(w) : w;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 99)
    throw new SitesRefusal("B's share is a whole number from 1 to 99", 400);
  return n;
};

const specOf = (raw: unknown): FormSpec => {
  try {
    return parseSpec(raw);
  } catch (err) {
    if (err instanceof FormProblem) throw new SitesRefusal(err.message, 400);
    throw err;
  }
};

/** A split on a form that isn't retired: B starts as A's copy, at half the visitors. */
export async function startFormSplit(
  db: Db,
  f: { form: SiteFormDef; weight?: unknown; by: string },
): Promise<SiteFormSplit> {
  if (f.form.status === "retired") throw new SitesRefusal("a retired form takes no split", 409);
  const weight = f.weight === undefined || f.weight === null ? 50 : weightOf(f.weight);
  return serializable(db, async (tx) => {
    if (await runningFormSplit(tx, f.form.id))
      throw new SitesRefusal("a split is already running on this form", 409);
    const [row] = await tx
      .insert(siteFormSplits)
      .values({
        client: f.form.client,
        form: f.form.id,
        b: f.form.spec,
        weight,
        startedBy: f.by,
        updatedBy: f.by,
      })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    return row;
  });
}

/** B's spec or its share changed, on a running split. B's spec is checked as a form's is. */
export async function saveFormSplit(
  db: Db,
  f: { id: string; spec?: unknown; weight?: unknown; by: string },
): Promise<SiteFormSplit> {
  const b = f.spec === undefined || f.spec === null ? undefined : specOf(f.spec);
  const weight = f.weight === undefined || f.weight === null ? undefined : weightOf(f.weight);
  const [row] = await db
    .update(siteFormSplits)
    .set({
      ...(b ? { b } : {}),
      ...(weight !== undefined ? { weight } : {}),
      updatedAt: new Date(),
      updatedBy: f.by,
    })
    .where(and(eq(siteFormSplits.id, f.id), eq(siteFormSplits.state, "running")))
    .returning();
  if (!row) throw new SitesRefusal("no running split", 404);
  return row;
}

/** A running split ended: `stopped` keeps A; `shipped` makes B the form's spec, in one step. */
export async function endFormSplit(
  db: Db,
  f: { id: string; how: "stopped" | "shipped"; by: string },
): Promise<SiteFormSplit> {
  return serializable(db, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(siteFormSplits)
      .set({
        state: f.how,
        winner: f.how === "shipped" ? "B" : "A",
        endedAt: now,
        endedBy: f.by,
        updatedAt: now,
        updatedBy: f.by,
      })
      .where(and(eq(siteFormSplits.id, f.id), eq(siteFormSplits.state, "running")))
      .returning();
    if (!row) throw new SitesRefusal("no running split", 404);
    if (f.how === "shipped")
      await tx
        .update(siteFormDefs)
        .set({ spec: row.b, updatedAt: now, updatedBy: f.by })
        .where(eq(siteFormDefs.id, row.form));
    return row;
  });
}

/**
 * The arm a visit to a live form gets: the one its cookie names while that split runs, else by
 * B's weight with `roll` in [0, 1). Bots get A, uncounted; null when no split runs.
 */
export async function formArmToServe(
  db: Queryable,
  form: SiteFormDef,
  cookie: string | null,
  roll: number,
): Promise<{ split: string; label: FormArm; spec: FormSpec } | null> {
  const s = await runningFormSplit(db, form.id);
  if (!s) return null;
  const m = cookie ? SPLIT_COOKIE.exec(cookie) : null;
  const want = m && s.id.startsWith(m[1] as string) ? m[2] : null;
  const fresh: FormArm = Math.min(Math.max(roll, 0), 1) * 100 < s.weight ? "B" : "A";
  const label: FormArm = want === "A" || want === "B" ? want : fresh;
  return { split: s.id, label, spec: label === "B" ? s.b : form.spec };
}

/**
 * The spec a submit is checked against: B's when its split and arm say B (even after the split
 * ended), else the form's. A split from another form counts as none.
 */
export async function specForArm(
  db: Queryable,
  form: SiteFormDef,
  split: string | null | undefined,
  arm: string | null | undefined,
): Promise<{ spec: FormSpec; split: string | null; arm: FormArm | null }> {
  const s = split ? await formSplitById(db, split) : null;
  if (!s || s.form !== form.id || (arm !== "A" && arm !== "B"))
    return { spec: form.spec, split: null, arm: null };
  return { spec: arm === "B" ? s.b : form.spec, split: s.id, arm };
}

export interface FormArmNumbers {
  label: FormArm;
  /** Views of distinct page loads. */
  views: number;
  starts: number;
  submits: number;
  rate: number | null;
}

export interface FormSplitDetail extends Omit<SiteFormSplit, "b"> {
  b: FormSpec;
  arms: FormArmNumbers[];
  call: SplitCall;
}

/** Each arm's views, starts and submits, and the call on them (submits per view). */
export async function formSplitDetail(
  db: Queryable,
  split: SiteFormSplit,
): Promise<FormSplitDetail> {
  const rows = (await snapshot(db, (tx) =>
    tx.execute(sql`
      select a.label,
        (select count(distinct e.view) from site_events e
          where e.form_split = ${split.id}::uuid and e.arm = a.label and e.name = 'view')::int views,
        (select count(distinct e.view) from site_events e
          where e.form_split = ${split.id}::uuid and e.arm = a.label and e.name = 'start')::int starts,
        (select count(*) from site_forms f
          where f.form_split = ${split.id}::uuid and f.arm = a.label)::int submits
      from (values ('A'), ('B')) a(label) order by a.label`),
  )) as unknown as { label: FormArm; views: number; starts: number; submits: number }[];
  const arms = [...rows].map((r) => ({
    ...r,
    rate: r.views > 0 ? r.submits / r.views : null,
  }));
  return {
    ...split,
    arms,
    call: splitCall(arms.map((a) => ({ label: a.label, visits: a.views, goals: a.submits }))),
  };
}

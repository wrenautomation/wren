/**
 * Hosted forms' reads and writes on the main database (designs/2026-10-07-forms-and-pay.md).
 * A form's spec is checked on every save; its status moves draft, live, retired by a person.
 */

import { createHash } from "node:crypto";
import { type Db, type Queryable, serializable } from "@wren/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type FormSplitDetail, formSplitDetail, formSplitsOf } from "./form-split.js";
import { defaultSpec, FormProblem, type FormSpec, parseSpec } from "./forms.js";
import { embedSnippets } from "./kit.js";
import { formUrl, type PageStatus, SLUG, SLUG_MAX, slugOf, WREN_SITE } from "./model.js";
import { type SiteFormDef, siteFormDefs, siteForms } from "./schema.js";
import { SitesRefusal, UUID } from "./store.js";

/** The words' version: the first 12 hex of their SHA-256. Same words, same version. */
export const consentVersion = (text: string) =>
  createHash("sha256").update(text.trim(), "utf8").digest("hex").slice(0, 12);

const ownerIs = (client: string | null) =>
  client === null ? isNull(siteFormDefs.client) : eq(siteFormDefs.client, client);

const problem = (err: unknown): never => {
  if (err instanceof FormProblem) throw new SitesRefusal(err.message, 400);
  throw err;
};

export async function formById(db: Queryable, id: string): Promise<SiteFormDef | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(siteFormDefs).where(eq(siteFormDefs.id, id));
  return row ?? null;
}

/** An owner's form by its slug, or by its id. */
export async function formOf(
  db: Queryable,
  client: string | null,
  key: string,
): Promise<SiteFormDef | null> {
  const k = key.trim();
  const where = UUID.test(k) ? eq(siteFormDefs.id, k) : eq(siteFormDefs.slug, k.toLowerCase());
  const [row] = await db
    .select()
    .from(siteFormDefs)
    .where(and(ownerIs(client), where));
  return row ?? null;
}

/** What `/o/f/<slug>` serves: a live form, or why not. */
export async function formToServe(
  db: Queryable,
  client: string | null,
  key: string,
): Promise<{ form: SiteFormDef } | { status: 404 | 410 }> {
  if (!key || (!SLUG.test(key) && !UUID.test(key))) return { status: 404 };
  const form = await formOf(db, client, key);
  if (!form || form.status === "draft") return { status: 404 };
  if (form.status === "retired") return { status: 410 };
  return { form };
}

async function freeFormSlug(db: Queryable, client: string | null, want: string) {
  const base = slugOf(want);
  if (!base || !SLUG.test(base))
    throw new SitesRefusal("pick a slug: letters, digits and dashes", 400);
  const taken = new Set(
    (
      await db
        .select({ slug: siteFormDefs.slug })
        .from(siteFormDefs)
        .where(and(ownerIs(client), sql`${siteFormDefs.slug} like ${`${base}%`}`))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const s = `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(s)) return s;
  }
  throw new SitesRefusal("that slug is taken", 409);
}

/** A new form, a draft: the spec given, or the default with the owner named in its consent. */
export async function createForm(
  db: Db,
  f: {
    client: string | null;
    name: string;
    slug?: string | null;
    spec?: unknown;
    business: string;
    by: string;
  },
): Promise<SiteFormDef> {
  const name = f.name.trim().slice(0, 200);
  if (!name) throw new SitesRefusal("name the form", 400);
  let spec: FormSpec;
  try {
    spec = f.spec ? parseSpec(f.spec) : { ...defaultSpec(f.business), title: name };
  } catch (err) {
    return problem(err);
  }
  return serializable(db, async (tx) => {
    const slug = await freeFormSlug(tx, f.client, f.slug?.trim() || name);
    const [row] = await tx
      .insert(siteFormDefs)
      .values({ client: f.client, slug, name, spec, createdBy: f.by, updatedBy: f.by })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    return row;
  });
}

/** A form's spec saved (checked first), and its name when given. */
export async function saveForm(
  db: Db,
  f: { id: string; spec: unknown; name?: string | null; by: string },
): Promise<SiteFormDef> {
  let spec: FormSpec;
  try {
    spec = parseSpec(f.spec);
  } catch (err) {
    return problem(err);
  }
  const name = f.name?.trim().slice(0, 200);
  const [row] = await db
    .update(siteFormDefs)
    .set({
      spec,
      ...(name ? { name } : {}),
      updatedAt: new Date(),
      updatedBy: f.by,
    })
    .where(eq(siteFormDefs.id, f.id))
    .returning();
  if (!row) throw new SitesRefusal("no such form", 404);
  return row;
}

/** Live, back to draft, or retired (its URL answers gone, its numbers stay). */
export async function setFormStatus(
  db: Db,
  ids: readonly string[],
  status: PageStatus,
  by: string,
): Promise<string[]> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return [];
  const rows = await db
    .update(siteFormDefs)
    .set({ status, updatedAt: new Date(), updatedBy: by })
    .where(inArray(siteFormDefs.id, ok))
    .returning({ id: siteFormDefs.id });
  return rows.map((r) => r.id);
}

export interface FormDayNumbers {
  day: string;
  views: number;
  starts: number;
  submits: number;
}
export interface FormStepNumbers {
  step: number;
  views: number;
}
export interface FormSourceNumbers {
  channel: string;
  source: string;
  campaign: string;
  views: number;
  starts: number;
  submits: number;
  conversion: number | null;
}

/** A form's numbers by day, last 30 days, and by where its visitors came from. */
export async function formNumbers(db: Queryable, id: string) {
  const days = await db.execute(sql`
    select to_char(d::date, 'YYYY-MM-DD') as day,
      count(e.id) filter (where e.name = 'view')::int views,
      count(e.id) filter (where e.name = 'start')::int starts,
      count(e.id) filter (where e.name = 'form')::int submits
    from generate_series(current_date - 29, current_date, interval '1 day') d
    left join site_events e on e.form = ${id} and e.at >= d and e.at < d + interval '1 day'
    group by d order by d`);
  const sources = await db.execute(sql`
    select channel, coalesce(source, '') source, coalesce(campaign, '') campaign,
      count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'start')::int starts,
      count(*) filter (where name = 'form')::int submits,
      case when count(*) filter (where name = 'view') > 0
        then (count(*) filter (where name = 'form'))::float8 / count(*) filter (where name = 'view')
        end conversion
    from site_events where form = ${id}
    group by 1, 2, 3 order by views desc, submits desc limit 50`);
  // Where people stop: views that reached each step past the first, last 30 days.
  const steps = await db.execute(sql`
    select step, count(distinct view)::int views from site_events
    where form = ${id} and name = 'step' and at >= current_date - 29
    group by step order by step`);
  return {
    days: [...days] as unknown as FormDayNumbers[],
    sources: [...sources] as unknown as FormSourceNumbers[],
    steps: [...steps] as unknown as FormStepNumbers[],
  };
}

export interface FormDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  owner: string;
  spec: FormSpec;
  url: string;
  embed: ReturnType<typeof embedSnippets>;
  days: FormDayNumbers[];
  sources: FormSourceNumbers[];
  /** Views that reached each step past the first, last 30 days: empty with no steps. */
  steps: FormStepNumbers[];
  /** The newest few submissions, whole. */
  recent: { id: string; at: Date; fields: Record<string, string>; entered: boolean }[];
  /** Its A/B splits, newest first, with each arm's numbers: the running one leads. */
  splits: FormSplitDetail[];
}

/** Where a form lives: Wren's apex, else the owner's first live custom domain, else none yet. */
export async function formHost(db: Queryable, client: string | null): Promise<string | null> {
  if (client === null) return WREN_SITE;
  const rows = await db.execute(sql`
    select hostname from client_domains where client_id = ${client} and status = 'active'
    order by created_at limit 1`);
  return ([...rows][0] as { hostname?: string } | undefined)?.hostname ?? null;
}

/** A form's detail past its row: the spec for the builder, its URL and embed, its numbers. */
export async function formDetail(db: Queryable, id: string): Promise<FormDetail | null> {
  const f = await formById(db, id);
  if (!f) return null;
  const host = (await formHost(db, f.client)) ?? WREN_SITE;
  const { days, sources, steps } = await formNumbers(db, id);
  const recent = await db
    .select({
      id: siteForms.id,
      at: siteForms.at,
      fields: siteForms.fields,
      entered: siteForms.entered,
    })
    .from(siteForms)
    .where(eq(siteForms.form, id))
    .orderBy(desc(siteForms.at))
    .limit(5);
  const splits = await Promise.all((await formSplitsOf(db, id)).map((s) => formSplitDetail(db, s)));
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    status: f.status,
    owner: f.client ?? "wren",
    spec: f.spec,
    url: formUrl(host, f.slug),
    embed: embedSnippets({ origin: `https://${host}`, slug: f.slug, title: f.name }),
    days,
    sources,
    steps,
    recent,
    splits,
  };
}

/** Every form an owner has, for a page's section picker. */
export function formsOf(db: Queryable, client: string | null) {
  return db
    .select({ id: siteFormDefs.id, name: siteFormDefs.name, slug: siteFormDefs.slug })
    .from(siteFormDefs)
    .where(ownerIs(client))
    .orderBy(asc(siteFormDefs.name));
}

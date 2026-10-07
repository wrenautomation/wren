/**
 * Sites' reads and writes on the main database. Every write names who made it. A data page's
 * copy is a new version per save; what's live changes only on a person's yes (`approvePage`).
 */
import { randomBytes } from "node:crypto";
import { HOOK_PRESETS } from "@wren/core/door";
import { hooks } from "@wren/core/schema";
import { atomic, type Db, type Queryable, serializable } from "@wren/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type Channel,
  channelOf,
  type EventName,
  type PageKind,
  type PageStage,
  SLUG,
  SLUG_MAX,
  slugOf,
  type VersionOrigin,
} from "./model.js";
import {
  type FormConsent,
  type FormTouch,
  type SitePage,
  type SitePageVersion,
  siteEvents,
  siteForms,
  siteHops,
  sitePages,
  sitePageVersions,
  siteSplitArms,
  siteSplits,
} from "./schema.js";
import { ContentProblem, checkContent, templateOf } from "./templates/index.js";
import type { Content } from "./templates/types.js";

/** A write the store refused: the words say why, the status what the portal answers. */
export class SitesRefusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export const newPreviewToken = () => randomBytes(32).toString("base64url");
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerIs = (client: string | null) =>
  client === null ? isNull(sitePages.client) : eq(sitePages.client, client);

export async function pageById(db: Queryable, id: string): Promise<SitePage | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(sitePages).where(eq(sitePages.id, id));
  return row ?? null;
}

async function mustPage(db: Queryable, id: string): Promise<SitePage> {
  const p = await pageById(db, id);
  if (!p) throw new SitesRefusal("no such page", 404);
  return p;
}

export async function versionOf(
  db: Queryable,
  page: string,
  number: number,
): Promise<SitePageVersion | null> {
  const [row] = await db
    .select()
    .from(sitePageVersions)
    .where(and(eq(sitePageVersions.page, page), eq(sitePageVersions.number, number)));
  return row ?? null;
}

export function versionsOf(db: Queryable, page: string) {
  return db
    .select({
      number: sitePageVersions.number,
      origin: sitePageVersions.origin,
      why: sitePageVersions.why,
      by: sitePageVersions.by,
      at: sitePageVersions.at,
    })
    .from(sitePageVersions)
    .where(eq(sitePageVersions.page, page))
    .orderBy(desc(sitePageVersions.number));
}

/** The slug asked for, or the title's, made unique for its owner with -2, -3. */
async function freeSlug(db: Queryable, client: string | null, want: string): Promise<string> {
  const base = slugOf(want);
  if (!base || !SLUG.test(base))
    throw new SitesRefusal("pick a slug: letters, digits and dashes", 400);
  const taken = new Set(
    (
      await db
        .select({ slug: sitePages.slug })
        .from(sitePages)
        .where(and(ownerIs(client), sql`${sitePages.slug} like ${`${base}%`}`))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const s = `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(s)) return s;
  }
  throw new SitesRefusal("that slug is taken", 409);
}

export interface NewDataPage {
  client: string | null;
  title: string;
  slug?: string | null;
  kind?: PageKind;
  template: string;
  offer?: string | null;
  angle?: string | null;
  audience?: string | null;
  stage?: PageStage;
  variantOf?: string | null;
  content: unknown;
  origin: VersionOrigin;
  why?: string | null;
  by: string;
}

/** A data page and its first version, a draft. The slug is made unique when it's taken. */
export async function createDataPage(db: Db, p: NewDataPage): Promise<SitePage> {
  const t = templateOf(p.template);
  const content = checked(p.template, p.content);
  const title = p.title.trim();
  if (!title) throw new SitesRefusal("name the page", 400);
  return serializable(db, async (tx) => {
    const slug = await freeSlug(tx, p.client, p.slug?.trim() || title);
    const [page] = await tx
      .insert(sitePages)
      .values({
        client: p.client,
        slug,
        title: title.slice(0, 200),
        kind: p.kind ?? (t.id === "listicle" ? "listicle" : "lander"),
        source: "data",
        template: t.id,
        offer: p.offer ?? null,
        angle: p.angle?.trim() || null,
        audience: p.audience?.trim() || null,
        stage: p.stage ?? "convert",
        variantOf: p.variantOf ?? null,
        draftVersion: 1,
        previewToken: newPreviewToken(),
        createdBy: p.by,
        updatedBy: p.by,
      })
      .returning();
    if (!page) throw new Error("insert returned nothing");
    await tx.insert(sitePageVersions).values({
      page: page.id,
      number: 1,
      content,
      origin: p.origin,
      why: p.why ?? null,
      by: p.by,
    });
    return page;
  });
}

function checked(template: string | null, content: unknown): Content {
  try {
    return checkContent(templateOf(template), content);
  } catch (err) {
    if (err instanceof ContentProblem) throw new SitesRefusal(err.message, 400);
    throw err;
  }
}

/**
 * A new version as the draft. `expect`, when given, is the draft the editor opened: a newer one
 * since refuses, so two editors never overwrite each other.
 */
export async function saveVersion(
  db: Db,
  id: string,
  v: {
    content: unknown;
    origin: VersionOrigin;
    by: string;
    why?: string | null;
    expect?: number | null;
  },
): Promise<SitePage> {
  return serializable(db, async (tx) => {
    const [page] = await tx.select().from(sitePages).where(eq(sitePages.id, id)).for("update");
    if (!page) throw new SitesRefusal("no such page", 404);
    if (page.source !== "data") throw new SitesRefusal("a code page changes in code", 409);
    if (v.expect !== undefined && v.expect !== null && v.expect !== page.draftVersion)
      throw new SitesRefusal("someone saved a newer draft; open it again", 409);
    const content = checked(page.template, v.content);
    const [top] = await tx
      .select({ n: sql<number>`coalesce(max(${sitePageVersions.number}), 0)::int` })
      .from(sitePageVersions)
      .where(eq(sitePageVersions.page, id));
    const number = (top?.n ?? 0) + 1;
    await tx.insert(sitePageVersions).values({
      page: id,
      number,
      content,
      origin: v.origin,
      why: v.why ?? null,
      by: v.by,
    });
    const [out] = await tx
      .update(sitePages)
      .set({
        draftVersion: number,
        previewToken: newPreviewToken(),
        updatedAt: sql`now()`,
        updatedBy: v.by,
      })
      .where(eq(sitePages.id, id))
      .returning();
    return out as SitePage;
  });
}

/** Ask for a version to go live (the draft when left out): it waits in To approve. */
export async function askPublish(
  db: Db,
  id: string,
  a: { by: string; number?: number | null },
): Promise<SitePage> {
  const page = await mustPage(db, id);
  if (page.source !== "data") throw new SitesRefusal("a code page goes live by its deploy", 409);
  if (page.status === "retired")
    throw new SitesRefusal("this page is retired; copy it instead", 409);
  const number = a.number ?? page.draftVersion;
  if (!number || !(await versionOf(db, id, number))) throw new SitesRefusal("no such version", 404);
  if (number === page.liveVersion) throw new SitesRefusal("that version is already live", 409);
  const [out] = await db
    .update(sitePages)
    .set({ waitingVersion: number, waitingBy: a.by, waitingAt: sql`now()` })
    .where(eq(sitePages.id, id))
    .returning();
  return out as SitePage;
}

/** After a page's yes or no on `number`: a split waiting on that version ships or runs again. */
async function settleShip(db: Queryable, page: string, number: number, yes: boolean, by: string) {
  await db
    .update(siteSplits)
    .set(
      yes
        ? { state: "shipped", endedAt: sql`now()`, endedBy: by, updatedAt: sql`now()` }
        : { state: "running", winner: null, shipVersion: null, updatedAt: sql`now()` },
    )
    .where(
      and(
        eq(siteSplits.page, page),
        eq(siteSplits.state, "shipping"),
        eq(siteSplits.shipVersion, number),
      ),
    );
}

/**
 * A person's yes: the version asked for goes live, and the page with it. A split that asked for
 * it (its winner's copy) ships.
 */
export async function approvePage(
  db: Db,
  id: string,
  number: number,
  by: string,
): Promise<SitePage> {
  return atomic(db, async (tx) => {
    const out = await approveOne(tx, id, number, by);
    await settleShip(tx, id, number, true, by);
    return out;
  });
}

async function approveOne(db: Queryable, id: string, number: number, by: string) {
  const [out] = await db
    .update(sitePages)
    .set({
      liveVersion: number,
      status: "live",
      waitingVersion: null,
      waitingBy: null,
      waitingAt: null,
      updatedAt: sql`now()`,
      updatedBy: by,
    })
    .where(and(eq(sitePages.id, id), eq(sitePages.waitingVersion, number)))
    .returning();
  if (!out) throw new SitesRefusal("that version isn't waiting anymore", 409);
  return out;
}

/**
 * A person's no: the ask goes, the version stays in history. Already gone: nothing. A split that
 * asked for it runs again.
 */
export async function declinePage(
  db: Db,
  id: string,
  number: number,
  by: string,
): Promise<boolean> {
  return atomic(db, async (tx) => {
    const done = await declineOne(tx, id, number, by);
    if (done) await settleShip(tx, id, number, false, by);
    return done;
  });
}

async function declineOne(db: Queryable, id: string, number: number, by: string) {
  const out = await db
    .update(sitePages)
    .set({
      waitingVersion: null,
      waitingBy: null,
      waitingAt: null,
      updatedAt: sql`now()`,
      updatedBy: by,
    })
    .where(and(eq(sitePages.id, id), eq(sitePages.waitingVersion, number)))
    .returning({ id: sitePages.id });
  return out.length > 0;
}

/** Take pages down at once: their URLs answer 410, their numbers stay. Returns those changed. */
export async function retirePages(db: Db, ids: readonly string[], by: string): Promise<string[]> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return [];
  const out = await db
    .update(sitePages)
    .set({
      status: "retired",
      waitingVersion: null,
      waitingBy: null,
      waitingAt: null,
      updatedAt: sql`now()`,
      updatedBy: by,
    })
    .where(and(inArray(sitePages.id, ok), sql`${sitePages.status} <> 'retired'`))
    .returning({ id: sitePages.id });
  return out.map((r) => r.id);
}

/** A variant: the page's draft copied to a new draft page, pointing back at it. */
export async function duplicatePage(
  db: Db,
  id: string,
  d: { by: string; title?: string | null; angle?: string | null; audience?: string | null },
): Promise<SitePage> {
  const page = await mustPage(db, id);
  if (page.source !== "data") throw new SitesRefusal("copy a code page in code", 409);
  const from = page.draftVersion ?? page.liveVersion;
  const v = from ? await versionOf(db, id, from) : null;
  if (!v) throw new SitesRefusal("this page has no copy to start from", 409);
  const angle = d.angle?.trim() || page.angle;
  const audience = d.audience?.trim() || page.audience;
  const title =
    d.title?.trim() ||
    `${page.title.replace(/ \(variant[^)]*\)$/, "")} (variant${angle && angle !== page.angle ? `: ${angle}` : ""})`;
  return createDataPage(db, {
    client: page.client,
    title,
    kind: page.kind as PageKind,
    template: page.template ?? "lander",
    offer: page.offer,
    angle,
    audience,
    stage: page.stage as PageStage,
    variantOf: page.variantOf ?? page.id,
    content: v.content,
    origin: "copy",
    why: `copied from ${page.slug} v${v.number}`,
    by: d.by,
  });
}

export interface CodePage {
  client: string | null;
  url: string;
  repoPath?: string | null;
  title?: string | null;
  kind?: PageKind;
  offer?: string | null;
  angle?: string | null;
  stage?: PageStage;
  by: string;
}

/** The address as stored: https, no hash, no trailing slash past the root. */
export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new SitesRefusal("that isn't a link", 400);
  }
  if (u.protocol !== "https:") throw new SitesRefusal("a page's link starts with https://", 400);
  u.hash = "";
  u.search = "";
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
  return `${u.origin}${path}`;
}

/** A code page, registered or updated by its URL. It's live: its deploy put it there. */
export async function registerCodePage(
  db: Db,
  p: CodePage,
): Promise<{ page: SitePage; added: boolean }> {
  const url = cleanUrl(p.url);
  const [had] = await db.select().from(sitePages).where(eq(sitePages.url, url));
  const facts = {
    ...(p.repoPath !== undefined ? { repoPath: p.repoPath?.trim() || null } : {}),
    ...(p.offer !== undefined ? { offer: p.offer } : {}),
    ...(p.angle !== undefined ? { angle: p.angle?.trim() || null } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
    ...(p.stage ? { stage: p.stage } : {}),
    ...(p.title?.trim() ? { title: p.title.trim().slice(0, 200) } : {}),
  };
  if (had) {
    const [page] = await db
      .update(sitePages)
      .set({ ...facts, status: "live", updatedAt: sql`now()`, updatedBy: p.by })
      .where(eq(sitePages.id, had.id))
      .returning();
    return { page: page as SitePage, added: false };
  }
  const path = new URL(url).pathname.replace(/^\/+/, "");
  const title = p.title?.trim() || path || new URL(url).hostname;
  const slug = await freeSlug(
    db,
    p.client,
    `${new URL(url).hostname.split(".")[0]}-${path || "home"}`,
  );
  const [page] = await db
    .insert(sitePages)
    .values({
      client: p.client,
      slug,
      title: title.slice(0, 200),
      kind: p.kind ?? "lander",
      source: "code",
      url,
      repoPath: p.repoPath?.trim() || null,
      offer: p.offer ?? null,
      angle: p.angle?.trim() || null,
      stage: p.stage ?? "convert",
      status: "live",
      previewToken: newPreviewToken(),
      createdBy: p.by,
      updatedBy: p.by,
    })
    .returning();
  return { page: page as SitePage, added: true };
}

/** What `/o/<slug>` shows on an owner's host: the live version, or why there's none. */
export async function pageToServe(
  db: Queryable,
  client: string | null,
  slug: string,
): Promise<{ page: SitePage; content: Content } | { status: 404 | 410 }> {
  if (!SLUG.test(slug)) return { status: 404 };
  const [page] = await db
    .select()
    .from(sitePages)
    .where(and(ownerIs(client), eq(sitePages.slug, slug), eq(sitePages.source, "data")));
  if (!page) return { status: 404 };
  if (page.status === "retired") return { status: 410 };
  if (page.status !== "live" || !page.liveVersion) return { status: 404 };
  const v = await versionOf(db, page.id, page.liveVersion);
  return v ? { page, content: v.content } : { status: 404 };
}

/** The newest draft behind its preview token; null when the token doesn't match. */
export async function draftToPreview(
  db: Queryable,
  id: string,
  token: string,
): Promise<{ page: SitePage; content: Content; number: number } | null> {
  const page = await pageById(db, id);
  if (!page || page.source !== "data" || !page.draftVersion) return null;
  const a = Buffer.from(page.previewToken);
  const b = Buffer.from(token);
  if (a.length !== b.length || !a.equals(b)) return null;
  const v = await versionOf(db, id, page.draftVersion);
  return v ? { page, content: v.content, number: v.number } : null;
}

const clip = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** The touch as sent by the kit, every value clipped. */
export function touchOf(raw: unknown): FormTouch & { channel: Channel } {
  const t = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const touch = {
    source: clip(t.source, 120),
    medium: clip(t.medium, 120),
    campaign: clip(t.campaign, 120),
    content: clip(t.content, 120),
    ref: clip(t.ref, 200),
  };
  return { ...touch, channel: channelOf(touch) };
}

/**
 * One tracker event on a page that's there and not retired, or a hosted form that's live; false
 * when neither is. A page's form section counts for both.
 */
export async function recordEvent(
  db: Queryable,
  e: {
    page?: string | null;
    form?: string | null;
    view: string;
    name: EventName;
    touch: unknown;
    width?: number | null;
    /** The split that served the page; kept only when the page is one of its arms. */
    split?: string | null;
  },
): Promise<boolean> {
  const page = e.page && UUID.test(e.page) ? e.page : null;
  const split = e.split && UUID.test(e.split) ? e.split : null;
  const form = e.form && UUID.test(e.form) ? e.form : null;
  if (!page && !form) return false;
  const t = touchOf(e.touch);
  const view = clip(e.view, 36) ?? "none";
  const width =
    typeof e.width === "number" && Number.isFinite(e.width)
      ? Math.max(0, Math.min(10_000, Math.round(e.width)))
      : null;
  const rows = await db.execute(sql`
    insert into site_events (page, form, split, view, name, channel, source, medium, campaign, content, ref, width)
    select p.id, f.id,
      (select a.split from site_split_arms a where a.split = ${split}::uuid and a.page = p.id),
      ${view}, ${e.name}, ${t.channel}, ${t.source}, ${t.medium}, ${t.campaign}, ${t.content}, ${t.ref}, ${width}
    from (select 1) one
    left join site_pages p on p.id = ${page}::uuid and p.status <> 'retired'
    left join site_form_defs f on f.id = ${form}::uuid and f.status = 'live'
    where p.id is not null or f.id is not null
    returning id`);
  return rows.length > 0;
}

/** The form fields a lead is made of; the rest is kept as sent. */
const FORM_FIELDS_MAX = 30;
const FORM_VALUE_MAX = 2000;

export function formFieldsOf(raw: unknown): Record<string, string> {
  const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f).slice(0, FORM_FIELDS_MAX)) {
    if (!/^[A-Za-z0-9_.-]{1,60}$/.test(k) || k === "page" || k === "website") continue;
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, FORM_VALUE_MAX);
  }
  return out;
}

/** What a submit came with past its fields: the consent it ticked, the visitor, Turnstile. */
export interface EntryMeta {
  consent?: FormConsent | null;
  visitor?: string | null;
  human?: "yes" | "off" | null;
}

/**
 * A form kept, its `form` event counted, from a page (its default form), a hosted form, or a
 * hosted form on a page. The door is entered after (`markForm`).
 */
export async function keepForm(
  db: Db,
  f: {
    page: SitePage | null;
    form?: string | null;
    view: string | null;
    fields: Record<string, string>;
    touch: unknown;
    split?: string | null;
  } & EntryMeta,
) {
  const t = touchOf(f.touch);
  const split = await splitOfArm(db, f.split, f.page?.id ?? null);
  const { channel, ...touch } = t;
  const page = f.page?.id ?? null;
  const form = f.form ?? null;
  const visitor = clip(f.visitor, 64);
  const [row] = await db
    .insert(siteForms)
    .values({
      page,
      form,
      split,
      fields: f.fields,
      touch,
      channel,
      consent: f.consent ?? null,
      visitor: visitor && /^[A-Za-z0-9_.-]+$/.test(visitor) ? visitor : null,
      human: f.human ?? null,
    })
    .returning();
  await db.insert(siteEvents).values({
    page,
    form,
    split,
    view: clip(f.view, 36) ?? "form",
    name: "form",
    channel,
    source: touch.source,
    medium: touch.medium,
    campaign: touch.campaign,
    content: touch.content,
    ref: touch.ref,
  });
  if (!row) throw new Error("insert returned nothing");
  return row;
}

/** The split, when the page is one of its arms; else null (a stale or forged id). */
async function splitOfArm(db: Queryable, split: string | null | undefined, page: string | null) {
  if (!split || !page || !UUID.test(split)) return null;
  const [a] = await db
    .select({ split: siteSplitArms.split })
    .from(siteSplitArms)
    .where(and(eq(siteSplitArms.split, split), eq(siteSplitArms.page, page)));
  return a?.split ?? null;
}

export async function markForm(db: Db, id: string, entered: boolean, why: string | null) {
  await db.update(siteForms).set({ entered, why }).where(eq(siteForms.id, id));
}

/**
 * The door a page's forms enter: its own hook, else its owner's first site-preset hook (Wren's:
 * the one the lander posts to). Null when the owner has none.
 */
export const doorOf = (db: Queryable, page: Pick<SitePage, "hook" | "client">) => doorFor(db, page);

/** A page's or a hosted form's door: its own hook, else its owner's first site-preset hook. */
export async function doorFor(
  db: Queryable,
  page: { hook: string | null; client: string | null },
): Promise<string | null> {
  if (page.hook) return page.hook;
  const site = HOOK_PRESETS.site;
  if (!site) return null;
  const [h] = await db
    .select({ id: hooks.id })
    .from(hooks)
    .where(
      and(
        page.client === null ? isNull(hooks.client) : eq(hooks.client, page.client),
        eq(hooks.workflow, site.workflow),
        eq(hooks.input, site.input),
      ),
    )
    .orderBy(asc(hooks.createdAt))
    .limit(1);
  return h?.id ?? null;
}

/** Pages with a version waiting on a yes, oldest ask first: To approve's rows. */
export async function waitingPages(db: Queryable) {
  return db
    .select({
      id: sitePages.id,
      title: sitePages.title,
      slug: sitePages.slug,
      client: sitePages.client,
      number: sitePages.waitingVersion,
      by: sitePages.waitingBy,
      at: sitePages.waitingAt,
      offer: sitePages.offer,
    })
    .from(sitePages)
    .where(sql`${sitePages.waitingVersion} is not null`)
    .orderBy(asc(sitePages.waitingAt));
}

export interface DayNumbers {
  day: string;
  views: number;
  ctas: number;
  forms: number;
  books: number;
}
export interface SourceNumbers {
  channel: Channel;
  source: string;
  campaign: string;
  views: number;
  forms: number;
  books: number;
}

/** A page's numbers by day, last 30 days, and by where visits came from. */
export async function pageNumbers(db: Queryable, id: string) {
  const days = await db.execute(sql`
    select to_char(d::date, 'YYYY-MM-DD') as day,
      count(e.id) filter (where e.name = 'view')::int views,
      count(e.id) filter (where e.name = 'cta')::int ctas,
      count(e.id) filter (where e.name = 'form')::int forms,
      count(e.id) filter (where e.name = 'book')::int books
    from generate_series(current_date - 29, current_date, interval '1 day') d
    left join site_events e on e.page = ${id} and e.at >= d and e.at < d + interval '1 day'
    group by d order by d`);
  const sources = await db.execute(sql`
    select channel, coalesce(source, '') source, coalesce(campaign, '') campaign,
      count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books
    from site_events where page = ${id}
    group by 1, 2, 3 order by views desc, forms desc limit 50`);
  return {
    days: [...days] as unknown as DayNumbers[],
    sources: [...sources] as unknown as SourceNumbers[],
  };
}

/**
 * A click on a client's `/go/` link, counted before the hop: the link, its utm, where it went
 * and the page that is when it's one of the owner's. The Worker leaves bots out.
 */
export async function recordHop(
  db: Queryable,
  h: {
    client: string | null;
    link: string;
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    to: string;
    slug?: string | null;
    ref?: string | null;
  },
): Promise<boolean> {
  const t = touchOf({
    source: h.source,
    medium: h.medium,
    campaign: h.campaign,
    content: h.content,
    ref: h.ref,
  });
  const link = clip(h.link, 80);
  const to = clip(h.to, 200);
  if (!link || !to) return false;
  const slug = h.slug && SLUG.test(h.slug) ? h.slug : null;
  const [page] = slug
    ? await db
        .select({ id: sitePages.id })
        .from(sitePages)
        .where(and(ownerIs(h.client), eq(sitePages.slug, slug)))
    : [];
  await db.insert(siteHops).values({
    client: h.client,
    link,
    channel: t.channel,
    source: t.source,
    medium: t.medium,
    campaign: t.campaign,
    content: t.content,
    to,
    page: page?.id ?? null,
    ref: t.ref,
  });
  return true;
}

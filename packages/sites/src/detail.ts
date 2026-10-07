/**
 * One page's detail, past its row in the list: its copy and versions (a data page), where it
 * is (a code page), its numbers by day and by source, the ads that link to it with spend and
 * arrivals per ad, and its variants side by side.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { kitTag, PREVIEW_PATH } from "./kit.js";
import { WREN_SITE } from "./model.js";
import type { SitePage } from "./schema.js";
import { type SplitResult, splitResult, splitsOf } from "./split.js";
import {
  type DayNumbers,
  pageById,
  pageNumbers,
  type SourceNumbers,
  versionOf,
  versionsOf,
} from "./store.js";
import { templateOf } from "./templates/index.js";
import type { Content, CopyField } from "./templates/types.js";

/**
 * One ad that links to the page, with Meta's numbers (`ad_days`, per its ad set) beside what the
 * page saw from it (events whose utm_content is the ad's id). Costs are null without spend or
 * without the count they divide by.
 */
export interface AdIn {
  id: string;
  name: string;
  status: string;
  adId: string;
  link: string;
  currency: string | null;
  spend: number;
  impressions: number;
  /** Meta's link clicks. */
  clicks: number;
  /** Meta's lead actions: instant forms and pixel leads. */
  leads: number;
  /** Unique views on this page from the ad. */
  views: number;
  forms: number;
  books: number;
  /** Clicks on a client's `/go/` link carrying the ad's id. */
  hops: number;
  costPerVisit: number | null;
  costPerForm: number | null;
  costPerBook: number | null;
}

export interface Variant {
  id: string;
  title: string;
  angle: string | null;
  audience: string | null;
  status: string;
  views: number;
  forms: number;
  books: number;
  formRate: number | null;
  spend: number;
}

export interface PageDetail {
  source: "data" | "code";
  /** A data page's template and its fields, for the copy form. */
  template: { id: string; name: string; fields: readonly CopyField[] } | null;
  /** The newest draft: what the form opens. */
  draft: { number: number; content: Content } | null;
  live: number | null;
  waiting: number | null;
  /** Asked to come down: waiting on a yes in To approve. */
  retiring: boolean;
  versions: { number: number; origin: string; why: string | null; by: string; at: string }[];
  /** The draft at our host, by its token: the preview frame. */
  preview: string | null;
  repoPath: string | null;
  /** What the team keeps about it. */
  notes: string | null;
  /** The tag a code page carries. */
  kit: string | null;
  days: DayNumbers[];
  sources: SourceNumbers[];
  ads: AdIn[];
  variants: Variant[];
  /** The split running on it (as A), with each arm's numbers and the call; else the last one. */
  split: SplitResult | null;
  /** Live pages of the same owner it could be split with: its variants first. */
  splitWith: { id: string; title: string; slug: string; variant: boolean }[];
}

/** The ads whose link holds this page: a data page's `/o/<slug>`, a code page's URL. */
async function adsIn(db: Queryable, page: SitePage): Promise<AdIn[]> {
  const match =
    page.source === "code" && page.url
      ? sql`(l.spec -> 'creative' ->> 'link') like ${`${page.url}%`}`
      : sql`(l.spec -> 'creative' ->> 'link') ~* ${`(/|%2f)o(/|%2f)${page.slug}([?#/&]|$)`}`;
  const rows = await db.execute(sql`
    select l.id::text id, l.name, l.status, l.ad_id "adId", l.spec -> 'creative' ->> 'link' link,
      m.currency, coalesce(m.spend, 0)::float8 spend, coalesce(m.impressions, 0)::int impressions,
      coalesce(m.clicks, 0)::int clicks, coalesce(m.leads, 0)::int leads,
      coalesce(e.views, 0)::int views, coalesce(e.forms, 0)::int forms,
      coalesce(e.books, 0)::int books,
      (select count(*) from site_hops h where h.page = ${page.id} and h.content = l.ad_id)::int hops
    from ad_launches l
    left join lateral (
      select max(d.currency) currency, sum(d.spend) spend, sum(d.impressions) impressions,
        sum(d.clicks) clicks, sum(d.leads) leads
      from ad_days d where d.adset_id = l.adset_id) m on true
    left join lateral (
      select count(distinct x.view) filter (where x.name = 'view') views,
        count(*) filter (where x.name = 'form') forms,
        count(distinct x.view) filter (where x.name = 'book') books
      from site_events x where x.page = ${page.id} and x.content = l.ad_id) e on true
    where ${match}
    order by spend desc, l.created_at desc limit 50`);
  return ([...rows] as unknown as Omit<AdIn, "costPerVisit" | "costPerForm" | "costPerBook">[]).map(
    (a) => ({
      ...a,
      costPerVisit: costPer(a.spend, a.views),
      costPerForm: costPer(a.spend, a.forms),
      costPerBook: costPer(a.spend, a.books),
    }),
  );
}

/** Spend over a count, to the cent; null with no spend or nothing to divide by. */
export const costPer = (spend: number, n: number): number | null =>
  spend > 0 && n > 0 ? Math.round((spend / n) * 100) / 100 : null;

/** The page's family: the page it was copied from and every copy of it, this one included. */
async function variantsOf(db: Queryable, page: SitePage): Promise<Variant[]> {
  const root = page.variantOf ?? page.id;
  const rows = await db.execute(sql`
    select r.id, r.title, r.angle, r.audience, r.status, r.views, r.forms, r.books,
      r.form_rate "formRate", r.spend
    from site_page_records r join site_pages p on p.id::text = r.id
    where p.id = ${root} or p.variant_of = ${root}
    order by r.form_rate desc nulls last, r.views desc`);
  const out = [...rows] as unknown as Variant[];
  return out.length > 1 ? out : [];
}

/** The page's live split, else its newest one, with numbers and the call. */
async function splitOf(db: Queryable, page: SitePage): Promise<SplitResult | null> {
  const [s] = await splitsOf(db, page.id);
  return s ? splitResult(db, s) : null;
}

async function splitWithOf(db: Queryable, page: SitePage) {
  if (page.source !== "data") return [];
  const root = page.variantOf ?? page.id;
  const rows = await db.execute(sql`
    select p.id::text id, p.title, p.slug, (p.id = ${root} or p.variant_of = ${root}) variant
    from site_pages p
    where p.id <> ${page.id} and p.source = 'data' and p.status = 'live'
      and p.live_version is not null and p.retire_at is null
      and ${page.client === null ? sql`p.client is null` : sql`p.client = ${page.client}`}
    order by variant desc, p.updated_at desc limit 40`);
  return [...rows] as unknown as PageDetail["splitWith"];
}

export async function pageDetail(db: Queryable, id: string): Promise<PageDetail | null> {
  const page = await pageById(db, id);
  if (!page) return null;
  const numbers = await pageNumbers(db, page.id);
  const common = {
    live: page.liveVersion,
    waiting: page.waitingVersion,
    repoPath: page.repoPath,
    notes: page.notes,
    retiring: page.retireAt !== null,
    ...numbers,
    ads: await adsIn(db, page),
    variants: await variantsOf(db, page),
    split: await splitOf(db, page),
    splitWith: await splitWithOf(db, page),
  };
  if (page.source === "code")
    return {
      source: "code",
      template: null,
      draft: null,
      versions: [],
      preview: null,
      kit: kitTag(page.id, `https://${WREN_SITE}`),
      ...common,
    };
  const t = templateOf(page.template);
  const draft = page.draftVersion ? await versionOf(db, page.id, page.draftVersion) : null;
  const versions = await versionsOf(db, page.id);
  return {
    source: "data",
    template: { id: t.id, name: t.name, fields: t.fields },
    draft: draft ? { number: draft.number, content: draft.content } : null,
    versions: versions.map((v) => ({ ...v, at: v.at.toISOString() })),
    preview: draft ? `${PREVIEW_PATH}${page.id}?t=${page.previewToken}` : null,
    kit: null,
    ...common,
  };
}

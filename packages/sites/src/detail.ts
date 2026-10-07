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

export interface AdIn {
  id: string;
  name: string;
  status: string;
  adId: string;
  link: string;
  spend: number;
  clicks: number;
  /** Views on this page whose utm_content is the ad's id. */
  views: number;
  forms: number;
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
}

/** The ads whose link holds this page: a data page's `/o/<slug>`, a code page's URL. */
async function adsIn(db: Queryable, page: SitePage): Promise<AdIn[]> {
  const match =
    page.source === "code" && page.url
      ? sql`(l.spec -> 'creative' ->> 'link') like ${`${page.url}%`}`
      : sql`(l.spec -> 'creative' ->> 'link') ~* ${`(/|%2f)o(/|%2f)${page.slug}([?#/&]|$)`}`;
  const rows = await db.execute(sql`
    select l.id::text id, l.name, l.status, l.ad_id "adId", l.spec -> 'creative' ->> 'link' link,
      coalesce((select sum(d.spend) from ad_days d where d.adset_id = l.adset_id), 0)::float8 spend,
      coalesce((select sum(d.clicks) from ad_days d where d.adset_id = l.adset_id), 0)::int clicks,
      (select count(*) from site_events e where e.page = ${page.id} and e.name = 'view' and e.content = l.ad_id)::int views,
      (select count(*) from site_events e where e.page = ${page.id} and e.name = 'form' and e.content = l.ad_id)::int forms
    from ad_launches l where ${match}
    order by l.created_at desc limit 50`);
  return [...rows] as unknown as AdIn[];
}

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

export async function pageDetail(db: Queryable, id: string): Promise<PageDetail | null> {
  const page = await pageById(db, id);
  if (!page) return null;
  const numbers = await pageNumbers(db, page.id);
  const common = {
    live: page.liveVersion,
    waiting: page.waitingVersion,
    repoPath: page.repoPath,
    notes: page.notes,
    ...numbers,
    ads: await adsIn(db, page),
    variants: await variantsOf(db, page),
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

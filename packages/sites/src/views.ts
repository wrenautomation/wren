/**
 * The SQL views behind Sites' records (`./records.ts`), one row per record.
 *
 * - `site_page_records`: every page we run. Our own pages with their numbers, then pages other
 *   parts already know: demo videos (`enrichments` kind `video`), each client's portal host and
 *   its booking page (`client_domains`). Those are read only here.
 * - `site_funnel_records`: one row per page and where its visits came from: views, clicks,
 *   forms, booking clicks, and for ads the spend.
 *
 * An ad links to a page when its creative's link holds the page's address: a data page's
 * `/o/<slug>` (also as a `/go/...?to=/o/<slug>` short link), a code page's URL.
 */
import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgView, text, timestamp } from "drizzle-orm/pg-core";
import { WREN_SITE } from "./model.js";

const DATA_URL = sql.raw(`case when p.source = 'code' then p.url
    when p.client is null then 'https://${WREN_SITE}/o/' || p.slug
    else (select 'https://' || d.hostname || '/o/' || p.slug from client_domains d
      where d.client_id = p.client and d.status = 'active' order by d.created_at limit 1) end`);

const ADS =
  sql.raw(`select p.id page, count(distinct l.id)::int ads, coalesce(sum(d.spend), 0)::float8 spend
    from site_pages p
    join ad_launches l on case when p.source = 'code'
        then (l.spec -> 'creative' ->> 'link') like p.url || '%'
        else (l.spec -> 'creative' ->> 'link') ~* ('(/|%2f)o(/|%2f)' || p.slug || '([?#/&]|$)') end
    left join ad_days d on d.adset_id = l.adset_id
    group by p.id`);

export const sitePageRecords = pgView("site_page_records", {
  id: text("id"),
  title: text("title"),
  url: text("url"),
  kind: text("kind"),
  source: text("source"),
  owner: text("owner"),
  status: text("status"),
  waiting: integer("waiting"),
  offer: text("offer"),
  angle: text("angle"),
  audience: text("audience"),
  stage: text("stage"),
  template: text("template"),
  variantOf: text("variant_of"),
  repoPath: text("repo_path"),
  views: integer("views"),
  ctas: integer("ctas"),
  forms: integer("forms"),
  books: integer("books"),
  formRate: doublePrecision("form_rate"),
  ads: integer("ads"),
  spend: doublePrecision("spend"),
  costPerForm: doublePrecision("cost_per_form"),
  changed: timestamp("changed", { withTimezone: true }),
  changedBy: text("changed_by"),
  currency: text("currency"),
}).as(sql`
  with ev as (
    select page, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books
    from site_events group by page),
  ads as (${ADS})
  select p.id::text id, p.title::text, ${DATA_URL} url, p.kind::text, p.source::text,
    coalesce(p.client, 'wren')::text owner, p.status::text, p.waiting_version waiting,
    p.offer::text, p.angle::text, p.audience::text, p.stage::text, p.template::text,
    p.variant_of::text variant_of, p.repo_path,
    coalesce(ev.views, 0) views, coalesce(ev.ctas, 0) ctas, coalesce(ev.forms, 0) forms,
    coalesce(ev.books, 0) books,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.forms, 0)::float8 / ev.views end form_rate,
    coalesce(ads.ads, 0) ads, coalesce(ads.spend, 0)::float8 spend,
    case when coalesce(ev.forms, 0) > 0 and ads.spend > 0 then ads.spend / ev.forms end cost_per_form,
    p.updated_at changed, p.updated_by changed_by, 'USD'::text currency
  from site_pages p
  left join ev on ev.page = p.id
  left join ads on ads.page = p.id
  union all
  select 'video:' || (e.output ->> 'id'), coalesce(e.output ->> 'firm', 'Demo video'),
    e.output ->> 'url', 'demo', 'derived', 'wren', 'live', null, null, null, null, 'trust', null,
    null, null, null, null, null, null, null, null, null, null, e.created_at, null, null
  from enrichments e where e.kind = 'video' and e.output ? 'url' and e.output ? 'id'
  union all
  select 'host:' || d.hostname, d.hostname, 'https://' || d.hostname, 'portal', 'derived',
    d.client_id, case when d.status = 'active' then 'live' else 'draft' end, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, d.checked_at,
    d.added_by, null
  from client_domains d
  union all
  select 'book:' || d.hostname, 'Booking on ' || d.hostname, 'https://' || d.hostname || '/book',
    'booking', 'derived', d.client_id, case when d.status = 'active' then 'live' else 'draft' end,
    null, null, null, null, 'convert', null, null, null, null, null, null, null, null, null, null,
    null, d.checked_at, d.added_by, null
  from client_domains d`);

export const siteFunnelRecords = pgView("site_funnel_records", {
  id: text("id"),
  page: text("page"),
  title: text("title"),
  offer: text("offer"),
  status: text("status"),
  channel: text("channel"),
  views: integer("views"),
  ctas: integer("ctas"),
  forms: integer("forms"),
  books: integer("books"),
  formRate: doublePrecision("form_rate"),
  spend: doublePrecision("spend"),
  costPerForm: doublePrecision("cost_per_form"),
  last: timestamp("last", { withTimezone: true }),
  currency: text("currency"),
}).as(sql`
  with ev as (
    select page, channel, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books, max(at) last
    from site_events group by page, channel),
  ads as (${ADS}),
  joined as (
    select coalesce(ev.page, ads.page) page, coalesce(ev.channel, 'ads') channel,
      coalesce(ev.views, 0) views, coalesce(ev.ctas, 0) ctas, coalesce(ev.forms, 0) forms,
      coalesce(ev.books, 0) books, ev.last,
      case when coalesce(ev.channel, 'ads') = 'ads' then coalesce(ads.spend, 0) else 0 end spend
    from ev full join ads on ads.page = ev.page and ev.channel = 'ads')
  select r.page::text || ':' || r.channel id, r.page::text page, p.title::text, p.offer::text,
    p.status::text, r.channel::text, r.views, r.ctas, r.forms, r.books,
    case when r.views > 0 then r.forms::float8 / r.views end form_rate, r.spend::float8,
    case when r.forms > 0 and r.spend > 0 then r.spend / r.forms end cost_per_form, r.last,
    'USD'::text currency
  from joined r join site_pages p on p.id = r.page`);

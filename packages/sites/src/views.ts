/**
 * The SQL views behind Sites' records (`./records.ts`), one row per record.
 *
 * - `site_page_records`: every page we run. Our own pages with their numbers, then pages other
 *   parts already know: demo videos (`enrichments` kind `video`), each client's portal host and
 *   its booking page (`client_domains`). Those are read only here.
 * - `site_funnel_records`: one row per page and where its visits came from: views, clicks,
 *   forms, booking clicks, and for ads the spend.
 * - `site_form_records`: every hosted form with its views, starts, submits and conversion.
 * - `site_entry_records`: every form sent, from a page or a hosted form, whole.
 * - `site_link_records`: every tracked `/go/` link with its hits: clicks counted at a client's
 *   edge, or Wren's read off the lander's click log (`./hops.ts` `importLanderClicks`), and the
 *   visits, forms and booking clicks its page saw with the link's utm, on any arm of a split at
 *   its address.

Every view's `owner` is the client id ("wren" for Wren's) and `owner_name` the client's name
("Wren" for Wren's), as people read it.
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
  ownerName: text("owner_name"),
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
  /** Its split, when one runs on it: running, or shipping (a winner waits in To approve). */
  split: text("split"),
  /** What waits on a yes in To approve: a version to publish, or the page to retire. */
  asked: text("asked"),
  /** The URL as people read it in a list: host and path, no scheme. */
  address: text("address"),
}).as(sql`
  with ev as (
    select page, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books
    from site_events group by page),
  ads as (${ADS})
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
  select p.id::text id, p.title::text, ${DATA_URL} url, p.kind::text, p.source::text,
    coalesce(p.client, 'wren')::text owner, p.status::text, p.waiting_version waiting,
    p.offer::text, p.angle::text, p.audience::text, p.stage::text, p.template::text,
    p.variant_of::text variant_of, p.repo_path,
    coalesce(ev.views, 0) views, coalesce(ev.ctas, 0) ctas, coalesce(ev.forms, 0) forms,
    coalesce(ev.books, 0) books,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.forms, 0)::float8 / ev.views end form_rate,
    coalesce(ads.ads, 0) ads, coalesce(ads.spend, 0)::float8 spend,
    case when coalesce(ev.forms, 0) > 0 and ads.spend > 0 then ads.spend / ev.forms end cost_per_form,
    p.updated_at changed, p.updated_by changed_by, 'USD'::text currency,
    (select s.state::text from site_splits s
      where s.page = p.id and s.state in ('running', 'shipping')) split,
    case when p.retire_at is not null then 'retire'
      when p.waiting_version is not null then 'publish' end asked
  from site_pages p
  left join ev on ev.page = p.id
  left join ads on ads.page = p.id
  union all
  select 'video:' || (e.output ->> 'id'), coalesce(e.output ->> 'firm', 'Demo video'),
    e.output ->> 'url', 'demo', 'derived', 'wren', 'live', null, null, null, null, 'trust', null,
    null, null, null, null, null, null, null, null, null, null, e.created_at, null, null, null,
    null
  from enrichments e where e.kind = 'video' and e.output ? 'url' and e.output ? 'id'
  union all
  select 'host:' || d.hostname, d.hostname, 'https://' || d.hostname, 'portal', 'derived',
    d.client_id, case when d.status = 'active' then 'live' else 'draft' end, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, d.checked_at,
    d.added_by, null, null, null
  from client_domains d
  union all
  select 'book:' || d.hostname, 'Booking on ' || d.hostname, 'https://' || d.hostname || '/book',
    'booking', 'derived', d.client_id, case when d.status = 'active' then 'live' else 'draft' end,
    null, null, null, null, 'convert', null, null, null, null, null, null, null, null, null, null,
    null, d.checked_at, d.added_by, null, null, null
  from client_domains d) u
  left join clients c on c.id = u.owner`);

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

export const siteFormRecords = pgView("site_form_records", {
  id: text("id"),
  name: text("name"),
  slug: text("slug"),
  owner: text("owner"),
  ownerName: text("owner_name"),
  status: text("status"),
  url: text("url"),
  address: text("address"),
  fields: integer("fields"),
  views: integer("views"),
  starts: integer("starts"),
  submits: integer("submits"),
  conversion: doublePrecision("conversion"),
  last: timestamp("last", { withTimezone: true }),
  changed: timestamp("changed", { withTimezone: true }),
  changedBy: text("changed_by"),
}).as(sql`
  with ev as (
    select form, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'start')::int starts,
      count(*) filter (where name = 'form')::int submits,
      max(at) filter (where name = 'form') last
    from site_events where form is not null group by form)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
  select f.id::text id, f.name::text, f.slug::text, coalesce(f.client, 'wren')::text owner,
    f.status::text,
    case when f.client is null then 'https://${sql.raw(WREN_SITE)}/o/f/' || f.slug
      else (select 'https://' || d.hostname || '/o/f/' || f.slug from client_domains d
        where d.client_id = f.client and d.status = 'active' order by d.created_at limit 1) end url,
    jsonb_array_length(f.spec -> 'fields')::int fields,
    coalesce(ev.views, 0) views, coalesce(ev.starts, 0) starts, coalesce(ev.submits, 0) submits,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.submits, 0)::float8 / ev.views end conversion,
    ev.last, f.updated_at changed, f.updated_by changed_by
  from site_form_defs f left join ev on ev.form = f.id) u
  left join clients c on c.id = u.owner`);

export const siteEntryRecords = pgView("site_entry_records", {
  id: text("id"),
  form: text("form"),
  formName: text("form_name"),
  page: text("page"),
  pageTitle: text("page_title"),
  owner: text("owner"),
  ownerName: text("owner_name"),
  at: timestamp("at", { withTimezone: true }),
  channel: text("channel"),
  source: text("source"),
  campaign: text("campaign"),
  who: text("who"),
  email: text("email"),
  phone: text("phone"),
  consented: text("consented"),
  consentVersion: text("consent_version"),
  consentText: text("consent_text"),
  entered: text("entered"),
  why: text("why"),
  visitor: text("visitor"),
  human: text("human"),
  answers: text("answers"),
}).as(sql`
  select e.id::text id, e.form::text form, f.name::text form_name, e.page::text page,
    p.title::text page_title, coalesce(f.client, p.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name, e.at,
    e.channel::text, e.touch ->> 'source' source, e.touch ->> 'campaign' campaign,
    coalesce(e.fields ->> 'name',
      nullif(concat_ws(' ', e.fields ->> 'first_name', e.fields ->> 'last_name'), '')) who,
    e.fields ->> 'email' email, e.fields ->> 'phone' phone, case when e.consent is not null then 'yes' else 'no' end consented,
    e.consent ->> 'version' consent_version, e.consent ->> 'text' consent_text,
    case when e.entered then 'in' else 'out' end entered, e.why,
    e.visitor::text, e.human::text,
    (select string_agg(k || ': ' || v, '; ' order by k) from jsonb_each_text(e.fields) x(k, v)) answers
  from site_forms e
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  left join clients c on c.id = coalesce(f.client, p.client)`);

export const siteLinkRecords = pgView("site_link_records", {
  id: text("id"),
  owner: text("owner"),
  ownerName: text("owner_name"),
  name: text("name"),
  page: text("page"),
  pageTitle: text("page_title"),
  slug: text("slug"),
  link: text("link"),
  source: text("source"),
  medium: text("medium"),
  channel: text("channel"),
  campaign: text("campaign"),
  content: text("content"),
  host: text("host"),
  url: text("url"),
  clicks: integer("clicks"),
  visits: integer("visits"),
  forms: integer("forms"),
  books: integer("books"),
  last: timestamp("last", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
  createdBy: text("created_by"),
}).as(sql`
  select l.id::text id, coalesce(l.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name,
    coalesce(l.name, concat_ws(' / ', l.link, l.campaign, l.content))::text name,
    l.page::text page, p.title::text page_title, p.slug::text, l.link::text, l.source::text,
    l.medium::text, l.channel::text, l.campaign::text, l.content::text, h.host,
    'https://' || h.host || '/go/' || l.link || '/' || l.campaign
      || coalesce('/' || l.content, '') || '?to=/o/' || p.slug url,
    k.clicks, coalesce(e.visits, 0) visits, coalesce(e.forms, 0) forms, coalesce(e.books, 0) books,
    greatest(e.last, k.last) last, l.created_at created, l.created_by::text created_by
  from site_links l
  join site_pages p on p.id = l.page
  left join clients c on c.id = l.client
  left join lateral (select case when l.client is null then '${sql.raw(WREN_SITE)}'
      else (select d.hostname from client_domains d where d.client_id = l.client
        and d.status = 'active' order by d.created_at limit 1) end::text host) h on true
  left join lateral (
    select count(distinct x.view) filter (where x.name = 'view')::int visits,
      count(*) filter (where x.name = 'form')::int forms,
      count(distinct x.view) filter (where x.name = 'book')::int books, max(x.at) last
    from site_events x
    where (x.page = l.page or x.split in (select s.id from site_splits s where s.page = l.page))
      and x.source = l.source and x.medium = l.medium and x.campaign = l.campaign
      and coalesce(x.content, '') = coalesce(l.content, '')) e on true
  left join lateral (
    select count(*)::int clicks, max(y.at) last
    from site_hops y
    where y.client is not distinct from l.client and y.page = l.page and y.link = l.link
      and y.campaign = l.campaign and coalesce(y.content, '') = coalesce(l.content, '')) k on true`);

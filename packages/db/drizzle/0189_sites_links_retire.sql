CREATE TABLE "site_links" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"page" uuid NOT NULL,
	"link" varchar(80) NOT NULL,
	"source" varchar(120) NOT NULL,
	"medium" varchar(120) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"campaign" varchar(80) NOT NULL,
	"content" varchar(80),
	"name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "pk_site_links" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_links_channel" CHECK (("channel")::text = ANY ((ARRAY['ads'::character varying, 'organic'::character varying, 'outreach'::character varying, 'referral'::character varying, 'direct'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."site_page_records";--> statement-breakpoint
ALTER TABLE "site_pages" ADD COLUMN "retire_by" text;--> statement-breakpoint
ALTER TABLE "site_pages" ADD COLUMN "retire_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_links" ADD CONSTRAINT "fk_site_links_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_links" ADD CONSTRAINT "fk_site_links_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_links_utm" ON "site_links" USING btree (coalesce("client", ''),"page","link","campaign",coalesce("content", ''));--> statement-breakpoint
CREATE INDEX "ix_site_links_client" ON "site_links" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_site_links_page" ON "site_links" USING btree ("page");--> statement-breakpoint
CREATE VIEW "public"."site_link_records" AS (
  select l.id::text id, coalesce(l.client, 'wren')::text owner,
    coalesce(l.name, concat_ws(' / ', l.link, l.campaign, l.content))::text name,
    l.page::text page, p.title::text page_title, p.slug::text, l.link::text, l.source::text,
    l.medium::text, l.channel::text, l.campaign::text, l.content::text, h.host,
    'https://' || h.host || '/go/' || l.link || '/' || l.campaign
      || coalesce('/' || l.content, '') || '?to=/o/' || p.slug url,
    k.clicks, coalesce(e.visits, 0) visits, coalesce(e.forms, 0) forms, coalesce(e.books, 0) books,
    greatest(e.last, k.last) last, l.created_at created, l.created_by::text created_by
  from site_links l
  join site_pages p on p.id = l.page
  left join lateral (select case when l.client is null then 'wrenautomation.com'
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
    select case when l.client is null then null else count(*)::int end clicks, max(y.at) last
    from site_hops y
    where l.client is not null and y.client = l.client and y.page = l.page and y.link = l.link
      and y.campaign = l.campaign and coalesce(y.content, '') = coalesce(l.content, '')) k on true);--> statement-breakpoint
CREATE VIEW "public"."site_page_records" AS (
  with ev as (
    select page, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books
    from site_events group by page),
  ads as (select p.id page, count(distinct l.id)::int ads, coalesce(sum(d.spend), 0)::float8 spend
    from site_pages p
    join ad_launches l on case when p.source = 'code'
        then (l.spec -> 'creative' ->> 'link') like p.url || '%'
        else (l.spec -> 'creative' ->> 'link') ~* ('(/|%2f)o(/|%2f)' || p.slug || '([?#/&]|$)') end
    left join ad_days d on d.adset_id = l.adset_id
    group by p.id)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address from (
  select p.id::text id, p.title::text, case when p.source = 'code' then p.url
    when p.client is null then 'https://wrenautomation.com/o/' || p.slug
    else (select 'https://' || d.hostname || '/o/' || p.slug from client_domains d
      where d.client_id = p.client and d.status = 'active' order by d.created_at limit 1) end url, p.kind::text, p.source::text,
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
  from client_domains d) u);
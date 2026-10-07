CREATE TABLE "site_hops" (
	"id" bigserial NOT NULL,
	"client" varchar(40),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"link" varchar(80) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"source" varchar(120),
	"medium" varchar(120),
	"campaign" varchar(120),
	"content" varchar(120),
	"to" varchar(200) NOT NULL,
	"page" uuid,
	"ref" varchar(200),
	CONSTRAINT "pk_site_hops" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_hops_channel" CHECK (("channel")::text = ANY ((ARRAY['ads'::character varying, 'organic'::character varying, 'outreach'::character varying, 'referral'::character varying, 'direct'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "site_split_arms" (
	"split" uuid NOT NULL,
	"label" varchar(2) NOT NULL,
	"page" uuid NOT NULL,
	"weight" integer NOT NULL,
	CONSTRAINT "pk_site_split_arms" PRIMARY KEY("split","label"),
	CONSTRAINT "ck_site_split_arms_label" CHECK (("label")::text = ANY ((ARRAY['A'::character varying, 'B'::character varying, 'C'::character varying, 'D'::character varying, 'E'::character varying])::text[])),
	CONSTRAINT "ck_site_split_arms_weight" CHECK ("site_split_arms"."weight" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "site_splits" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"page" uuid NOT NULL,
	"state" varchar(10) DEFAULT 'running' NOT NULL,
	"goal" varchar(8) DEFAULT 'forms' NOT NULL,
	"winner" varchar(2),
	"ship_version" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_site_splits" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_splits_state" CHECK (("state")::text = ANY ((ARRAY['running'::character varying, 'shipping'::character varying, 'shipped'::character varying, 'stopped'::character varying])::text[])),
	CONSTRAINT "ck_site_splits_goal" CHECK (("goal")::text = ANY ((ARRAY['forms'::character varying, 'books'::character varying, 'won'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."site_page_records";--> statement-breakpoint
ALTER TABLE "site_events" ADD COLUMN "split" uuid;--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "split" uuid;--> statement-breakpoint
ALTER TABLE "site_hops" ADD CONSTRAINT "fk_site_hops_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_hops" ADD CONSTRAINT "fk_site_hops_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_split_arms" ADD CONSTRAINT "fk_site_split_arms_split" FOREIGN KEY ("split") REFERENCES "public"."site_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_split_arms" ADD CONSTRAINT "fk_site_split_arms_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_splits" ADD CONSTRAINT "fk_site_splits_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_splits" ADD CONSTRAINT "fk_site_splits_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_site_hops_client_at" ON "site_hops" USING btree ("client","at");--> statement-breakpoint
CREATE INDEX "ix_site_hops_page_at" ON "site_hops" USING btree ("page","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_split_arms_page" ON "site_split_arms" USING btree ("split","page");--> statement-breakpoint
CREATE INDEX "ix_site_split_arms_page" ON "site_split_arms" USING btree ("page");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_splits_live" ON "site_splits" USING btree ("page") WHERE "site_splits"."state" in ('running', 'shipping');--> statement-breakpoint
CREATE INDEX "ix_site_splits_client" ON "site_splits" USING btree ("client");--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "fk_site_events_split" FOREIGN KEY ("split") REFERENCES "public"."site_splits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "fk_site_forms_split" FOREIGN KEY ("split") REFERENCES "public"."site_splits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_site_events_split" ON "site_events" USING btree ("split") WHERE "site_events"."split" is not null;--> statement-breakpoint
CREATE INDEX "ix_site_forms_split" ON "site_forms" USING btree ("split") WHERE "site_forms"."split" is not null;--> statement-breakpoint
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
      where s.page = p.id and s.state in ('running', 'shipping')) split
  from site_pages p
  left join ev on ev.page = p.id
  left join ads on ads.page = p.id
  union all
  select 'video:' || (e.output ->> 'id'), coalesce(e.output ->> 'firm', 'Demo video'),
    e.output ->> 'url', 'demo', 'derived', 'wren', 'live', null, null, null, null, 'trust', null,
    null, null, null, null, null, null, null, null, null, null, e.created_at, null, null, null
  from enrichments e where e.kind = 'video' and e.output ? 'url' and e.output ? 'id'
  union all
  select 'host:' || d.hostname, d.hostname, 'https://' || d.hostname, 'portal', 'derived',
    d.client_id, case when d.status = 'active' then 'live' else 'draft' end, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, d.checked_at,
    d.added_by, null, null
  from client_domains d
  union all
  select 'book:' || d.hostname, 'Booking on ' || d.hostname, 'https://' || d.hostname || '/book',
    'booking', 'derived', d.client_id, case when d.status = 'active' then 'live' else 'draft' end,
    null, null, null, null, 'convert', null, null, null, null, null, null, null, null, null, null,
    null, d.checked_at, d.added_by, null, null
  from client_domains d) u);
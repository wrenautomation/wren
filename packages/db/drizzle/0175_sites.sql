CREATE TABLE "site_events" (
	"id" bigserial NOT NULL,
	"page" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"view" varchar(36) NOT NULL,
	"name" varchar(8) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"source" varchar(120),
	"medium" varchar(120),
	"campaign" varchar(120),
	"content" varchar(120),
	"ref" varchar(200),
	"width" integer,
	CONSTRAINT "pk_site_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_events_name" CHECK (("name")::text = ANY ((ARRAY['view'::character varying, 'cta'::character varying, 'form'::character varying, 'book'::character varying])::text[])),
	CONSTRAINT "ck_site_events_channel" CHECK (("channel")::text = ANY ((ARRAY['ads'::character varying, 'organic'::character varying, 'outreach'::character varying, 'referral'::character varying, 'direct'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "site_forms" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"page" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"fields" jsonb NOT NULL,
	"touch" jsonb NOT NULL,
	"channel" varchar(10) NOT NULL,
	"entered" boolean DEFAULT false NOT NULL,
	"why" text,
	CONSTRAINT "pk_site_forms" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_forms_channel" CHECK (("channel")::text = ANY ((ARRAY['ads'::character varying, 'organic'::character varying, 'outreach'::character varying, 'referral'::character varying, 'direct'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "site_page_versions" (
	"page" uuid NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"origin" varchar(8) NOT NULL,
	"why" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_site_page_versions" PRIMARY KEY("page","number"),
	CONSTRAINT "ck_site_page_versions_origin" CHECK (("origin")::text = ANY ((ARRAY['offer'::character varying, 'edit'::character varying, 'ai'::character varying, 'copy'::character varying, 'restore'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"slug" varchar(80) NOT NULL,
	"title" varchar(200) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"source" varchar(8) NOT NULL,
	"url" text,
	"repo_path" text,
	"template" varchar(16),
	"offer" varchar(64),
	"angle" varchar(120),
	"audience" varchar(120),
	"variant_of" uuid,
	"stage" varchar(8) DEFAULT 'convert' NOT NULL,
	"status" varchar(8) DEFAULT 'draft' NOT NULL,
	"live_version" integer,
	"draft_version" integer,
	"waiting_version" integer,
	"waiting_by" text,
	"waiting_at" timestamp with time zone,
	"preview_token" varchar(43) NOT NULL,
	"hook" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_site_pages" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_pages_kind" CHECK (("kind")::text = ANY ((ARRAY['lander'::character varying, 'listicle'::character varying, 'pitch'::character varying, 'demo'::character varying, 'booking'::character varying, 'thank-you'::character varying, 'portal'::character varying])::text[])),
	CONSTRAINT "ck_site_pages_source" CHECK (("source")::text = ANY ((ARRAY['data'::character varying, 'code'::character varying])::text[])),
	CONSTRAINT "ck_site_pages_stage" CHECK (("stage")::text = ANY ((ARRAY['reach'::character varying, 'trust'::character varying, 'convert'::character varying])::text[])),
	CONSTRAINT "ck_site_pages_status" CHECK (("status")::text = ANY ((ARRAY['draft'::character varying, 'live'::character varying, 'retired'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "fk_site_events_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "fk_site_forms_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_versions" ADD CONSTRAINT "fk_site_page_versions_page" FOREIGN KEY ("page") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "fk_site_pages_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "fk_site_pages_variant_of" FOREIGN KEY ("variant_of") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "fk_site_pages_hook" FOREIGN KEY ("hook") REFERENCES "public"."hooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_site_events_page_at" ON "site_events" USING btree ("page","at");--> statement-breakpoint
CREATE INDEX "ix_site_forms_page_at" ON "site_forms" USING btree ("page","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_pages_slug" ON "site_pages" USING btree (coalesce("client", ''),"slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_pages_url" ON "site_pages" USING btree ("url") WHERE "site_pages"."url" is not null;--> statement-breakpoint
CREATE INDEX "ix_site_pages_client" ON "site_pages" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_site_pages_offer" ON "site_pages" USING btree ("offer");--> statement-breakpoint
CREATE INDEX "ix_site_pages_variant_of" ON "site_pages" USING btree ("variant_of");--> statement-breakpoint
CREATE INDEX "ix_site_pages_hook" ON "site_pages" USING btree ("hook");--> statement-breakpoint
CREATE VIEW "public"."site_funnel_records" AS (
  with ev as (
    select page, channel, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books, max(at) last
    from site_events group by page, channel),
  ads as (select p.id page, count(distinct l.id)::int ads, coalesce(sum(d.spend), 0)::float8 spend
    from site_pages p
    join ad_launches l on case when p.source = 'code'
        then (l.spec -> 'creative' ->> 'link') like p.url || '%'
        else (l.spec -> 'creative' ->> 'link') ~* ('(/|%2f)o(/|%2f)' || p.slug || '([?#/&]|$)') end
    left join ad_days d on d.adset_id = l.adset_id
    group by p.id),
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
  from joined r join site_pages p on p.id = r.page);--> statement-breakpoint
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
  from client_domains d) u);
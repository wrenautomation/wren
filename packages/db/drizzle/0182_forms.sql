CREATE TABLE "site_form_defs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"slug" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(8) DEFAULT 'draft' NOT NULL,
	"spec" jsonb NOT NULL,
	"hook" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_site_form_defs" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_form_defs_status" CHECK (("status")::text = ANY ((ARRAY['draft'::character varying, 'live'::character varying, 'retired'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "site_events" DROP CONSTRAINT "ck_site_events_name";--> statement-breakpoint
ALTER TABLE "site_events" ALTER COLUMN "page" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "site_forms" ALTER COLUMN "page" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "site_events" ADD COLUMN "form" uuid;--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "form" uuid;--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "consent" jsonb;--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "visitor" varchar(64);--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "human" varchar(4);--> statement-breakpoint
ALTER TABLE "site_form_defs" ADD CONSTRAINT "fk_site_form_defs_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_form_defs" ADD CONSTRAINT "fk_site_form_defs_hook" FOREIGN KEY ("hook") REFERENCES "public"."hooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_form_defs_slug" ON "site_form_defs" USING btree (coalesce("client", ''),"slug");--> statement-breakpoint
CREATE INDEX "ix_site_form_defs_client" ON "site_form_defs" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_site_form_defs_hook" ON "site_form_defs" USING btree ("hook");--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "fk_site_events_form" FOREIGN KEY ("form") REFERENCES "public"."site_form_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "fk_site_forms_form" FOREIGN KEY ("form") REFERENCES "public"."site_form_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_site_events_form_at" ON "site_events" USING btree ("form","at");--> statement-breakpoint
CREATE INDEX "ix_site_forms_form_at" ON "site_forms" USING btree ("form","at");--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "ck_site_events_where" CHECK ("site_events"."page" is not null or "site_events"."form" is not null);--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "ck_site_events_name" CHECK (("name")::text = ANY ((ARRAY['view'::character varying, 'cta'::character varying, 'form'::character varying, 'book'::character varying, 'start'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "ck_site_forms_where" CHECK ("site_forms"."page" is not null or "site_forms"."form" is not null);--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "ck_site_forms_human" CHECK (("human")::text = ANY ((ARRAY['yes'::character varying, 'off'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "public"."site_entry_records" AS (
  select e.id::text id, e.form::text form, f.name::text form_name, e.page::text page,
    p.title::text page_title, coalesce(f.client, p.client, 'wren')::text owner, e.at,
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
  left join site_pages p on p.id = e.page);--> statement-breakpoint
CREATE VIEW "public"."site_form_records" AS (
  with ev as (
    select form, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'start')::int starts,
      count(*) filter (where name = 'form')::int submits,
      max(at) filter (where name = 'form') last
    from site_events where form is not null group by form)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address from (
  select f.id::text id, f.name::text, f.slug::text, coalesce(f.client, 'wren')::text owner,
    f.status::text,
    case when f.client is null then 'https://wrenautomation.com/o/f/' || f.slug
      else (select 'https://' || d.hostname || '/o/f/' || f.slug from client_domains d
        where d.client_id = f.client and d.status = 'active' order by d.created_at limit 1) end url,
    jsonb_array_length(f.spec -> 'fields')::int fields,
    coalesce(ev.views, 0) views, coalesce(ev.starts, 0) starts, coalesce(ev.submits, 0) submits,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.submits, 0)::float8 / ev.views end conversion,
    ev.last, f.updated_at changed, f.updated_by changed_by
  from site_form_defs f left join ev on ev.form = f.id) u);
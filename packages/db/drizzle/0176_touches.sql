CREATE TABLE "social_handles" (
	"id" serial NOT NULL,
	"platform" varchar(16) NOT NULL,
	"handle" varchar(200) NOT NULL,
	"url" text,
	"name" text,
	"person_id" integer,
	"lead_id" integer,
	"linked_by" varchar(16),
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_handles" PRIMARY KEY("id"),
	CONSTRAINT "uq_social_handles_platform_handle" UNIQUE("platform","handle"),
	CONSTRAINT "ck_social_handles_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[])),
	CONSTRAINT "ck_social_handles_linked_by" CHECK (("linked_by")::text = ANY ((ARRAY['reach_contact'::character varying, 'linkedin_url'::character varying, 'contact_point'::character varying, 'lead_person'::character varying, 'lead_social'::character varying, 'given'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "touches" (
	"id" serial NOT NULL,
	"handle_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"direction" varchar(8) NOT NULL,
	"account" varchar(120),
	"url" text,
	"text" text,
	"at" timestamp with time zone NOT NULL,
	"response" varchar(16),
	"response_at" timestamp with time zone,
	"answers" integer,
	"external_id" varchar(200),
	"source" varchar(32) NOT NULL,
	"ref" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_touches" PRIMARY KEY("id"),
	CONSTRAINT "uq_touches_ref" UNIQUE("ref"),
	CONSTRAINT "ck_touches_kind" CHECK (("kind")::text = ANY ((ARRAY['follow'::character varying, 'connect'::character varying, 'comment'::character varying, 'reply'::character varying, 'dm'::character varying, 'like'::character varying, 'mention'::character varying])::text[])),
	CONSTRAINT "ck_touches_direction" CHECK (("direction")::text = ANY ((ARRAY['ours'::character varying, 'theirs'::character varying])::text[])),
	CONSTRAINT "ck_touches_response" CHECK (("response")::text = ANY ((ARRAY['accepted'::character varying, 'replied'::character varying, 'liked'::character varying, 'ignored'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "social_handles" ADD CONSTRAINT "fk_social_handles_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_handles" ADD CONSTRAINT "fk_social_handles_lead_id_leads" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "fk_touches_handle_id_social_handles" FOREIGN KEY ("handle_id") REFERENCES "public"."social_handles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "fk_touches_answers_touches" FOREIGN KEY ("answers") REFERENCES "public"."touches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_social_handles_person_id" ON "social_handles" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_social_handles_lead_id" ON "social_handles" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ix_touches_handle_id_at" ON "touches" USING btree ("handle_id","at");--> statement-breakpoint
CREATE INDEX "ix_touches_answers" ON "touches" USING btree ("answers");--> statement-breakpoint
CREATE INDEX "ix_touches_external_id" ON "touches" USING btree ("external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE VIEW "public"."person_touch_lines" AS (
  with lines as (
    select t.id, t.at, h.person_id, h.platform, h.handle,
      case h.platform when 'linkedin' then 'LinkedIn' when 'x' then 'X'
        when 'instagram' then 'Instagram' when 'reddit' then 'Reddit' when 'youtube' then 'YouTube'
        when 'facebook' then 'Facebook' when 'tiktok' then 'TikTok' else h.platform end
        || ' ' || t.kind kind,
      case when t.direction = 'ours' then
        case t.kind when 'follow' then 'We followed them'
          when 'connect' then 'We sent an invite'
          when 'comment' then 'We commented on their post'
          when 'reply' then 'We replied to their comment'
          when 'dm' then 'We wrote to them'
          when 'like' then 'We liked their post'
          else 'We mentioned them' end
        || coalesce(' as ' || t.account, '')
      else
        case t.kind when 'follow' then 'They followed us'
          when 'connect' then 'They invited us'
          when 'comment' then 'They commented on our post'
          when 'reply' then 'They replied to us'
          when 'dm' then 'They wrote to us'
          when 'like' then 'They liked our post'
          else 'They mentioned us' end
      end
      || coalesce(': ' || nullif(left(regexp_replace(t.text, '\s+', ' ', 'g'), 200), ''), '')
      || case when t.direction <> 'ours' then ''
        when t.response is not null then ' · ' || initcap(t.response)
          || coalesce(' ' || to_char(t.response_at, 'YYYY-MM-DD'), '')
        when t.kind in ('comment', 'reply', 'dm', 'connect')
          and t.at < now() - interval '14 days' then ' · No answer'
        else '' end
      || coalesce(' · ' || t.url, '') what
    from touches t join social_handles h on h.id = t.handle_id
  )
  select 'li:' || person_id person, at, kind, what, id seq from lines where person_id is not null
  union all
  select platform || ':' || handle, at, kind, what, id from lines);
CREATE TABLE "comment_proofs" (
	"item" varchar(80) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"url" text,
	"shot" text,
	"note" text,
	"checked_at" timestamp with time zone,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_comment_proofs" PRIMARY KEY("item"),
	CONSTRAINT "ck_comment_proofs_state" CHECK (("state")::text = ANY ((ARRAY['live'::character varying, 'hidden'::character varying, 'missing'::character varying, 'pending'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."person_touch_lines";--> statement-breakpoint
CREATE INDEX "ix_comment_proofs_checked_at" ON "comment_proofs" USING btree ("checked_at");--> statement-breakpoint
CREATE VIEW "public"."person_touch_lines" AS (
  with lines as (
    select t.id, t.at, h.person_id, h.platform, h.handle,
      case h.platform when 'linkedin' then 'LinkedIn' when 'x' then 'X'
        when 'instagram' then 'Instagram' when 'reddit' then 'Reddit' when 'youtube' then 'YouTube'
        when 'facebook' then 'Facebook' when 'tiktok' then 'TikTok'
        when 'google_business' then 'Business Profile' else h.platform end
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
      -- Our sent comment's proof (comment_proofs): is it there for a stranger.
      || case p.state when 'live' then ' · Live' when 'hidden' then ' · Hidden'
        when 'missing' then ' · Missing' when 'pending' then ' · Checking' else '' end
      || coalesce(' · ' || t.url, '') what
    from touches t join social_handles h on h.id = t.handle_id
    left join comment_proofs p on t.direction = 'ours' and p.item = case
      when t.ref like 'rt:%' then 'thread:' || substr(t.ref, 4)
      when t.ref ~ '^rp:[0-9]+$' then 'onpost:' || substr(t.ref, 4)
      when t.ref like 'ca:%' then 'comment:' || substr(t.ref, 4) end
  )
  select 'li:' || person_id person, at, kind, what, id seq from lines where person_id is not null
  union all
  select platform || ':' || handle, at, kind, what, id from lines);
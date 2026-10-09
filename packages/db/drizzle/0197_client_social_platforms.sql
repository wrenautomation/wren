DROP VIEW "public"."person_touch_lines";--> statement-breakpoint
ALTER TABLE "social_handles" DROP CONSTRAINT "ck_social_handles_platform";--> statement-breakpoint
ALTER TABLE "account_metric_days" DROP CONSTRAINT "ck_account_metric_days_platform";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP CONSTRAINT "ck_content_drafts_platform";--> statement-breakpoint
ALTER TABLE "content_playbooks" DROP CONSTRAINT "ck_content_playbooks_platform";--> statement-breakpoint
ALTER TABLE "metric_sources" DROP CONSTRAINT "ck_metric_sources_platform";--> statement-breakpoint
ALTER TABLE "social_activity" DROP CONSTRAINT "ck_social_activity_platform";--> statement-breakpoint
ALTER TABLE "social_days" DROP CONSTRAINT "ck_social_days_platform";--> statement-breakpoint
ALTER TABLE "social_connections" DROP CONSTRAINT "ck_social_connections_platform";--> statement-breakpoint
ALTER TABLE "social_grants" DROP CONSTRAINT "ck_social_grants_platform";--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "ck_comments_platform";--> statement-breakpoint
ALTER TABLE "social_handles" ADD CONSTRAINT "ck_social_handles_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "account_metric_days" ADD CONSTRAINT "ck_account_metric_days_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "ck_content_drafts_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "content_playbooks" ADD CONSTRAINT "ck_content_playbooks_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "metric_sources" ADD CONSTRAINT "ck_metric_sources_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "social_activity" ADD CONSTRAINT "ck_social_activity_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "social_days" ADD CONSTRAINT "ck_social_days_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "ck_social_connections_platform" CHECK (("platform")::text = ANY ((ARRAY['facebook'::character varying, 'instagram'::character varying, 'linkedin'::character varying, 'linkedin_page'::character varying, 'youtube'::character varying, 'x'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "social_grants" ADD CONSTRAINT "ck_social_grants_platform" CHECK (("platform")::text = ANY ((ARRAY['facebook'::character varying, 'instagram'::character varying, 'linkedin'::character varying, 'linkedin_page'::character varying, 'youtube'::character varying, 'x'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));--> statement-breakpoint
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
      || coalesce(' · ' || t.url, '') what
    from touches t join social_handles h on h.id = t.handle_id
  )
  select 'li:' || person_id person, at, kind, what, id seq from lines where person_id is not null
  union all
  select platform || ':' || handle, at, kind, what, id from lines);
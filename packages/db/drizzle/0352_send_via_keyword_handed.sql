DROP VIEW "public"."comment_keyword_records";--> statement-breakpoint
DROP VIEW "public"."keyword_hit_records";--> statement-breakpoint
ALTER TABLE "keyword_hits" DROP CONSTRAINT "ck_keyword_hits_state";--> statement-breakpoint
ALTER TABLE "send_attempts" ADD COLUMN "via" varchar(12);--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD CONSTRAINT "ck_keyword_hits_state" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'handed'::character varying, 'sent'::character varying, 'failed'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "public"."comment_keyword_records" AS (
  select k.id::text as id, k.keyword, coalesce(k.platform, 'any') as platform,
    coalesce(k.post, 'every post') as post, k.dm, k.reply,
    case when k.active then 'on' else 'off' end as state,
    count(h.id)::int as caught,
    count(h.id) filter (where h.state = 'sent' or s.state = 'sent')::int as sent,
    count(h.id) filter (where h.state = 'failed' or (h.state = 'handed' and s.item is null))::int
      as failed,
    max(h.at) as last_at, k.updated_at, k.updated_by
  from comment_keywords k
  left join keyword_hits h on h.keyword_id = k.id
  left join send_attempts s on h.state = 'handed' and s.item = 'private:' || h.comment_id
  group by k.id);--> statement-breakpoint
CREATE VIEW "public"."keyword_hit_records" AS (
  select h.id::text as id, k.keyword, h.platform, h.author, c.body as comment,
    c.post_title as post, c.url,
    case when h.state = 'handed' then coalesce(s.state, 'not_sent') else h.state end as state,
    coalesce(s.why, h.why) as why, h.at, coalesce(s.sent_at, h.sent_at) as sent_at
  from keyword_hits h
  join comment_keywords k on k.id = h.keyword_id
  left join comments c on c.id = h.comment_id
  left join send_attempts s on h.state = 'handed' and s.item = 'private:' || h.comment_id);
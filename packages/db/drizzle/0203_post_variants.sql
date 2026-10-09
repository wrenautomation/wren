CREATE TABLE "post_variants" (
	"id" serial NOT NULL,
	"draft_id" uuid NOT NULL,
	"field" varchar(16) NOT NULL,
	"value" text NOT NULL,
	"state" varchar(16) NOT NULL,
	"source" varchar(16) NOT NULL,
	"why" text,
	"asked_by" varchar(200),
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" varchar(200),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "pk_post_variants" PRIMARY KEY("id"),
	CONSTRAINT "ck_post_variants_field" CHECK (("field")::text = ANY ((ARRAY['title'::character varying, 'thumbnail'::character varying, 'hook'::character varying])::text[])),
	CONSTRAINT "ck_post_variants_state" CHECK (("state")::text = ANY ((ARRAY['proposed'::character varying, 'live'::character varying, 'ended'::character varying, 'rejected'::character varying])::text[])),
	CONSTRAINT "ck_post_variants_source" CHECK (("source")::text = ANY ((ARRAY['publish'::character varying, 'swap'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."draft_activity";--> statement-breakpoint
DROP VIEW "public"."draft_outcomes";--> statement-breakpoint
DROP VIEW "public"."draft_people";--> statement-breakpoint
ALTER TABLE "post_variants" ADD CONSTRAINT "fk_post_variants_draft_id_content_drafts" FOREIGN KEY ("draft_id") REFERENCES "public"."content_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_post_variants_draft_id_field" ON "post_variants" USING btree ("draft_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_variants_live" ON "post_variants" USING btree ("draft_id","field") WHERE state = 'live';--> statement-breakpoint
CREATE VIEW "public"."draft_activity" AS (
  with lines as (
    select e.item, e.at, e.id seq, e.event kind,
      case e.event
        when 'generated' then case e.via when 'model' then 'Drafted by ' || coalesce(e.by, 'the model')
          else 'Written by ' || coalesce(e.by, 'Wren') end
        when 'edited' then case e.via when 'claude' then 'Claude rewrote it, asked by ' || coalesce(e.by, 'you')
          || coalesce(': ' || left(e.ask, 200), '')
          else 'Edited by ' || coalesce(e.by, 'a person') end
          || case when e.meta ? 'undo' then ' (undo)' when e.meta ? 'at_send' then ' at send' else '' end
        when 'approved' then 'Approved' || coalesce(' by ' || e.by, '')
          || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'scheduled' then 'Scheduled' || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'rejected' then 'Rejected' || coalesce(' by ' || e.by, '')
          || coalesce(': ' || case e.reason when 'voice' then 'Not my voice' when 'facts' then 'Wrong facts'
            when 'length' then 'Too long' when 'salesy' then 'Too salesy' when 'topic' then 'Off topic'
            when 'timing' then 'Bad timing' when 'repeat' then 'Said before' end, '')
          || coalesce(' · ' || e.note, '')
        when 'sent' then 'Sent' || coalesce(' · ' || e.url, '')
        else 'Failed' || coalesce(': ' || left(e.note, 200), '') end what
    from draft_events e
    union all
    select 'draft:' || d.id, m.as_of, null, 'metrics',
      concat_ws(' · ', m.views || ' views', m.reactions || ' reactions', m.comments || ' comments',
        m.shares || ' shares', m.follows || ' follows')
    from content_metrics m join content_drafts d on d.id = m.draft_id
    union all
    select 'draft:' || v.draft_id, v.started_at, null, 'variant',
      initcap(v.field) || ' swapped to: ' || left(v.value, 200)
    from post_variants v where v.source = 'swap' and v.started_at is not null
    union all
    select 'draft:' || d.id, c.at, null, 'reply', 'Reply from ' || c.author || ': ' || left(c.body, 200)
    from comments c join content_drafts d on d.published_id = c.post and d.platform::text = c.platform::text
    where c.sort is distinct from 'ours'
  )
  select l.item,
    case when l.item like 'draft:%' then split_part(l.item, ':', 2) end draft,
    case when l.item like 'draft:%' then concat_ws('/', d.idea_id, d.platform, d.id) end post,
    case when l.item like 'comment:%' then split_part(l.item, ':', 2) end comment,
    case when l.item like 'thread:%' then split_part(l.item, ':', 2) end thread,
    case when l.item like 'dm:%' or l.item like 'invite:%' or l.item like 'note:%'
      then split_part(l.item, ':', 2) end contact,
    case when l.item like 'video:%' then split_part(l.item, ':', 2) end video,
    l.at, l.seq, l.kind, l.what
  from lines l
  left join content_drafts d on l.item like 'draft:%' and d.id::text = split_part(l.item, ':', 2));--> statement-breakpoint
CREATE VIEW "public"."draft_outcomes" AS (
  select 'draft:' || d.id item, m.as_of measured, m.views, m.reactions, m.comments, m.shares,
    coalesce(m.follows, (select f.value::int from post_metric_days f where f.draft_id = d.id
      and f.metric = 'follows' and f.key = '' order by f.day desc limit 1)) follows,
    (select count(*)::int from content_metrics x where x.draft_id = d.id) snapshots,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.post = d.published_id
        and c.platform::text = d.platform::text and c.sort is distinct from 'ours'), '[]') replies
  from content_drafts d
  left join lateral (select * from content_metrics c where c.draft_id = d.id
    order by c.created_at desc, c.id desc limit 1) m on true
  where d.published_id is not null
  union all
  select 'comment:' || a.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.parent = a.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from comments a where a.answer_ref is not null
  union all
  select 'thread:' || t.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.parent = t.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from reddit_threads t where t.answer_ref is not null
  union all
  select k.prefix || r.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', coalesce(r.name, r.handle),
      'text', i.body, 'at', i.created_at) order by i.created_at, i.id) from reach_messages i
      where i.contact_id = r.id and i.direction = 'in'), '[]')
  from reach_contacts r cross join (values ('dm:'), ('invite:'), ('note:')) k(prefix)
  where exists (select 1 from reach_messages o where o.contact_id = r.id and o.direction = 'out'
    and o.state = 'sent'));--> statement-breakpoint
CREATE VIEW "public"."draft_people" AS (
  select 'comment:' || c.id item, c.author name from comments c
  union all
  select 'thread:' || t.id, t.author from reddit_threads t
  union all
  select k.prefix || r.id, n.name from reach_contacts r
  cross join (values ('dm:'), ('invite:'), ('note:')) k(prefix)
  cross join lateral (values (r.name), (r.handle)) n(name)
  where n.name is not null and n.name <> '');
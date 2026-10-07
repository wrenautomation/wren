CREATE TABLE "account_metric_days" (
	"platform" varchar(16) NOT NULL,
	"day" date NOT NULL,
	"metric" varchar(32) NOT NULL,
	"key" varchar(200) DEFAULT '' NOT NULL,
	"value" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_account_metric_days" PRIMARY KEY("platform","day","metric","key"),
	CONSTRAINT "ck_account_metric_days_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "content_digests" (
	"week" date NOT NULL,
	"platform" varchar(16) NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_content_digests" PRIMARY KEY("week","platform")
);
--> statement-breakpoint
CREATE TABLE "metric_sources" (
	"platform" varchar(16) NOT NULL,
	"metric" varchar(32) NOT NULL,
	"state" varchar(16) NOT NULL,
	"why" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live_at" timestamp with time zone,
	CONSTRAINT "pk_metric_sources" PRIMARY KEY("platform","metric"),
	CONSTRAINT "ck_metric_sources_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[])),
	CONSTRAINT "ck_metric_sources_state" CHECK (("state")::text = ANY ((ARRAY['live'::character varying, 'needs_scope'::character varying, 'needs_william'::character varying, 'not_built'::character varying, 'no_api'::character varying, 'error'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "post_metric_days" (
	"draft_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" varchar(32) NOT NULL,
	"key" varchar(200) DEFAULT '' NOT NULL,
	"value" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_post_metric_days" PRIMARY KEY("draft_id","day","metric","key")
);
--> statement-breakpoint
CREATE TABLE "link_days" (
	"day" date NOT NULL,
	"source" varchar(40) NOT NULL,
	"campaign" varchar(100) NOT NULL,
	"content" varchar(100) NOT NULL,
	"clicks" integer NOT NULL,
	"hops" integer NOT NULL,
	"forms_first" integer NOT NULL,
	"forms_last" integer NOT NULL,
	"calls_first" integer NOT NULL,
	"calls_last" integer NOT NULL,
	"won_first" integer NOT NULL,
	"won_last" integer NOT NULL,
	"revenue_first" integer NOT NULL,
	"revenue_last" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_link_days" PRIMARY KEY("day","source","campaign","content")
);
--> statement-breakpoint
DROP VIEW "public"."marketing_post_records";--> statement-breakpoint
ALTER TABLE "post_metric_days" ADD CONSTRAINT "fk_post_metric_days_draft_id_content_drafts" FOREIGN KEY ("draft_id") REFERENCES "public"."content_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_link_days_content" ON "link_days" USING btree ("content");--> statement-breakpoint
CREATE VIEW "public"."marketing_conversation" AS (
  with spans(span, since) as (values
    ('7d', now() - interval '7 days'), ('30d', now() - interval '30 days'),
    ('all', '-infinity'::timestamptz)),
  theirs as (
    select c.platform::text platform, c.at, c.state, c.answered_at, c.contact_id from comments c
    where c.sort is distinct from 'ours' and c.state <> 'dropped'),
  firsts as (
    select r.id contact, r.platform::text platform, r.person_id,
      min(m.sent_at) first_out from reach_contacts r
    join reach_messages m on m.contact_id = r.id and m.direction = 'out' and m.state = 'sent'
    group by r.id),
  threads as (
    select f.platform, f.first_out,
      exists (select 1 from reach_messages i where i.contact_id = f.contact and i.direction = 'in'
        and i.created_at > f.first_out) answered,
      exists (select 1 from leads ld join call_bookings b on lower(b.email) = lower(ld.email)
        where ld.person_id = f.person_id and b.booked_at > f.first_out) booked
    from firsts f),
  cs as (
    select s.span, case when grouping(t.platform) = 1 then 'all' else t.platform end platform,
      count(t.at)::int comments,
      count(t.answered_at)::int answered,
      (percentile_cont(0.5) within group (order by extract(epoch from t.answered_at - t.at))
        filter (where t.answered_at is not null))::float8 reply_secs,
      count(t.contact_id)::int dmed
    from spans s left join theirs t on t.at >= s.since
    group by grouping sets ((s.span, t.platform), (s.span))),
  ds as (
    select s.span, case when grouping(h.platform) = 1 then 'all' else h.platform end platform,
      count(h.first_out)::int dms, count(*) filter (where h.answered)::int dms_answered,
      count(*) filter (where h.booked)::int booked
    from spans s join threads h on h.first_out >= s.since
    group by grouping sets ((s.span, h.platform), (s.span)))
  select k.span || ':' || k.platform id, k.span, k.platform, s.since,
    coalesce(cs.comments, 0) comments, coalesce(cs.answered, 0) answered, cs.reply_secs,
    coalesce(cs.dmed, 0) dmed, coalesce(ds.dms, 0) dms,
    coalesce(ds.dms_answered, 0) dms_answered, coalesce(ds.booked, 0) booked
  from (select span, platform from cs where platform is not null
    union select span, platform from ds where platform is not null) k
  join spans s on s.span = k.span
  left join cs on cs.span = k.span and cs.platform = k.platform
  left join ds on ds.span = k.span and ds.platform = k.platform);--> statement-breakpoint
CREATE VIEW "public"."marketing_link_day_records" AS (
  select concat_ws('/', l.day, l.source, nullif(l.campaign, ''), nullif(l.content, '')) id, l.day,
    l.source::text source, nullif(l.campaign, '')::text campaign,
    nullif(l.content, '')::text "content", p.id post, p.title post_title, l.clicks, l.hops,
    l.forms_first, l.forms_last, l.calls_first, l.calls_last, l.won_first, l.won_last,
    l.revenue_first / 100.0 revenue_first, l.revenue_last / 100.0 revenue_last,
    'USD'::text currency,
    case when l.day > current_date - 7 then 'week'
      when l.day > current_date - 30 then 'month' else 'earlier' end age
  from link_days l
  left join lateral (select concat_ws('/', d.idea_id, d.platform, d.id) id,
      coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title
    from content_drafts d where l.content <> '' and left(d.id::text, 8) = l.content
    limit 1) p on true);--> statement-breakpoint
CREATE VIEW "public"."marketing_post_records" AS (
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, d.stage::text stage, case
      when d.platform = 'youtube' then case when d.extra->>'kind' = 'short' then 'short' else 'long' end
      when d.platform = 'tiktok' then 'video'
      when d.platform = 'instagram' and d.extra->>'kind' = 'video' then 'reel'
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      else 'post' end format,
    m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged,
    case when m.views > 0
      then round((m.reactions + m.comments + m.shares) * 100.0 / m.views, 2)::float8 end score,
    i.impressions, i.reach, i.ctr / 100 ctr, i.avg_view_pct / 100 avg_view_pct, i.avg_view_secs,
    i.hold, i.watch_minutes, i.saves, i.follows, i.link_clicks,
    coalesce(l.clicks, 0) clicks, coalesce(l.forms, 0) forms, coalesce(l.calls, 0) calls,
    coalesce(l.won, 0) won, coalesce(l.revenue_first, 0) / 100.0 revenue_first,
    coalesce(l.revenue_last, 0) / 100.0 revenue_last, 'USD'::text currency,
    coalesce(c.theirs, 0) theirs, coalesce(c.answered, 0) answered,
    m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  join content_ideas idea on idea.id = d.idea_id
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  left join lateral (
    select max(v.value) filter (where v.metric = 'impressions') impressions,
      max(v.value) filter (where v.metric = 'reach') reach,
      max(v.value) filter (where v.metric = 'ctr') ctr,
      max(v.value) filter (where v.metric = 'avg_view_pct') avg_view_pct,
      max(v.value) filter (where v.metric = 'avg_view_secs') avg_view_secs,
      max(v.value) filter (where v.metric = 'hold_30s') hold,
      max(v.value) filter (where v.metric = 'watch_minutes') watch_minutes,
      max(v.value) filter (where v.metric = 'saves') saves,
      max(v.value) filter (where v.metric = 'follows') follows,
      max(v.value) filter (where v.metric = 'link_clicks') link_clicks
    from (select distinct on (p.metric) p.metric, p.value from post_metric_days p
      where p.draft_id = d.id and p.key = '' order by p.metric, p.day desc) v) i on true
  left join lateral (
    select sum(k.clicks)::int clicks, sum(k.forms_first)::int forms, sum(k.calls_first)::int calls,
      sum(k.won_first)::int won, sum(k.revenue_first)::int revenue_first,
      sum(k.revenue_last)::int revenue_last
    from link_days k
    where k.content = left(d.id::text, 8)
      or (d.platform = 'youtube' and k.source = 'youtube' and k.content = ''
        and d.extra->>'kind' is distinct from 'short' and substring(idea.ref from '^video:([0-9]+)(~|$)') is not null
        and (k.campaign = substring(idea.ref from '^video:([0-9]+)(~|$)')
          or k.campaign like substring(idea.ref from '^video:([0-9]+)(~|$)') || '-%'))) l on true
  left join lateral (
    select count(*) filter (where o.sort is distinct from 'ours' and o.state <> 'dropped')::int theirs,
      count(*) filter (where o.sort is distinct from 'ours' and o.state = 'answered')::int answered
    from comments o where o.post = d.published_id and o.platform::text = d.platform::text) c on true
  where d.status = 'published');
CREATE TABLE "segment_versions" (
	"segment_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"rule" jsonb,
	"words" text,
	"by" varchar(320) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_segment_versions" PRIMARY KEY("segment_id","version")
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "segment_versions" ADD CONSTRAINT "fk_segment_versions_segment_id_segments" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE VIEW "public"."profile_steps" AS (
  select k.profile_id,
    case when s.kind = 'newsletter' or (s.kind = 'broadcast' and s.channel = 'email')
      then 'newsletter' else s.channel end channel,
    case when s.broadcast is not null then 'broadcast'
      when s.kind = 'newsletter' then 'list'
      when s.kind = 'comment' and s.channel = 'reddit' then 'thread'
      when s.kind = 'comment' then 'post'
      else 'campaign' end source_kind,
    coalesce(s.campaign, '') source, st.step, s.at, s.id ref,
    case when st.step = 'reached' then m.cost_usd end cost_usd,
    case when st.step = 'reached' then 1 else 0 end sends
  from sent_records s
  join profile_keys k on k.kind = s.key_kind and k.value = s.key_value
  left join sms_messages m
    on m.id = case when s.id ~ '^sms:[0-9]+$' then substr(s.id, 5)::int end
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where s.state in ('sent', 'delivered', 'opened', 'clicked', 'replied')
    and (st.step = 'reached'
      or (st.step = 'saw' and s.state in ('opened', 'clicked', 'replied'))
      or (st.step = 'engaged' and s.state in ('clicked', 'replied'))
      or (st.step = 'replied' and s.state = 'replied'))
  union all
  select k.profile_id, h.platform,
    case when t.kind = 'dm' then 'thread' when t.kind in ('follow', 'connect') then 'profile'
      else 'post' end,
    coalesce(t.url, ''), st.step,
    case when st.step = 'reached' or t.direction = 'theirs' then t.at
      else coalesce(t.response_at, t.at) end,
    'touch:' || t.id, null::float8, 0
  from touches t
  join social_handles h on h.id = t.handle_id
  join profile_keys k on k.kind = 'handle:' || h.platform and k.value = h.handle
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where st.step = 'reached'
    or (t.direction = 'theirs' and (st.step in ('saw', 'engaged')
      or (st.step = 'replied' and t.kind in ('reply', 'dm'))))
    or (t.direction = 'ours' and (
      (st.step in ('saw', 'engaged') and t.response in ('accepted', 'liked', 'replied'))
      or (st.step = 'replied' and t.response = 'replied')))
  union all
  select hit.profile_id,
    coalesce(case
    when lower(e.touch ->> 'source') in ('youtube', 'linkedin', 'instagram', 'tiktok', 'x', 'reddit', 'facebook', 'threads', 'sms') then lower(e.touch ->> 'source')
    when lower(e.touch ->> 'source') in ('twitter') then 'x'
    when lower(e.touch ->> 'source') in ('meta') then 'ads'
    when lower(e.touch ->> 'source') in ('recruiting', 'email') then 'email'
    when lower(e.touch ->> 'source') in ('google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave') then 'search'
    else null end,
      case when coalesce(e.touch ->> 'ref', '') <> '' then 'referral' else 'site' end),
    'link',
    concat_ws('/', nullif(e.touch ->> 'campaign', ''), nullif(e.touch ->> 'content', '')),
    st.step, e.at, 'site_form:' || e.id, null::float8, 0
  from (
    select e.id, k.profile_id from profile_keys k
      join site_forms e on lower(e.fields ->> 'email') = k.value where k.kind = 'email'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on e.visitor = k.value where k.kind = 'visitor'
  ) hit
  join site_forms e on e.id = hit.id
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  cross join lateral (values ('reached'), ('saw'), ('engaged'), ('replied')) st(step)
  where coalesce(f.client, p.client) is null
  union all
  select t.profile_id, lower(t.value #>> '{}'), 'trait', t.key, 'reached', t.at,
    'trait:' || t.profile_id || ':' || t.key, null::float8, 0
  from profile_traits t
  where t.key in ('source', 'channel')
    and lower(t.value #>> '{}') in ('email', 'sms', 'linkedin', 'x', 'reddit', 'youtube', 'tiktok', 'instagram', 'facebook', 'threads', 'newsletter', 'site', 'referral', 'search', 'ads')
  union all
  select l.profile_id, null, 'outcome', '', 'booked', l.at, l.id, null::float8, 0
  from profile_timeline l
  where l.kind = 'booking' and l.summary not like 'Cancelled%'
  union all
  select l.profile_id, null, 'outcome', '', 'paid', l.at, l.id, null::float8, 0
  from profile_timeline l
  where l.kind = 'payment' and l.summary like 'Paid %');--> statement-breakpoint
-- Hand added: each segment saved before versions counts as its version 1.
INSERT INTO "segment_versions" ("segment_id", "version", "name", "kind", "rule", "words", "by", "at")
  SELECT "id", 1, "name", "kind", "rule", "words", "by", "updated_at" FROM "segments";

DROP VIEW "public"."person_touch_lines";--> statement-breakpoint
DROP VIEW "public"."research_signals";--> statement-breakpoint
DROP VIEW "public"."done_records";--> statement-breakpoint
DROP VIEW "public"."draft_activity";--> statement-breakpoint
DROP VIEW "public"."marketing_draft_records";--> statement-breakpoint
DROP VIEW "public"."marketing_post_records";--> statement-breakpoint
DROP VIEW "public"."marketing_link_day_records";--> statement-breakpoint
DROP VIEW "public"."profile_steps";--> statement-breakpoint
DROP VIEW "public"."profile_timeline";--> statement-breakpoint
DROP VIEW "public"."site_entry_records";--> statement-breakpoint
DROP VIEW "public"."site_form_records";--> statement-breakpoint
DROP VIEW "public"."site_funnel_records";--> statement-breakpoint
DROP VIEW "public"."site_link_records";--> statement-breakpoint
DROP VIEW "public"."site_page_records";--> statement-breakpoint
ALTER TABLE "message_settings" ALTER COLUMN "postal" SET DATA TYPE varchar(1000);--> statement-breakpoint
ALTER TABLE "snippets" ALTER COLUMN "title" SET DATA TYPE varchar(500);--> statement-breakpoint
ALTER TABLE "workflow_templates" ALTER COLUMN "name" SET DATA TYPE varchar(1200);--> statement-breakpoint
ALTER TABLE "custom_fields" ALTER COLUMN "label" SET DATA TYPE varchar(800);--> statement-breakpoint
ALTER TABLE "custom_values" ALTER COLUMN "label" SET DATA TYPE varchar(800);--> statement-breakpoint
ALTER TABLE "custom_values" ALTER COLUMN "value" SET DATA TYPE varchar(20000);--> statement-breakpoint
ALTER TABLE "chat_threads" ALTER COLUMN "name" SET DATA TYPE varchar(1200);--> statement-breakpoint
ALTER TABLE "content_drafts" ALTER COLUMN "title" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "ad_launches" ALTER COLUMN "stop_reason" SET DATA TYPE varchar(3000);--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "name" SET DATA TYPE varchar(1200);--> statement-breakpoint
ALTER TABLE "note_comments" ALTER COLUMN "quote" SET DATA TYPE varchar(5000);--> statement-breakpoint
ALTER TABLE "note_comments" ALTER COLUMN "quote" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "note_links" ALTER COLUMN "label" SET DATA TYPE varchar(3000);--> statement-breakpoint
ALTER TABLE "note_links" ALTER COLUMN "label" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "note_versions" ALTER COLUMN "name" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "note_versions" ALTER COLUMN "title" SET DATA TYPE varchar(3000);--> statement-breakpoint
ALTER TABLE "note_versions" ALTER COLUMN "title" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "title" SET DATA TYPE varchar(3000);--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (title)::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char")) STORED;--> statement-breakpoint
CREATE INDEX "ix_notes_search" ON "notes" USING gin ("search");--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "title" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "task_moves" ALTER COLUMN "why" SET DATA TYPE varchar(3000);--> statement-breakpoint
ALTER TABLE "site_form_defs" ALTER COLUMN "name" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "site_links" ALTER COLUMN "name" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "site_pages" ALTER COLUMN "title" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "site_pages" ALTER COLUMN "angle" SET DATA TYPE varchar(1200);--> statement-breakpoint
ALTER TABLE "doc_templates" ALTER COLUMN "name" SET DATA TYPE varchar(1200);--> statement-breakpoint
ALTER TABLE "docs" ALTER COLUMN "title" SET DATA TYPE varchar(2000);--> statement-breakpoint
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
      || coalesce(': ' || nullif(left(regexp_replace(t.text, '\s+', ' ', 'g'), 2000), ''), '')
      || case when t.direction <> 'ours' then ''
        when t.response is not null then ' · ' || initcap(t.response)
          || coalesce(' ' || to_char(t.response_at, 'YYYY-MM-DD'), '')
        when t.kind in ('comment', 'reply', 'dm', 'connect')
          and t.at < now() - interval '14 days' then ' · No answer'
        else '' end
      -- Our sent comment's proof (comment_proofs): is it there for a stranger.
      || case p.state when 'live' then ' · Live' when 'hidden' then ' · Hidden'
        when 'missing' then ' · Missing' when 'pending' then ' · Checking' else '' end
      what,
      t.link, case when t.url ~ '^https://www\.instagram\.com/(p|reel|tv)/[0-9]+/?$' then null else nullif(t.url, '') end url
    from touches t join social_handles h on h.id = t.handle_id
    left join comment_proofs p on t.direction = 'ours' and p.item = case
      when t.ref like 'rt:%' then 'thread:' || substr(t.ref, 4)
      when t.ref ~ '^rp:[0-9]+$' then 'onpost:' || substr(t.ref, 4)
      when t.ref like 'ca:%' then 'comment:' || substr(t.ref, 4) end
  )
  select 'li:' || person_id person, at, kind, what, id seq, link, url context
    from lines where person_id is not null
  union all
  select platform || ':' || handle, at, kind, what, id, link, url from lines);--> statement-breakpoint
CREATE VIEW "public"."research_signals" AS (
  select f.id, f.kind,
    coalesce(f.value ->> 'topic', f.value ->> 'event', f.value ->> 'site', replace(f.kind, '_', ' ')) topic,
    coalesce(f.company_id, p.company_id) company_id, f.person_id,
    coalesce(p.full_name, co.name, co.domain) subject,
    coalesce(f.value ->> 'title', left(coalesce(f.value ->> 'caption', f.value ->> 'text'), 2000),
      case f.kind when 'hiring' then (f.value ->> 'count') || ' open roles'
        when 'job_change' then concat_ws(' at ', f.value ->> 'title', f.value ->> 'to') end) title,
    f.source_url url, f.signal_at "at", f.signal_dated dated, f.via, f.confidence, f.document_id,
    f.created_at first_seen, f.observed_at seen,
    case when f.signal_at > now() - interval '30 days' then 'fresh' else 'older' end age
  from findings f
  left join people p on p.id = f.person_id
  left join companies co on co.id = coalesce(f.company_id, p.company_id)
  where f.signal_at is not null);--> statement-breakpoint
CREATE VIEW "public"."done_records" AS (
  select e.id, e.item, e.kind, e.platform, e.event, e.via, e.by,
    coalesce(nullif(e.title, ''), left(regexp_replace(e.text, '[[:space:]]+', ' ', 'g'), 1400), e.item) what,
    e.text words, e.note, e.url,
    case split_part(e.item, ':', 1)
      when 'draft' then '/marketing/drafts/' when 'comment' then '/marketing/comments/'
      when 'thread' then '/marketing/threads/' when 'video' then '/marketing/videos/'
      when 'dm' then '/marketing/dms/' when 'invite' then '/marketing/dms/'
      when 'note' then '/marketing/dms/' end || split_part(e.item, ':', 2) as open,
    e.at,
    case when e.at >= (date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York') then 'today'
      when e.at >= now() - interval '7 days' then 'week' else 'older' end as day
  from draft_events e
  where e.via in ('person', 'claude') or e.event in ('scheduled', 'sent', 'failed'));--> statement-breakpoint
CREATE VIEW "public"."draft_activity" AS (
  with lines as (
    select e.item, e.at, e.id seq, e.event kind,
      case e.event
        when 'generated' then case e.via when 'model' then 'Drafted by ' || coalesce(e.by, 'the model')
          else 'Written by ' || coalesce(e.by, 'Wren') end
        when 'edited' then case e.via when 'claude' then 'Claude rewrote it, asked by ' || coalesce(e.by, 'you')
          || coalesce(': ' || left(e.ask, 2000), '')
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
        else 'Failed' || coalesce(': ' || left(e.note, 2000), '') end what
    from draft_events e
    union all
    select 'draft:' || d.id, m.as_of, null, 'metrics',
      concat_ws(' · ', m.views || ' views', m.reactions || ' reactions', m.comments || ' comments',
        m.shares || ' shares', m.follows || ' follows')
    from content_metrics m join content_drafts d on d.id = m.draft_id
    union all
    select 'draft:' || v.draft_id, v.started_at, null, 'variant',
      initcap(v.field) || ' swapped to: ' || left(v.value, 2000)
    from post_variants v where v.source = 'swap' and v.started_at is not null
    union all
    select 'draft:' || d.id, c.at, null, 'reply', 'Reply from ' || c.author || ': ' || left(c.body, 2000)
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
CREATE VIEW "public"."marketing_draft_records" AS (
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 1200))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.stage::text stage, d.points_to::text "to",
    case
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      else 'post' end format,
    case
      when d.platform = 'tiktok' and coalesce(d.extra->>'privacy', '') = '' then 'privacy'
      when d.platform = 'tiktok' and d.extra->>'disclose' = 'true'
        and coalesce(d.extra->>'yourBrand', '') <> 'true'
        and coalesce(d.extra->>'brandedContent', '') <> 'true' then 'disclosure'
      end missing,
    d.scheduled_for scheduled, d.created_at created,
    coalesce(d.scheduled_for, d.created_at) due,
    left(md5(d.text), 12) version,
    -- The login a person picked to post it as; null = the platform's default.
    (select a.account from draft_accounts a where a.item = 'draft:' || d.id::text)::text account
  from content_drafts d
  where d.status <> 'published');--> statement-breakpoint
CREATE VIEW "public"."marketing_post_records" AS (
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 1200))::text title,
    d.published_at published, d.stage::text stage, case
      when d.platform = 'youtube' then case d.extra->>'kind' when 'short' then 'short'
        when 'community' then 'post' else 'long' end
      when d.platform = 'tiktok' then 'video'
      when d.platform in ('instagram', 'facebook') and d.extra->>'kind' = 'story' then 'story'
      when d.platform = 'instagram' and d.extra->>'kind' = 'video' then 'reel'
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      when d.platform = 'facebook' and d.media->>'kind' = 'video' then 'reel'
      when d.platform in ('x', 'linkedin') and d.media->>'kind' = 'video' then 'video'
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
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent,
    (select a.account from draft_accounts a where a.item = 'draft:' || d.id::text)::text account
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
  where d.status = 'published');--> statement-breakpoint
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
      coalesce(d.title, left(split_part(d.text, chr(10), 1), 1200))::text title
    from content_drafts d join content_ideas idea on idea.id = d.idea_id
    where (l.content <> '' and left(d.id::text, 8) = l.content)
      or (l.content = '' and l.source = 'youtube' and d.platform = 'youtube'
        and d.status = 'published' and d.extra->>'kind' is distinct from 'short'
        and substring(idea.ref from '^video:([0-9]+)(~|$)') is not null
        and (l.campaign = substring(idea.ref from '^video:([0-9]+)(~|$)')
          or l.campaign like substring(idea.ref from '^video:([0-9]+)(~|$)') || '-%'))
    order by d.published_at desc nulls last limit 1) p on true);--> statement-breakpoint
CREATE VIEW "public"."profile_timeline" AS (
  select lines.id, lines.profile_id, lines.at, lines.kind, lines.channel,
  lines.summary, lines.body, lines.link, lines.source,
  coalesce(p.name, '#' || p.id) who, '/people/people/' || p.id profile_link, lines.context,
  case when lines.source = 'touches' and lines.link is null then 'No link for this one' end note from (
  select 'message:' || m.id id, k.profile_id, coalesce(m.sent_at, m.created_at) at,
    'email_sent' kind, 'email' channel, coalesce(nullif(m.subject, ''), '(no subject)') summary,
    m.body, null::text link, 'messages' source, null::text context
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join messages m on m.enrollment_id = e.id
  where k.kind = 'email' and m.sent_at is not null
  union all
  select 'thread_event:' || t.id, k.profile_id, t.received_at, 'email_received', 'email',
    replace(t.kind, '_', ' ') || ': ' || coalesce(nullif(t.subject, ''), t.snippet, ''),
    coalesce(t.body_text, t.snippet), null, 'thread_events', null
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join thread_events t on t.enrollment_id = e.id
  where k.kind = 'email' and t.kind <> 'note'
  union all
  select 'sms_message:' || s.id, k.profile_id, coalesce(s.received_at, s.sent_at, s.created_at),
    case when s.direction = 'in' then 'text_received' else 'text_sent' end, 'sms',
    s.body, s.body, '/marketing/texts/' || c.id, 'sms_messages', null
  from profile_keys k
  join sms_contacts c on c.e164 = k.value
  join sms_messages s on s.contact_id = c.id
  where k.kind = 'phone' and (s.direction = 'in' or s.sent_at is not null)
  union all
  select 'sms_call:' || x.id, k.profile_id, x.started_at, 'call_in', 'phone',
    'Called in: ' || coalesce(x.result, 'ringing'), x.text_back_detail,
    case when x.contact_id is not null then '/marketing/texts/' || x.contact_id end, 'sms_calls', null
  from profile_keys k
  join sms_calls x on x.from_e164 = k.value
  where k.kind = 'phone'
  union all
  select 'voice_call:' || v.id, k.profile_id, v.started_at, 'voice_call', 'phone',
    v.direction || ' call: ' || v.outcome, v.message, '/voice/calls/' || v.id, 'voice_calls', null
  from profile_keys k
  join voice_calls v on k.value in (v.from_number, v.to_number)
  where k.kind = 'phone'
  union all
  select 'call:' || c.id, k.profile_id, c.called_at, 'call', 'phone', 'Called by ' || c.called_by,
    null, '/reactivation/people/' || c.person_id, 'calls', null
  from profile_keys k
  join calls c on c.person_id::text = k.value
  where k.kind = 'person'
  union all
  select 'touch:' || t.id, k.profile_id, t.at, 'touch', h.platform,
    case t.direction when 'ours' then 'We ' else 'They ' end || t.kind
      || coalesce(': ' || t.text, ''),
    t.text, t.link, 'touches', nullif(case when t.url ~ '^https://www\.instagram\.com/(p|reel|tv)/[0-9]+/?$' then null else t.url end, '')
  from profile_keys k
  join social_handles h on k.kind = 'handle:' || h.platform and h.handle = k.value
  join touches t on t.handle_id = h.id
  where k.kind like 'handle:%'
  union all
  select 'consent_event:' || ce.id, k.profile_id, ce.created_at, 'consent', c.channel,
    tp.public_name || ': ' || ce.kind || ' (' || ce.by || ')', ce.evidence::text, null,
    'consent_events', null
  from profile_keys k
  join consents c on c.address = k.value
    and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
  join topics tp on tp.id = c.topic_id
  join consent_events ce on ce.consent_id = c.id
  where k.kind in ('email', 'phone')
  union all
  select 'site_form:' || e.id, hit.profile_id, e.at, 'form', 'site',
    coalesce(f.name, p.title, 'A form') || ' sent',
    concat_ws(chr(10) || chr(10),
      (select string_agg(a || ': ' || b, chr(10) order by a) from jsonb_each_text(e.fields) x(a, b)),
      'Pages seen first: '
        || (select string_agg(v ->> 'path', ', ' order by n) from jsonb_array_elements(e.pages)
          with ordinality y(v, n))),
    '/sites/submissions/' || e.id, 'site_forms', null
  from (
    select e.id, k.profile_id from profile_keys k
      join site_forms e on lower(e.fields ->> 'email') = k.value where k.kind = 'email'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on k.value in (e.fields ->> 'phone',
        '+' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'),
        '+1' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'))
      where k.kind = 'phone'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on e.visitor = k.value where k.kind = 'visitor'
  ) hit
  join site_forms e on e.id = hit.id
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  where coalesce(f.client, p.client) is null
  union all
  select 'chat_message:' || m.id, k.profile_id, m.at, 'chat', 'site',
    case when m.direction = 'in' then 'They wrote: ' else 'We wrote: ' end || m.body,
    m.body, null, 'chat_messages', null
  from (
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on lower(t.email) = k.value where k.kind = 'email'
    union
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on k.value in (t.phone, '+' || t.phone, '+1' || t.phone)
      where k.kind = 'phone'
  ) k
  join chat_messages m on m.thread_id = k.id
  union all
  select 'booking:' || b.id, k.profile_id, b.created_at, 'booking', 'calendar',
    case when b.state = 'cancelled' then 'Cancelled the call on ' else 'Booked a call for ' end
      || to_char(b.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
    b.reason, '/calendar/calls/' || b.id, 'bookings', null
  from profile_keys k
  join calendar.bookings b on lower(b.email) = k.value
  where k.kind = 'email'
  union all
  select 'call_booking:' || cb.id, k.profile_id, coalesce(cb.booked_at, cb.start), 'booking',
    'calendar', 'Booked a call' || coalesce(' for '
      || to_char(cb.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', ''),
    cb.outcome, '/calls/calls/' || cb.id, 'call_bookings', null
  from profile_keys k
  join call_bookings cb on lower(cb.email) = k.value
  where k.kind = 'email' and cb.uid not like 'wren-%'
  union all
  -- Text like every other branch: a varchar here also stops a kind filter reaching the branches.
  select 'profile_event:' || pe.id, pe.profile_id, pe.at, pe.kind::text, pe.channel::text,
    pe.summary, pe.body, pe.link, pe.source::text, null
  from profile_events pe
  union all
  -- DISTINCT ON sits one level down: at a branch's top it stops Postgres pushing a reader's
  -- kind filter into every branch, and each read built all of them (282k rows, 2026-10-16).
  select 'event:' || x.id, x.profile_id, x.at, 'workflow', 'workflow', 'Entered ' || x.workflow,
    x.subject, null, 'events', null
  from (
    select distinct on (ev.workflow, ev.subject, w.profile_id) ev.id, w.profile_id, ev.at,
      ev.workflow, ev.subject
    from (
      select k.profile_id, 'lead:email:' || e.id subject from profile_keys k
        join enrollments e on lower(e.to_email) = k.value where k.kind = 'email'
      union all
      select k.profile_id, 'lead:sms:' || c.id from profile_keys k
        join sms_contacts c on c.e164 = k.value where k.kind = 'phone'
    ) w
    join events ev on ev.subject = w.subject
  ) x
  union all
  select 'trait_event:' || te.id, te.profile_id, te.at, 'trait', 'profile',
    te.key || ': ' || coalesce(te.old::text, 'none') || ' to ' || te.new::text, null, null,
    'profile_trait_events', null
  from profile_trait_events te
  union all
  select 'merge:' || pm.id, pm.into_id, pm.at, 'merge', 'profile',
    'Profile #' || pm.from_id || ' merged in by ' || pm.by, null, null, 'profile_merges', null
  from profile_merges pm
  ) lines
  join profiles p on p.id = lines.profile_id);--> statement-breakpoint
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
CREATE VIEW "public"."site_entry_records" AS (
  select e.id::text id, e.form::text form, f.name::text form_name, e.page::text page,
    p.title::text page_title, coalesce(f.client, p.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name, e.at,
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
  left join site_pages p on p.id = e.page
  left join clients c on c.id = coalesce(f.client, p.client));--> statement-breakpoint
CREATE VIEW "public"."site_form_records" AS (
  with ev as (
    select form, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'start')::int starts,
      count(*) filter (where name = 'form')::int submits,
      max(at) filter (where name = 'form') last
    from site_events where form is not null group by form)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
  select f.id::text id, f.name::text, f.slug::text, coalesce(f.client, 'wren')::text owner,
    f.status::text,
    case when f.client is null then 'https://wrenautomation.com/o/f/' || f.slug
      else (select 'https://' || d.hostname || '/o/f/' || f.slug from client_domains d
        where d.client_id = f.client and d.status = 'active' order by d.created_at limit 1) end url,
    jsonb_array_length(f.spec -> 'fields')::int fields,
    coalesce(ev.views, 0) views, coalesce(ev.starts, 0) starts, coalesce(ev.submits, 0) submits,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.submits, 0)::float8 / ev.views end conversion,
    ev.last, f.updated_at changed, f.updated_by changed_by
  from site_form_defs f left join ev on ev.form = f.id) u
  left join clients c on c.id = u.owner);--> statement-breakpoint
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
CREATE VIEW "public"."site_link_records" AS (
  select l.id::text id, coalesce(l.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name,
    coalesce(l.name, concat_ws(' / ', l.link, l.campaign, l.content))::text name,
    l.page::text page, p.title::text page_title, p.slug::text, l.link::text, l.source::text,
    l.medium::text, l.channel::text, l.campaign::text, l.content::text, h.host,
    'https://' || h.host || '/go/' || l.link || '/' || l.campaign
      || coalesce('/' || l.content, '') || '?to=/o/' || p.slug url,
    k.clicks, coalesce(e.visits, 0) visits, coalesce(e.forms, 0) forms, coalesce(e.books, 0) books,
    greatest(e.last, k.last) last, l.created_at created, l.created_by::text created_by
  from site_links l
  join site_pages p on p.id = l.page
  left join clients c on c.id = l.client
  left join lateral (select case when l.client is null then 'wrenautomation.com'
      else (select d.hostname from client_domains d where d.client_id = l.client
        and d.status = 'active' order by d.created_at limit 1) end::text host) h on true
  left join lateral (
    select count(distinct x.view) filter (where x.name = 'view')::int visits,
      count(*) filter (where x.name = 'form')::int forms,
      count(distinct x.view) filter (where x.name = 'book')::int books, max(x.at) last
    from site_events x
    where (x.page = l.page or x.split in (select s.id from site_splits s where s.page = l.page))
      and x.source = l.source and x.medium = l.medium and x.campaign = l.campaign
      and coalesce(x.content, '') = coalesce(l.content, '')) e on true
  left join lateral (
    select count(*)::int clicks, max(y.at) last
    from site_hops y
    where y.client is not distinct from l.client and y.page = l.page and y.link = l.link
      and y.campaign = l.campaign and coalesce(y.content, '') = coalesce(l.content, '')) k on true);--> statement-breakpoint
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
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
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
      where s.page = p.id and s.state in ('running', 'shipping')) split,
    case when p.retire_at is not null then 'retire'
      when p.waiting_version is not null then 'publish' end asked
  from site_pages p
  left join ev on ev.page = p.id
  left join ads on ads.page = p.id
  union all
  select 'video:' || (e.output ->> 'id'), coalesce(e.output ->> 'firm', 'Demo video'),
    e.output ->> 'url', 'demo', 'derived', 'wren', 'live', null, null, null, null, 'trust', null,
    null, null, null, null, null, null, null, null, null, null, e.created_at, null, null, null,
    null
  from enrichments e where e.kind = 'video' and e.output ? 'url' and e.output ? 'id'
  union all
  select 'host:' || d.hostname, d.hostname, 'https://' || d.hostname, 'portal', 'derived',
    d.client_id, case when d.status = 'active' then 'live' else 'draft' end, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, d.checked_at,
    d.added_by, null, null, null
  from client_domains d
  union all
  select 'book:' || d.hostname, 'Booking on ' || d.hostname, 'https://' || d.hostname || '/book',
    'booking', 'derived', d.client_id, case when d.status = 'active' then 'live' else 'draft' end,
    null, null, null, null, 'convert', null, null, null, null, null, null, null, null, null, null,
    null, d.checked_at, d.added_by, null, null, null
  from client_domains d) u
  left join clients c on c.id = u.owner);

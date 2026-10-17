DROP VIEW "public"."profile_steps";--> statement-breakpoint
DROP VIEW "public"."person_touch_lines";--> statement-breakpoint
DROP VIEW "public"."profile_timeline";--> statement-breakpoint
DROP VIEW "public"."llm_usage_by_month";--> statement-breakpoint
DROP VIEW "public"."email_model_records";--> statement-breakpoint
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
    left(s.body, 160), s.body, '/marketing/texts/' || c.id, 'sms_messages', null
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
      || coalesce(': ' || left(t.text, 140), ''),
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
    case when m.direction = 'in' then 'They wrote: ' else 'We wrote: ' end || left(m.body, 140),
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
CREATE VIEW "public"."llm_usage_by_month" AS (SELECT date_trunc('month'::text, c.created_at)::date AS month, c.kind::text AS kind, c.model::text AS model, c.provider::text AS provider, count(*) AS calls, sum(c.input_tokens) AS input_tokens, sum(c.output_tokens) AS output_tokens, count(*) FILTER (WHERE c.rejected) AS rejected_calls, count(*) FILTER (WHERE c.parse_failed) AS parse_failures, 0::float8 AS usd FROM email_llm_calls c GROUP BY (date_trunc('month'::text, c.created_at)::date), c.kind, c.model, c.provider UNION ALL SELECT date_trunc('month'::text, d.at)::date, 'decide:' || d.kind, d.model::text, d.backend::text, count(*), sum(d.input_tokens), sum(d.output_tokens), count(*) FILTER (WHERE d.error IS NOT NULL), 0, sum(d.cost_usd) FROM decisions d GROUP BY (date_trunc('month'::text, d.at)::date), d.kind, d.model, d.backend);--> statement-breakpoint
CREATE VIEW "public"."email_model_records" AS (
  select concat_ws('/', month, kind, model, provider) id, *, case when month = date_trunc('month', current_date)::date then 'this_month'
    when month = (date_trunc('month', current_date) - interval '1 month')::date then 'last_month'
    else 'earlier' end age, 'USD'::text currency
  from (
    select date_trunc('month', c.created_at)::date "month", c.kind::text kind,
      c.model::text model, c.provider::text provider, count(*) calls,
      sum(c.input_tokens)::bigint input_tokens, sum(c.output_tokens)::bigint output_tokens,
      count(*) filter (where c.rejected) rejected_calls,
      count(*) filter (where c.parse_failed) parse_failures, 0::float8 usd
    from email_llm_calls c group by 1, 2, 3, 4
    union all
    select date_trunc('month', d.at)::date, 'decide:' || d.kind, d.model::text,
      d.backend::text, count(*), sum(d.input_tokens)::bigint, sum(d.output_tokens)::bigint,
      count(*) filter (where d.error is not null), 0, sum(d.cost_usd)::float8
    from decisions d group by 1, 2, 3, 4) u);--> statement-breakpoint
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
  where l.kind = 'payment' and l.summary like 'Paid %');

DROP VIEW "public"."marketing_conversation";--> statement-breakpoint
DROP VIEW "public"."marketing_link_day_records";--> statement-breakpoint
CREATE VIEW "public"."marketing_conversation" AS (
  with spans(span, since) as (values
    ('7d', now() - interval '7 days'), ('30d', now() - interval '30 days'),
    ('all', '-infinity'::timestamptz)),
  theirs as (
    select c.platform::text platform, c.at, c.state, c.answered_at,
      c.contact_id is not null
        or exists (select 1 from reach_contacts r
          join reach_messages m on m.contact_id = r.id and m.direction = 'out' and m.state = 'sent'
          where r.platform::text = c.platform::text and m.sent_at > c.at
            and (lower(r.handle) = lower(c.author) or r.profile->>'id' = c.author))
        or exists (select 1 from social_handles h
          join touches t on t.handle_id = h.id and t.kind = 'dm' and t.direction = 'ours'
          where h.platform = c.platform::text and lower(h.handle) = lower(c.author)
            and t.at > c.at) dmed
    from comments c
    where c.sort is distinct from 'ours' and c.state <> 'dropped'),
  firsts as (
    select r.id contact, r.platform::text platform, r.handle, r.person_id,
      min(m.sent_at) first_out from reach_contacts r
    join reach_messages m on m.contact_id = r.id and m.direction = 'out' and m.state = 'sent'
    group by r.id),
  threads as (
    select f.platform, f.first_out,
      exists (select 1 from reach_messages i where i.contact_id = f.contact and i.direction = 'in'
        and i.created_at > f.first_out) answered,
      exists (select 1 from leads ld join call_bookings b on lower(b.email) = lower(ld.email)
        where b.booked_at > f.first_out
          and (ld.person_id = f.person_id
            or exists (select 1 from social_handles h
              where h.platform = f.platform and lower(h.handle) = lower(f.handle)
                and (h.lead_id = ld.id or h.person_id = ld.person_id)))) booked
    from firsts f),
  cs as (
    select s.span, case when grouping(t.platform) = 1 then 'all' else t.platform end platform,
      count(t.at)::int comments,
      count(t.answered_at)::int answered,
      (percentile_cont(0.5) within group (order by extract(epoch from t.answered_at - t.at))
        filter (where t.answered_at is not null))::float8 reply_secs,
      count(*) filter (where t.dmed)::int dmed
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
    from content_drafts d join content_ideas idea on idea.id = d.idea_id
    where (l.content <> '' and left(d.id::text, 8) = l.content)
      or (l.content = '' and l.source = 'youtube' and d.platform = 'youtube'
        and d.status = 'published' and d.extra->>'kind' is distinct from 'short'
        and substring(idea.ref from '^video:([0-9]+)(~|$)') is not null
        and (l.campaign = substring(idea.ref from '^video:([0-9]+)(~|$)')
          or l.campaign like substring(idea.ref from '^video:([0-9]+)(~|$)') || '-%'))
    order by d.published_at desc nulls last limit 1) p on true);
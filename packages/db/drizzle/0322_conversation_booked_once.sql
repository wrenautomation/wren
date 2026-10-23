DROP VIEW "public"."marketing_conversation";--> statement-breakpoint
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
  booked as materialized (
    select b.booked_at, ld.id lead_id, ld.person_id
    from call_bookings b join leads ld on lower(ld.email) = lower(b.email)),
  threads as (
    select f.platform, f.first_out,
      exists (select 1 from reach_messages i where i.contact_id = f.contact and i.direction = 'in'
        and i.created_at > f.first_out) answered,
      exists (select 1 from booked b
        where b.booked_at > f.first_out
          and (b.person_id = f.person_id
            or exists (select 1 from social_handles h
              where h.platform = f.platform and lower(h.handle) = lower(f.handle)
                and (h.lead_id = b.lead_id or h.person_id = b.person_id)))) booked
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
  left join ds on ds.span = k.span and ds.platform = k.platform);
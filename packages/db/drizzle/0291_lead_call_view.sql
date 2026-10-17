DROP VIEW "public"."profile_records";--> statement-breakpoint
CREATE VIEW "public"."profile_records" AS (
  select p.id, coalesce(p.name, (select k.value from profile_keys k where k.profile_id = p.id
      order by k.kind <> 'email', k.kind <> 'phone', k.id limit 1), '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    (select string_agg(substr(k.kind, 8) || ' ' || k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind like 'handle:%') handles,
    (select string_agg(distinct case when k.kind = 'phone' then 'sms'
        when k.kind like 'handle:%' then substr(k.kind, 8) else k.kind end, ', ')
      from profile_keys k where k.profile_id = p.id and (k.kind in ('email', 'phone')
        or k.kind like 'handle:%')) channels,
    (select string_agg(distinct x.said, ', ') from (
      select c.channel || ' ' || c.state said from profile_keys k
        join consents c on c.address = k.value
          and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
        where k.profile_id = p.id and k.kind in ('email', 'phone')
      union all
      select 'sms opted out' from profile_keys k join sms_contacts s on s.e164 = k.value
        where k.profile_id = p.id and k.kind = 'phone' and s.state = 'opted_out') x) consent,
    p.first_seen, p.last_seen,
    (select count(*)::int from profile_keys k where k.profile_id = p.id) keys,
    (select count(*)::int from profile_traits t where t.profile_id = p.id) traits,
    (select count(*)::int from profile_merges m where m.into_id = p.id) merged,
    coalesce(r.stage, 'stranger') stage, coalesce(r.warmth, 'cold') warmth, r.why, r.warmth_line,
    r.warm_since, coalesce(r.persona, 'unknown') persona,
    coalesce(r.persona_role, 'unknown') persona_role,
    coalesce(r.persona_niche, 'unknown') persona_niche,
    coalesce(r.persona_size, 'unknown') persona_size, r.subscriptions,
    coalesce(r.replied_n, 0) replies, r.replied_last, r.replied_last_channel replied_channel,
    r.first_channel, r.last_touch_at, r.last_channel, r.came_from,
    (select t.value #>> '{}' from profile_traits t
      where t.profile_id = p.id and t.key = 'lead') lead
  from profiles p
  left join profile_rollups r on r.profile_id = p.id
  where p.merged_into is null);
DROP VIEW "public"."unit_holds_now";--> statement-breakpoint
CREATE VIEW "public"."unit_holds_now" AS (
  select id, stage, subject, reason,
    case when released_at is not null then 'released' when subject like 'source:%' then 'paused'
      when until = 'infinity' then 'stuck' when until > now() then 'held' else 'due' end state,
    held_at, nullif(until, 'infinity') until, tries, released_at, released_by,
    coalesce(who, subject) || ': ' || what title
  from unit_holds h,
  lateral (select case when stage = 'research.signals' and subject like '%:%' then
        initcap(split_part(subject, ':', 1)) || ' signal' else case split_part(stage, '.', 2)
      when 'fb-groups' then 'Facebook groups' when 'exa-search' then 'Exa search'
      when 'youtube-search' then 'YouTube search' when 'youtube' then 'YouTube'
      when 'opener' then 'Opener email' when 'ads' then 'Ad Library'
      else initcap(replace(coalesce(nullif(split_part(stage, '.', 2), ''), stage), '-', ' ')) end end what) w,
  lateral (select case
      when subject like 'source:%' then initcap(substr(subject, 8)) || ' source'
      when stage = 'research.signals' then (select coalesce(case
          when k ~ '^c[0-9]{1,9}$' then (select name from companies where id = substr(k, 2)::int)
          when k ~ '^p[0-9]{1,9}$' then (select full_name from people where id = substr(k, 2)::int)
          when k ~ '^(reddit:)?t3_' then (select '"' || t.title || '"' from reddit_threads t
            where t.id = regexp_replace(k, '^reddit:', '') limit 1) end, k)
        from (select substr(subject, strpos(subject, ':') + 1) k) s)
      when subject like 'post %' then (select coalesce(g.name, 'Group') || ', post by '
        || coalesce(nullif(p.author, ''), 'someone') from social_posts p
        left join social_groups g on g.id = p.group_id where p.ref = substr(subject, 6) limit 1)
      when subject like 'about %' then (select g.name || ', About page' from social_groups g
        where g.ref = substr(subject, 7) limit 1)
      when subject !~ '^[0-9]{1,9}$' then case when stage in ('research.exa-search',
        'research.youtube-search', 'research.ads') then '"' || subject || '"' end
      when stage in ('research.scan', 'research.extract', 'research.contacts') then
        (select c.name from documents d join companies c on c.id = d.company_id
          where d.id = subject::int)
      when stage = 'research.profiles' then (select full_name from people where id = subject::int)
      else (select name from companies where id = subject::int) end who) n);
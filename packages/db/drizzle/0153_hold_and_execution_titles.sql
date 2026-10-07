DROP VIEW "public"."spine_executions";--> statement-breakpoint
DROP VIEW "public"."unit_holds_now";--> statement-breakpoint
CREATE VIEW "public"."spine_executions" AS (
  select x.*, coalesce(case
      when subject ~ '^mail:[0-9]{1,9}$' then (select coalesce(nullif(m.from_name, ''),
        m.from_address) || ': ' || coalesce(nullif(m.subject, ''), 'Email')
        from watch.mail m where m.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^item:[0-9]{1,9}$' then (select i.title from watch.items i
        where i.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^(lead|reply):sms:[0-9]{1,9}$' then (select coalesce(nullif(s.name, ''),
        c.name, 'Lead') || case when x.subject like 'lead:%' then ': Text lead' else ': Text reply' end
        from sms_contacts s left join companies c on c.id = s.company_id
        where s.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^company:[0-9]{1,9}$' then (select c.name from companies c
        where c.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^account:[0-9]{1,9}:' then (select initcap(a.site) || ': ' || a.ref
        from client_accounts a where a.id = split_part(x.subject, ':', 2)::int)
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Feed item'
      when 'company' then 'Company' when 'lead' then 'Text lead' when 'reply' then 'Text reply'
      when 'account' then 'Account' end || ' (gone)', subject) title
  from (select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due, max(error) error,
    count(*)::int steps
  from events group by workflow, subject) x);--> statement-breakpoint
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
      when stage = 'research.signals' then substr(subject, strpos(subject, ':') + 1)
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
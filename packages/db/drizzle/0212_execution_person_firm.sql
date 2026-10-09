DROP VIEW "public"."spine_executions";--> statement-breakpoint
CREATE VIEW "public"."spine_executions" AS (
  select x.*, coalesce(case
      when subject ~ '^mail:[0-9]{1,9}$' then (select coalesce(nullif(m.from_name, ''),
        m.from_address) || ': ' || coalesce(nullif(m.subject, ''), 'Email')
        from watch.mail m where m.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^item:[0-9]{1,9}$' then (select i.title from learn.items i
        where i.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^(lead|reply):sms:[0-9]{1,9}$' then (select coalesce(nullif(s.name, ''),
        c.name, 'Lead') || case when x.subject like 'lead:%' then ': Text lead' else ': Text reply' end
        from sms_contacts s left join companies c on c.id = s.company_id
        where s.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):reach:[0-9]{1,9}$' then (select coalesce(nullif(r.name, ''),
        r.handle) || case when x.subject like 'lead:%' then ': DM lead' else ': DM reply' end
        from reach_contacts r where r.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):email:[0-9]{1,9}$' then (select coalesce(nullif(p.full_name, ''),
        c.name, e.to_email) || case when x.subject like 'lead:%' then ': Email lead'
        else ': Email reply' end
        from enrollments e left join people p on p.id = e.person_id
        left join companies c on c.id = e.company_id
        where e.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^company:[0-9]{1,9}$' then (select c.name from companies c
        where c.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^account:[0-9]{1,9}:' then (select initcap(a.site) || ': ' || a.ref
        from client_accounts a where a.id = split_part(x.subject, ':', 2)::int)
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Learn item'
      when 'company' then 'Company' when 'account' then 'Account'
      when 'lead' then case split_part(subject, ':', 2) when 'reach' then 'DM lead'
        when 'email' then 'Email lead' else 'Text lead' end
      when 'reply' then case split_part(subject, ':', 2) when 'reach' then 'DM reply'
        when 'email' then 'Email reply' else 'Text reply' end
    end || ' (gone)', subject) title, who.person, who.firm
  from (select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due,
    (array_agg(until order by due nulls last) filter (where due is not null))[1] until,
    max(error) error, count(*)::int steps
  from events group by workflow, subject) x
  left join lateral (
    select nullif(s.name, '') person, c.name firm from sms_contacts s
      left join companies c on c.id = s.company_id
      where s.id = case when x.subject ~ '^(lead|reply):sms:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select coalesce(nullif(r.name, ''), r.handle), c.name from reach_contacts r
      left join companies c on c.id = r.company_id
      where r.id = case when x.subject ~ '^(lead|reply):reach:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select coalesce(nullif(p.full_name, ''), e.to_email), c.name from enrollments e
      left join people p on p.id = e.person_id left join companies c on c.id = e.company_id
      where e.id = case when x.subject ~ '^(lead|reply):email:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select null, c.name from companies c
      where c.id = case when x.subject ~ '^company:[0-9]{1,9}$'
        then split_part(x.subject, ':', 2)::int end
    union all
    select coalesce(nullif(m.from_name, ''), m.from_address), null from watch.mail m
      where m.id = case when x.subject ~ '^mail:[0-9]{1,9}$'
        then split_part(x.subject, ':', 2)::int end
  ) who on true);
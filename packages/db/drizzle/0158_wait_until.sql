DROP VIEW "public"."spine_events";--> statement-breakpoint
DROP VIEW "public"."spine_executions";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "until" varchar(16);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "about" varchar(200);--> statement-breakpoint
CREATE INDEX "ix_events_until" ON "events" USING btree ("until","about") WHERE due is not null and until is not null;--> statement-breakpoint
CREATE VIEW "public"."spine_events" AS (
  select id::text id, workflow, node, port, subject, kind,
    case when error is not null then 'failed' when due is not null then 'waiting' else 'passed' end state,
    at, due, case when due is not null then until end until, error
  from events);--> statement-breakpoint
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
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due,
    (array_agg(until order by due nulls last) filter (where due is not null))[1] until,
    max(error) error, count(*)::int steps
  from events group by workflow, subject) x);
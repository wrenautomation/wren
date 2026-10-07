DROP VIEW "public"."spine_executions";--> statement-breakpoint
ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "reach_messages" DROP CONSTRAINT "ck_reach_messages_kind";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_follow_up_ref" ON "sms_messages" USING btree ("contact_id","ref") WHERE (kind)::text = 'follow_up'::text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reach_messages_follow_up" ON "reach_messages" USING btree ("contact_id",("provenance" ->> 'follow')) WHERE (kind)::text = 'follow_up'::text;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying, 'follow_up'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "reach_messages" ADD CONSTRAINT "ck_reach_messages_kind" CHECK (("kind")::text = ANY ((ARRAY['connect'::character varying, 'sequence'::character varying, 'manual'::character varying, 'inbound'::character varying, 'follow_up'::character varying])::text[]));--> statement-breakpoint
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
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Feed item'
      when 'company' then 'Company' when 'account' then 'Account'
      when 'lead' then case split_part(subject, ':', 2) when 'reach' then 'DM lead'
        when 'email' then 'Email lead' else 'Text lead' end
      when 'reply' then case split_part(subject, ':', 2) when 'reach' then 'DM reply'
        when 'email' then 'Email reply' else 'Text reply' end
    end || ' (gone)', subject) title
  from (select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due,
    (array_agg(until order by due nulls last) filter (where due is not null))[1] until,
    max(error) error, count(*)::int steps
  from events group by workflow, subject) x);
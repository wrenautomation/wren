DROP VIEW "watch"."mail_records";--> statement-breakpoint
CREATE VIEW "watch"."mail_records" AS (
    select m.id, m.mailbox, coalesce(nullif(m.from_name, ''), m.from_address)::text sender,
      m.from_address::text from_address, m.subject, m.summary, m.verdict::text verdict, m.why,
      case when m.done_at is not null then 'done'
        when m.verdict is null or m.verdict = 'show' then 'needs_you'
        when m.verdict = 'hold' then 'held' else 'dropped' end queue,
      m.at, coalesce(m.link, 'https://mail.google.com/mail/u/' || m.mailbox || '/#all/' || m.thread_id) open,
      h.n::int held,
      case when h.n > 0 then '/today/mail?view=held&fromAddress=~' || m.from_address end others
    from watch.mail m
    left join lateral (select count(*) n from watch.mail o
      where o.from_address = m.from_address and o.verdict = 'hold' and o.id <> m.id) h on true);
CREATE VIEW "public"."draft_activity" AS (
  with lines as (
    select e.item, e.at, e.event kind,
      case e.event
        when 'generated' then case e.via when 'model' then 'Drafted by ' || coalesce(e.by, 'the model')
          else 'Written by ' || coalesce(e.by, 'Wren') end
        when 'edited' then case e.via when 'claude' then 'Claude rewrote it, asked by ' || coalesce(e.by, 'you')
          || coalesce(': ' || left(e.ask, 200), '')
          else 'Edited by ' || coalesce(e.by, 'a person') end
          || case when e.meta ? 'undo' then ' (undo)' when e.meta ? 'at_send' then ' at send' else '' end
        when 'approved' then 'Approved' || coalesce(' by ' || e.by, '')
          || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'scheduled' then 'Scheduled' || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'rejected' then 'Rejected' || coalesce(' by ' || e.by, '')
          || coalesce(': ' || case e.reason when 'voice' then 'Not my voice' when 'facts' then 'Wrong facts'
            when 'length' then 'Too long' when 'salesy' then 'Too salesy' when 'topic' then 'Off topic'
            when 'timing' then 'Bad timing' when 'repeat' then 'Said before' end, '')
          || coalesce(' · ' || e.note, '')
        when 'sent' then 'Sent' || coalesce(' · ' || e.url, '')
        else 'Failed' || coalesce(': ' || left(e.note, 200), '') end what
    from draft_events e
    union all
    select 'draft:' || d.id, m.as_of, 'metrics',
      concat_ws(' · ', m.views || ' views', m.reactions || ' reactions', m.comments || ' comments',
        m.shares || ' shares', m.follows || ' follows')
    from content_metrics m join content_drafts d on d.id = m.draft_id
    union all
    select 'draft:' || d.id, c.at, 'reply', 'Reply from ' || c.author || ': ' || left(c.body, 200)
    from comments c join content_drafts d on d.published_id = c.post and d.platform::text = c.platform::text
    where c.sort is distinct from 'ours'
  )
  select l.item,
    case when l.item like 'draft:%' then split_part(l.item, ':', 2) end draft,
    case when l.item like 'draft:%' then concat_ws('/', d.idea_id, d.platform, d.id) end post,
    case when l.item like 'comment:%' then split_part(l.item, ':', 2) end comment,
    case when l.item like 'thread:%' then split_part(l.item, ':', 2) end thread,
    case when l.item like 'dm:%' or l.item like 'invite:%' then split_part(l.item, ':', 2) end contact,
    case when l.item like 'video:%' then split_part(l.item, ':', 2) end video,
    l.at, l.kind, l.what
  from lines l
  left join content_drafts d on l.item like 'draft:%' and d.id::text = split_part(l.item, ':', 2));--> statement-breakpoint
CREATE VIEW "public"."draft_outcomes" AS (
  select 'draft:' || d.id item, m.as_of measured, m.views, m.reactions, m.comments, m.shares,
    m.follows, (select count(*)::int from content_metrics x where x.draft_id = d.id) snapshots,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at) from comments c where c.post = d.published_id
        and c.platform::text = d.platform::text and c.sort is distinct from 'ours'), '[]') replies
  from content_drafts d
  left join lateral (select * from content_metrics c where c.draft_id = d.id
    order by c.created_at desc limit 1) m on true
  where d.published_id is not null
  union all
  select 'comment:' || a.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at) from comments c where c.parent = a.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from comments a where a.answer_ref is not null
  union all
  select 'thread:' || t.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at) from comments c where c.parent = t.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from reddit_threads t where t.answer_ref is not null
  union all
  select k.prefix || r.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', coalesce(r.name, r.handle),
      'text', i.body, 'at', i.created_at) order by i.created_at) from reach_messages i
      where i.contact_id = r.id and i.direction = 'in'), '[]')
  from reach_contacts r cross join (values ('dm:'), ('invite:')) k(prefix)
  where exists (select 1 from reach_messages o where o.contact_id = r.id and o.direction = 'out'
    and o.state = 'sent'));--> statement-breakpoint
CREATE VIEW "public"."draft_people" AS (
  select 'comment:' || c.id item, c.author name from comments c
  union all
  select 'thread:' || t.id, t.author from reddit_threads t
  union all
  select k.prefix || r.id, n.name from reach_contacts r
  cross join (values ('dm:'), ('invite:')) k(prefix)
  cross join lateral (values (r.name), (r.handle)) n(name)
  where n.name is not null and n.name <> '');
DROP VIEW "public"."site_link_records";--> statement-breakpoint
CREATE VIEW "public"."site_link_records" AS (
  select l.id::text id, coalesce(l.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name,
    coalesce(l.name, concat_ws(' / ', l.link, l.campaign, l.content))::text name,
    l.page::text page, p.title::text page_title, p.slug::text, l.link::text, l.source::text,
    l.medium::text, l.channel::text, l.campaign::text, l.content::text, h.host,
    'https://' || h.host || '/go/' || l.link || '/' || l.campaign
      || coalesce('/' || l.content, '') || '?to=/o/' || p.slug url,
    k.clicks, coalesce(e.visits, 0) visits, coalesce(e.forms, 0) forms, coalesce(e.books, 0) books,
    greatest(e.last, k.last) last, l.created_at created, l.created_by::text created_by
  from site_links l
  join site_pages p on p.id = l.page
  left join clients c on c.id = l.client
  left join lateral (select case when l.client is null then 'wrenautomation.com'
      else (select d.hostname from client_domains d where d.client_id = l.client
        and d.status = 'active' order by d.created_at limit 1) end::text host) h on true
  left join lateral (
    select count(distinct x.view) filter (where x.name = 'view')::int visits,
      count(*) filter (where x.name = 'form')::int forms,
      count(distinct x.view) filter (where x.name = 'book')::int books, max(x.at) last
    from site_events x
    where (x.page = l.page or x.split in (select s.id from site_splits s where s.page = l.page))
      and x.source = l.source and x.medium = l.medium and x.campaign = l.campaign
      and coalesce(x.content, '') = coalesce(l.content, '')) e on true
  left join lateral (
    select count(*)::int clicks, max(y.at) last
    from site_hops y
    where y.client is not distinct from l.client and y.page = l.page and y.link = l.link
      and y.campaign = l.campaign and coalesce(y.content, '') = coalesce(l.content, '')) k on true);
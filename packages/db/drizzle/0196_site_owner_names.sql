DROP VIEW "public"."site_entry_records";--> statement-breakpoint
DROP VIEW "public"."site_form_records";--> statement-breakpoint
DROP VIEW "public"."site_page_records";--> statement-breakpoint
CREATE VIEW "public"."site_entry_records" AS (
  select e.id::text id, e.form::text form, f.name::text form_name, e.page::text page,
    p.title::text page_title, coalesce(f.client, p.client, 'wren')::text owner,
    coalesce(c.name, 'Wren')::text owner_name, e.at,
    e.channel::text, e.touch ->> 'source' source, e.touch ->> 'campaign' campaign,
    coalesce(e.fields ->> 'name',
      nullif(concat_ws(' ', e.fields ->> 'first_name', e.fields ->> 'last_name'), '')) who,
    e.fields ->> 'email' email, e.fields ->> 'phone' phone, case when e.consent is not null then 'yes' else 'no' end consented,
    e.consent ->> 'version' consent_version, e.consent ->> 'text' consent_text,
    case when e.entered then 'in' else 'out' end entered, e.why,
    e.visitor::text, e.human::text,
    (select string_agg(k || ': ' || v, '; ' order by k) from jsonb_each_text(e.fields) x(k, v)) answers
  from site_forms e
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  left join clients c on c.id = coalesce(f.client, p.client));--> statement-breakpoint
CREATE VIEW "public"."site_form_records" AS (
  with ev as (
    select form, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'start')::int starts,
      count(*) filter (where name = 'form')::int submits,
      max(at) filter (where name = 'form') last
    from site_events where form is not null group by form)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
  select f.id::text id, f.name::text, f.slug::text, coalesce(f.client, 'wren')::text owner,
    f.status::text,
    case when f.client is null then 'https://wrenautomation.com/o/f/' || f.slug
      else (select 'https://' || d.hostname || '/o/f/' || f.slug from client_domains d
        where d.client_id = f.client and d.status = 'active' order by d.created_at limit 1) end url,
    jsonb_array_length(f.spec -> 'fields')::int fields,
    coalesce(ev.views, 0) views, coalesce(ev.starts, 0) starts, coalesce(ev.submits, 0) submits,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.submits, 0)::float8 / ev.views end conversion,
    ev.last, f.updated_at changed, f.updated_by changed_by
  from site_form_defs f left join ev on ev.form = f.id) u
  left join clients c on c.id = u.owner);--> statement-breakpoint
CREATE VIEW "public"."site_page_records" AS (
  with ev as (
    select page, count(*) filter (where name = 'view')::int views,
      count(*) filter (where name = 'cta')::int ctas,
      count(*) filter (where name = 'form')::int forms,
      count(*) filter (where name = 'book')::int books
    from site_events group by page),
  ads as (select p.id page, count(distinct l.id)::int ads, coalesce(sum(d.spend), 0)::float8 spend
    from site_pages p
    join ad_launches l on case when p.source = 'code'
        then (l.spec -> 'creative' ->> 'link') like p.url || '%'
        else (l.spec -> 'creative' ->> 'link') ~* ('(/|%2f)o(/|%2f)' || p.slug || '([?#/&]|$)') end
    left join ad_days d on d.adset_id = l.adset_id
    group by p.id)
  select u.*, regexp_replace(u.url, '^https?://(www[.])?', '') address,
    coalesce(c.name, 'Wren')::text owner_name from (
  select p.id::text id, p.title::text, case when p.source = 'code' then p.url
    when p.client is null then 'https://wrenautomation.com/o/' || p.slug
    else (select 'https://' || d.hostname || '/o/' || p.slug from client_domains d
      where d.client_id = p.client and d.status = 'active' order by d.created_at limit 1) end url, p.kind::text, p.source::text,
    coalesce(p.client, 'wren')::text owner, p.status::text, p.waiting_version waiting,
    p.offer::text, p.angle::text, p.audience::text, p.stage::text, p.template::text,
    p.variant_of::text variant_of, p.repo_path,
    coalesce(ev.views, 0) views, coalesce(ev.ctas, 0) ctas, coalesce(ev.forms, 0) forms,
    coalesce(ev.books, 0) books,
    case when coalesce(ev.views, 0) > 0 then coalesce(ev.forms, 0)::float8 / ev.views end form_rate,
    coalesce(ads.ads, 0) ads, coalesce(ads.spend, 0)::float8 spend,
    case when coalesce(ev.forms, 0) > 0 and ads.spend > 0 then ads.spend / ev.forms end cost_per_form,
    p.updated_at changed, p.updated_by changed_by, 'USD'::text currency,
    (select s.state::text from site_splits s
      where s.page = p.id and s.state in ('running', 'shipping')) split,
    case when p.retire_at is not null then 'retire'
      when p.waiting_version is not null then 'publish' end asked
  from site_pages p
  left join ev on ev.page = p.id
  left join ads on ads.page = p.id
  union all
  select 'video:' || (e.output ->> 'id'), coalesce(e.output ->> 'firm', 'Demo video'),
    e.output ->> 'url', 'demo', 'derived', 'wren', 'live', null, null, null, null, 'trust', null,
    null, null, null, null, null, null, null, null, null, null, e.created_at, null, null, null,
    null
  from enrichments e where e.kind = 'video' and e.output ? 'url' and e.output ? 'id'
  union all
  select 'host:' || d.hostname, d.hostname, 'https://' || d.hostname, 'portal', 'derived',
    d.client_id, case when d.status = 'active' then 'live' else 'draft' end, null, null, null,
    null, null, null, null, null, null, null, null, null, null, null, null, null, d.checked_at,
    d.added_by, null, null, null
  from client_domains d
  union all
  select 'book:' || d.hostname, 'Booking on ' || d.hostname, 'https://' || d.hostname || '/book',
    'booking', 'derived', d.client_id, case when d.status = 'active' then 'live' else 'draft' end,
    null, null, null, null, 'convert', null, null, null, null, null, null, null, null, null, null,
    null, d.checked_at, d.added_by, null, null, null
  from client_domains d) u
  left join clients c on c.id = u.owner);
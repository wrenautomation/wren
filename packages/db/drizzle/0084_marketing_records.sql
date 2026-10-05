CREATE VIEW "public"."marketing_post_records" AS (
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged, m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  where d.status = 'published');--> statement-breakpoint
CREATE VIEW "public"."marketing_ad_day_records" AS (
  select concat_ws('/', d.campaign_id, d.adset_id, d.day) id, d.day, d.campaign_name campaign,
    d.adset_name adset, d.currency::text currency, d.spend, d.impressions, d.reach, d.clicks,
    d.leads, round((d.spend / nullif(d.leads, 0))::numeric, 2)::float cost_per_lead,
    l.status::text state,
    case when d.day > current_date - 7 then 'week'
      when d.day > current_date - 30 then 'month' else 'earlier' end age
  from ad_days d
  left join lateral (
    select a.status from ad_launches a where a.campaign_id = d.campaign_id
    order by a.created_at desc limit 1) l on true);--> statement-breakpoint
CREATE VIEW "public"."marketing_text_contact_records" AS (
  select c.id, coalesce(c.name, c.e164)::text "name", c.state::text state, c.basis::text basis,
    c.niche::text niche, coalesce(m.sent, 0) sent, coalesce(m.replies, 0) replies,
    (coalesce(m.sent, 0) > 0)::int texted, (coalesce(m.replies, 0) > 0)::int replied,
    l.body last_text, l.at last_at, r.disposition::text disposition,
    case when coalesce(m.unread, 0) > 0 then 'waiting' else 'read' end waiting,
    c.enrolled_at enrolled
  from sms_contacts c
  left join (
    select s.contact_id,
      count(*) filter (where s.direction = 'out' and s.state in ('sent', 'delivered', 'failed', 'unknown'))::int sent,
      count(*) filter (where s.direction = 'in')::int replies,
      count(*) filter (where s.direction = 'in' and (x.read_at is null or s.received_at > x.read_at))::int unread
    from sms_messages s join sms_contacts x on x.id = s.contact_id group by s.contact_id) m
    on m.contact_id = c.id
  left join lateral (
    select body, coalesce(received_at, sent_at, created_at) at from sms_messages
    where contact_id = c.id and state not in ('queued', 'skipped')
    order by coalesce(received_at, sent_at, created_at) desc limit 1) l on true
  left join lateral (
    select disposition from sms_messages
    where contact_id = c.id and direction = 'in' and disposition is not null
    order by received_at desc limit 1) r on true);--> statement-breakpoint
CREATE VIEW "public"."marketing_answer_records" AS (
  select concat_ws('/', a.engine, a.keyword_id, a.asked_on) id, k.phrase, a.engine::text engine,
    a.asked_on asked, case when a.cited then 'cited' else 'not_cited' end cited, a.rank,
    case when a.overview then 'shown' when not a.overview then 'none' end overview,
    case when a.asked_on = max(a.asked_on) over (partition by a.engine, a.keyword_id)
      then 'latest' else 'older' end latest
  from search_answers a join search_keywords k on k.id = a.keyword_id);--> statement-breakpoint
CREATE VIEW "public"."marketing_keyword_records" AS (
  select k.id, k.phrase, k.source::text source, k.page,
    case when k.retired_at is null then 'active' else 'retired' end state,
    coalesce(w.clicks, 0) clicks, coalesce(w.impressions, 0) impressions, w.position,
    coalesce(w.clicks, 0) - coalesce(w.clicks_before, 0) clicks_change,
    coalesce(w.impressions, 0) - coalesce(w.impressions_before, 0) impressions_change,
    k.added_at added
  from search_keywords k left join (select query k,
    sum(clicks) filter (where day > w.d - 7)::int clicks,
    sum(impressions) filter (where day > w.d - 7)::int impressions,
    round((sum(position * impressions) filter (where day > w.d - 7)
      / nullif(sum(impressions) filter (where day > w.d - 7), 0))::numeric, 1)::float "position",
    sum(clicks) filter (where day <= w.d - 7)::int clicks_before,
    sum(impressions) filter (where day <= w.d - 7)::int impressions_before
  from search_days, (select max(day) d from search_days) w
  where day > w.d - 14 group by query) w on w.k = k.phrase);--> statement-breakpoint
CREATE VIEW "public"."marketing_search_day_records" AS (
  select day::text id, day, sum(clicks)::int clicks, sum(impressions)::int impressions,
    round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1)::float "position"
  from search_days group by day);--> statement-breakpoint
CREATE VIEW "public"."marketing_search_page_records" AS (
  select p.url id, p.url, case when p.verdict = 'PASS' then 'indexed' else 'not_indexed' end indexed,
    p.coverage, p.checked_on checked, coalesce(w.clicks, 0) clicks,
    coalesce(w.impressions, 0) impressions, w.position,
    coalesce(w.clicks, 0) - coalesce(w.clicks_before, 0) clicks_change,
    coalesce(w.impressions, 0) - coalesce(w.impressions_before, 0) impressions_change
  from (select distinct on (url) url, verdict, coverage, checked_on from search_pages
        order by url, checked_on desc) p
  left join (select page k,
    sum(clicks) filter (where day > w.d - 7)::int clicks,
    sum(impressions) filter (where day > w.d - 7)::int impressions,
    round((sum(position * impressions) filter (where day > w.d - 7)
      / nullif(sum(impressions) filter (where day > w.d - 7), 0))::numeric, 1)::float "position",
    sum(clicks) filter (where day <= w.d - 7)::int clicks_before,
    sum(impressions) filter (where day <= w.d - 7)::int impressions_before
  from search_days, (select max(day) d from search_days) w
  where day > w.d - 14 group by page) w on w.k = p.url);--> statement-breakpoint
CREATE VIEW "public"."marketing_site_day_records" AS (
  select concat_ws('/', day, channel, campaign) id, day, channel::text channel,
    nullif(campaign, '')::text campaign, visits, first_touches, forms, bookings, watch_plays,
    case when day > current_date - 7 then 'week'
      when day > current_date - 30 then 'month' else 'earlier' end age
  from site_days);
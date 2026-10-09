DROP VIEW "public"."marketing_heat_records";--> statement-breakpoint
CREATE VIEW "public"."marketing_heat_records" AS (
  select w.name || ':' || x.width || ':' || x.page id, w.name "window", null::date "day",
    x.page::text page, x.width::text width, sum(x.views)::int views, sum(x.clicks)::int clicks,
    sum(x.rage)::int rage
  from (
    select day, page, width, coalesce(s.views, 0) views, coalesce(h.clicks, 0) clicks,
      coalesce(h.rage, 0) rage
    from (select day, page, width, views from scroll_days where band = 0) s
    full join (select day, page, width, sum(clicks) clicks, sum(rage) rage from heat_days
      group by day, page, width) h using (day, page, width)
  ) x
  join (values ('7d', 7), ('30d', 30)) w(name, days) on x.day > current_date - w.days
  group by w.name, x.page, x.width
  union all
  select x.day::text || ':' || x.width || ':' || x.page, '1d', x.day, x.page::text,
    x.width::text, coalesce(s.views, 0)::int, coalesce(h.clicks, 0)::int, coalesce(h.rage, 0)::int
  from (select day, page, width from scroll_days where band = 0
    union select day, page, width from heat_days) x
  left join scroll_days s on s.day = x.day and s.page = x.page and s.width = x.width and s.band = 0
  left join (select day, page, width, sum(clicks) clicks, sum(rage) rage from heat_days
    group by day, page, width) h on h.day = x.day and h.page = x.page and h.width = x.width);
DROP VIEW "public"."marketing_site_day_records";--> statement-breakpoint
ALTER TABLE "site_days" ADD COLUMN "calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_days" ADD COLUMN "paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE VIEW "public"."marketing_funnel_records" AS (
  select w.name || '/' || d.channel id, w.name "window", d.channel::text channel,
    sum(d.first_touches)::int visitors, sum(d.forms)::int forms, sum(d.calls)::int calls,
    sum(d.paid)::int paid
  from site_days d
  join (values ('30d', 30), ('90d', 90), ('all', 100000)) w(name, days)
    on d.day > current_date - w.days
  group by w.name, d.channel);--> statement-breakpoint
CREATE VIEW "public"."marketing_site_day_records" AS (
  select concat_ws('/', day, channel, campaign) id, day, channel::text channel,
    nullif(campaign, '')::text campaign, visits, first_touches, forms, bookings, watch_plays,
    calls, paid,
    case when day > current_date - 7 then 'week'
      when day > current_date - 30 then 'month' else 'earlier' end age
  from site_days);
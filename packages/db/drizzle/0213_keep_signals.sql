CREATE TABLE "account_visits" (
	"id" serial NOT NULL,
	"entry" uuid NOT NULL,
	"company_id" integer NOT NULL,
	"person_id" integer,
	"email" varchar(320) NOT NULL,
	"what" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_account_visits" PRIMARY KEY("id"),
	CONSTRAINT "uq_account_visits_entry" UNIQUE("entry")
);
--> statement-breakpoint
CREATE TABLE "job_orders" (
	"id" serial NOT NULL,
	"format" varchar(32) NOT NULL,
	"order_key" varchar(128) NOT NULL,
	"company_id" integer,
	"company_name" text,
	"title" text,
	"status" text,
	"open" boolean NOT NULL,
	"openings" integer,
	"owner" text,
	"opened_on" date,
	"closed_on" date,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_job_orders" PRIMARY KEY("id"),
	CONSTRAINT "uq_job_orders_key" UNIQUE("format","order_key")
);
--> statement-breakpoint
DROP VIEW "public"."reactivation_keep";--> statement-breakpoint
ALTER TABLE "account_visits" ADD CONSTRAINT "fk_account_visits_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_visits" ADD CONSTRAINT "fk_account_visits_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "fk_job_orders_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_account_visits_company_at" ON "account_visits" USING btree ("company_id","at");--> statement-breakpoint
CREATE INDEX "ix_account_visits_person_id" ON "account_visits" USING btree ("person_id") WHERE person_id is not null;--> statement-breakpoint
CREATE INDEX "ix_job_orders_company_id" ON "job_orders" USING btree ("company_id") WHERE open;--> statement-breakpoint
CREATE VIEW "public"."reactivation_keep" AS (
  with placed as (
    select company_id, person_id, last_placement_on d from crm_contacts
    where last_placement_on is not null),
  dates as (select distinct company_id, d from placed),
  gaps as (
    select company_id, d - lag(d) over (partition by company_id order by d) gap from dates),
  own as (
    select company_id, percentile_cont(0.5) within group (order by gap) gap from gaps
    where gap is not null group by company_id),
  usual as (
    select percentile_cont(0.5) within group (order by gap) gap from gaps where gap is not null),
  latest as (
    select distinct on (company_id) company_id, person_id champion, d last_placement from placed
    order by company_id, d desc, person_id),
  counts as (select company_id, count(*)::int placements from dates group by company_id),
  cur as (
    select l.company_id, l.champion, l.last_placement, k.placements,
      round(coalesce(o.gap, u.gap, 180))::int usual_gap,
      (current_date - l.last_placement)::int since,
      (with r as (select distinct on (f.via) f.id, f.via, f.kind, f.value, f.confidence, f.observed_at
    from findings f where f.person_id = l.champion
      and f.kind in ('still_there', 'job_change', 'left')
    order by f.via, f.confidence desc, f.observed_at desc, f.id desc),
    n as (select count(*) filter (where kind = 'still_there') there,
      count(*) filter (where kind <> 'still_there') gone from r)
    select r.id from r, n
    where case when n.there > n.gone then r.kind = 'still_there'
      when n.gone > n.there then r.kind <> 'still_there'
      else exists (select 1 from unit_holds h where h.stage = 'reactivation.where'
    and h.subject = 'person:' || l.champion and h.released_at is not null
    and h.released_by <> 'checks') end
    order by r.confidence desc, r.observed_at desc, r.id desc limit 1) where_id, (select h.id from company_checks k join findings h on h.id = k.finding_id
    where k.company_id = l.company_id and h.observed_at > now() - interval '30 days') hiring_id,
      (
  select n.id from findings n
  where n.kind = 'news' and n.value->>'date' >= to_char(now() - interval '6 months', 'YYYY-MM-DD')
    and n.company_id = case
      when exists (select 1 from findings w where w.id = null::int and w.kind = 'job_change')
      then (select co.id from mover_addresses m join companies co on co.domain = m.domain
        where m.finding_id = null::int and m.outcome = 'found' limit 1)
      else l.company_id end
  order by n.value->>'date' desc, n.id desc limit 1) news_id
    from latest l join counts k on k.company_id = l.company_id
    left join own o on o.company_id = l.company_id cross join usual u
    where l.last_placement > current_date - interval '24 months'),
  touched as (
    select c.company_id,
      greatest(max(c.last_contacted_on)::timestamptz, max(k.called_at)) last_contact
    from crm_contacts c left join calls k on k.person_id = c.person_id group by c.company_id),
  visit as (
    select distinct on (company_id) company_id, at visited, what visit_what from account_visits
    where at > now() - interval '30 days' order by company_id, at desc, id desc),
  orders as (
    select company_id, count(*)::int open_orders from job_orders
    where open and company_id is not null group by company_id),
  sig as (
    select cur.*, w.kind where_kind, w.value ->> 'to' moved_to, t.last_contact,
      v.visited, v.visit_what, coalesce(o.open_orders, 0) open_orders,
      cur.since > 1.25 * cur.usual_gap and o.open_orders is null overdue,
      coalesce(w.kind in ('job_change', 'left'), false) gone,
      (select coalesce(n.value ->> 'title', n.value ->> 'event') from findings n
        where n.id = cur.news_id) news
    from cur left join findings w on w.id = cur.where_id
    left join touched t on t.company_id = cur.company_id
    left join visit v on v.company_id = cur.company_id
    left join orders o on o.company_id = cur.company_id)
  select s.company_id id, coalesce(co.name, co.domain, '?') company, co.domain,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, '(no name)') champion, s.champion champion_id,
    case when s.gone then 'champion_left' when s.overdue then 'overdue'
      when s.hiring_id is not null then 'hiring' when s.visited is not null then 'visited'
      when s.news_id is not null then 'news' when s.open_orders > 0 then 'orders'
      else 'steady' end signal,
    ((case when s.gone then 50 else 0 end) + (case when s.overdue then 30 else 0 end)
      + (case when s.last_contact is null or s.last_contact < now() - interval '6 months'
        then 20 else 0 end))::int risk,
    case when s.where_kind = 'job_change' then
        coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, 'The champion') || ' moved'
          || coalesce(' to ' || s.moved_to, '')
      when s.where_kind = 'left' then coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, 'The champion') || ' left'
      when s.overdue then s.since || ' days since the last placement; usually ' || s.usual_gap
      when s.hiring_id is not null then 'Open roles found in the last 30 days'
      when s.visited is not null then 'Filled ' || s.visit_what || ' on your site'
      when s.news_id is not null then coalesce(s.news, 'In the news')
      when s.open_orders > 0 then s.open_orders || case when s.open_orders = 1
        then ' open job order' else ' open job orders' end
      else s.placements || case when s.placements = 1 then ' placement' else ' placements' end
        || ', the last ' || s.since || ' days ago' end why,
    s.last_placement::timestamptz last_placement, s.placements, s.usual_gap, s.since,
    s.last_contact, s.visited, s.open_orders
  from sig s
  join companies co on co.id = s.company_id
  join people p on p.id = s.champion);
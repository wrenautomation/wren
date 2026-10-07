CREATE TABLE "delivery"."flags" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"engagement_id" integer,
	"side" varchar(12) NOT NULL,
	"source" varchar(12) NOT NULL,
	"cause" varchar(80) NOT NULL,
	"what" text NOT NULL,
	"how" text,
	"once" boolean DEFAULT false NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"remind_days" smallint DEFAULT 7 NOT NULL,
	"owner" text,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raised_by" text NOT NULL,
	"addressed_at" timestamp with time zone,
	"addressed_by" text,
	"note" text,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"told_at" timestamp with time zone,
	"raise_fired_at" timestamp with time zone,
	"clear_fired_at" timestamp with time zone,
	CONSTRAINT "pk_flags" PRIMARY KEY("id"),
	CONSTRAINT "ck_flags_side" CHECK (("side")::text = ANY ((ARRAY['risk'::character varying, 'opportunity'::character varying])::text[])),
	CONSTRAINT "ck_flags_source" CHECK (("source")::text = ANY ((ARRAY['delivery'::character varying, 'health'::character varying, 'person'::character varying])::text[])),
	CONSTRAINT "ck_flags_remind" CHECK ("delivery"."flags"."remind_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "delivery"."flag_digests" (
	"day" date NOT NULL,
	"flags" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flag_digests" PRIMARY KEY("day")
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_days" (
	"client_id" varchar(40) NOT NULL,
	"day" date NOT NULL,
	"score" smallint,
	"band" varchar(8) NOT NULL,
	"results" smallint,
	"engagement" smallint,
	"sentiment" smallint,
	"money" smallint,
	"weights" jsonb NOT NULL,
	"why" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stale" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visited" boolean DEFAULT false NOT NULL,
	"override" smallint,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_health_days" PRIMARY KEY("client_id","day"),
	CONSTRAINT "ck_health_days_band" CHECK (("band")::text = ANY ((ARRAY['healthy'::character varying, 'watch'::character varying, 'risk'::character varying, 'none'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_overrides" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"score" smallint NOT NULL,
	"reason" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	CONSTRAINT "pk_health_overrides" PRIMARY KEY("id"),
	CONSTRAINT "ck_health_overrides_score" CHECK ("delivery"."health_overrides"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_ratings" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"score" smallint NOT NULL,
	"note" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_health_ratings" PRIMARY KEY("id"),
	CONSTRAINT "ck_health_ratings_score" CHECK ("delivery"."health_ratings"."score" between 1 and 5)
);
--> statement-breakpoint
DROP TABLE "delivery"."pings" CASCADE;--> statement-breakpoint
ALTER TABLE "delivery"."flags" ADD CONSTRAINT "fk_flags_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."flags" ADD CONSTRAINT "fk_flags_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_days" ADD CONSTRAINT "fk_health_days_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_overrides" ADD CONSTRAINT "fk_health_overrides_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_ratings" ADD CONSTRAINT "fk_health_ratings_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flags_open" ON "delivery"."flags" USING btree ("client_id",coalesce(engagement_id, 0),"cause") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "ix_flags_raised" ON "delivery"."flags" USING btree ("raised_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_health_overrides_open" ON "delivery"."health_overrides" USING btree ("client_id") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "ix_health_ratings_client" ON "delivery"."health_ratings" USING btree ("client_id","at");--> statement-breakpoint
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
  sig as (
    select cur.*, w.kind where_kind, w.value ->> 'to' moved_to, t.last_contact,
      cur.since > 1.25 * cur.usual_gap overdue,
      coalesce(w.kind in ('job_change', 'left'), false) gone,
      (select coalesce(n.value ->> 'title', n.value ->> 'event') from findings n
        where n.id = cur.news_id) news
    from cur left join findings w on w.id = cur.where_id
    left join touched t on t.company_id = cur.company_id)
  select s.company_id id, coalesce(co.name, co.domain, '?') company, co.domain,
    coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''), p.full_name, '(no name)') champion, s.champion champion_id,
    case when s.gone then 'champion_left' when s.overdue then 'overdue'
      when s.hiring_id is not null then 'hiring' when s.news_id is not null then 'news'
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
      when s.news_id is not null then coalesce(s.news, 'In the news')
      else s.placements || case when s.placements = 1 then ' placement' else ' placements' end
        || ', the last ' || s.since || ' days ago' end why,
    s.last_placement::timestamptz last_placement, s.placements, s.usual_gap, s.since,
    s.last_contact
  from sig s
  join companies co on co.id = s.company_id
  join people p on p.id = s.champion);--> statement-breakpoint
CREATE VIEW "delivery"."console_flags" AS (
    select f.id, f.client_id::text client, c.name::text "name", f.side::text side,
      f.source::text source, f.what,
      case when f.cleared_at is not null then 'cleared' when f.addressed_at is not null
        then 'addressed' else 'open' end state,
      case when f.urgent then 'yes' else 'no' end urgent,
      coalesce(f.owner, 'Team') owner, f.raised_at raised, f.raised_by, f.addressed_at addressed,
      f.addressed_by, f.note, f.cleared_at cleared, f.cleared_by
    from delivery.flags f join clients c on c.id = f.client_id
    where not c.demo);--> statement-breakpoint
CREATE VIEW "delivery"."console_health" AS (
    with latest as (
      select distinct on (client_id) * from delivery.health_days order by client_id, day desc),
    rated as (
      select distinct on (client_id) client_id, score, at from delivery.health_ratings
      order by client_id, at desc, id desc),
    flagged as (
      select client_id, (count(*) filter (where side = 'risk'))::int risks,
        (count(*) filter (where side = 'opportunity'))::int opportunities
      from delivery.flags where cleared_at is null group by client_id)
    select c.id::text id, c.name::text "name", coalesce(o.score, l.score)::int score,
      l.score::int model, o.score::int override, o.reason, o.by override_by,
      case when coalesce(o.score, l.score) is null then 'none' when coalesce(o.score, l.score) >= 70 then 'healthy'
    when coalesce(o.score, l.score) >= 40 then 'watch' else 'risk' end band,
      l.results::int results, l.engagement::int engagement, l.sentiment::int sentiment,
      l.money::int money,
      l.why->>'results' results_why, l.why->>'engagement' engagement_why,
      l.why->>'sentiment' sentiment_why, l.why->>'money' money_why,
      concat_ws(' · ',
    case when (l.weights->>'results')::int > 0 then 'Results ' || (l.weights->>'results') || '%' end,
    case when (l.weights->>'engagement')::int > 0 then 'Engagement ' || (l.weights->>'engagement') || '%' end,
    case when (l.weights->>'sentiment')::int > 0 then 'Sentiment ' || (l.weights->>'sentiment') || '%' end,
    case when (l.weights->>'money')::int > 0 then 'Money ' || (l.weights->>'money') || '%' end) weights, jsonb_array_length(l.stale)::int stale, (select string_agg(initcap(x), ', ') from jsonb_array_elements_text(l.stale) x) stale_parts,
      coalesce(f.risks, 0) risks, coalesce(f.opportunities, 0) opportunities,
      r.score::int rating, r.at rated, l.at updated
    from latest l
    join clients c on c.id = l.client_id
    left join delivery.health_overrides o on o.client_id = l.client_id and o.cleared_at is null
    left join rated r on r.client_id = l.client_id
    left join flagged f on f.client_id = l.client_id
    where not c.demo);--> statement-breakpoint
CREATE VIEW "delivery"."console_health_days" AS (
    select l.client_id || ':' || l.day id, l.client_id::text client, c.name::text "name", l.day,
      coalesce(l.override, l.score)::int score, l.score::int model, l.override::int override,
      case when coalesce(l.override, l.score) is null then 'none' when coalesce(l.override, l.score) >= 70 then 'healthy'
    when coalesce(l.override, l.score) >= 40 then 'watch' else 'risk' end band,
      l.results::int results, l.engagement::int engagement, l.sentiment::int sentiment,
      l.money::int money, case when l.visited then 'yes' else 'no' end visited,
      (select string_agg(initcap(x), ', ') from jsonb_array_elements_text(l.stale) x) stale_parts
    from delivery.health_days l join clients c on c.id = l.client_id
    where not c.demo);--> statement-breakpoint
CREATE VIEW "delivery"."console_health_inputs" AS (
    with latest as (
      select distinct on (client_id) client_id, inputs from delivery.health_days
      order by client_id, day desc)
    select l.client_id || ':' || i.n id, l.client_id::text client, c.name::text "name",
      i.v->>'part' part, i.v->>'what' what, i.v->>'value' "value", (i.v->>'at')::timestamptz at,
      case when i.v->>'at' is null then 'live'
        when (i.v->>'part' = 'results'
            and (i.v->>'at')::timestamptz < now() - make_interval(days => 14))
          or (i.v->>'part' = 'sentiment'
            and (i.v->>'at')::timestamptz < now() - make_interval(days => 21))
        then 'stale' else 'fresh' end age,
      i.v->>'href' "rows"
    from latest l
    join clients c on c.id = l.client_id
    cross join lateral jsonb_array_elements(l.inputs) with ordinality i(v, n)
    where not c.demo);
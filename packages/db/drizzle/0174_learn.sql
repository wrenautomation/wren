CREATE SCHEMA "learn";
--> statement-breakpoint
CREATE TABLE "learn"."digests" (
	"day" date NOT NULL,
	"items" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_digests" PRIMARY KEY("day")
);
--> statement-breakpoint
CREATE TABLE "learn"."items" (
	"id" serial NOT NULL,
	"source_id" integer,
	"url" text NOT NULL,
	"kind" varchar(8) DEFAULT 'article' NOT NULL,
	"title" text NOT NULL,
	"creator" text,
	"text" text DEFAULT '' NOT NULL,
	"transcript" text,
	"file" text,
	"needs_mac" timestamp with time zone,
	"read_at" timestamp with time zone,
	"read_failure" text,
	"published_at" timestamp with time zone,
	"score" smallint,
	"verdict" varchar(8),
	"summary" text,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text,
	"tries" smallint DEFAULT 0 NOT NULL,
	"scored_at" timestamp with time zone,
	"saved_at" timestamp with time zone,
	"saved_by" varchar(320),
	"saved_via" varchar(8),
	"told_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, title), 'A'::"char") || setweight(to_tsvector('english'::regconfig, coalesce(summary, ''::text)), 'B'::"char") || setweight(to_tsvector('english'::regconfig, coalesce(transcript, text)), 'C'::"char")) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_items" PRIMARY KEY("id"),
	CONSTRAINT "uq_learn_items_url" UNIQUE("url"),
	CONSTRAINT "ck_learn_items_score" CHECK ("learn"."items"."score" between 0 and 10),
	CONSTRAINT "ck_learn_items_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'episode'::character varying])::text[])),
	CONSTRAINT "ck_learn_items_verdict" CHECK (("verdict")::text = ANY ((ARRAY['show'::character varying, 'hold'::character varying, 'drop'::character varying])::text[])),
	CONSTRAINT "ck_learn_items_saved_via" CHECK (("saved_via")::text = ANY ((ARRAY['portal'::character varying, 'shortcut'::character varying, 'cli'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "learn"."sop_sources" (
	"id" serial NOT NULL,
	"item_id" integer NOT NULL,
	"sop" varchar(64) NOT NULL,
	"state" varchar(8) DEFAULT 'asked' NOT NULL,
	"file" text,
	"points" timestamp with time zone,
	"error" text,
	"by" varchar(320),
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "pk_sop_sources" PRIMARY KEY("id"),
	CONSTRAINT "uq_learn_sop_sources_item_sop" UNIQUE("item_id","sop"),
	CONSTRAINT "ck_learn_sop_sources_state" CHECK (("state")::text = ANY ((ARRAY['asked'::character varying, 'added'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "learn"."sources" (
	"id" serial NOT NULL,
	"url" text NOT NULL,
	"page" text,
	"name" text NOT NULL,
	"kind" varchar(12) DEFAULT 'blog' NOT NULL,
	"tell" varchar(8) DEFAULT 'top' NOT NULL,
	"fetched_at" timestamp with time zone,
	"failure" text,
	"stopped_at" timestamp with time zone,
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_sources" PRIMARY KEY("id"),
	CONSTRAINT "uq_learn_sources_url" UNIQUE("url"),
	CONSTRAINT "ck_learn_sources_kind" CHECK (("kind")::text = ANY ((ARRAY['youtube'::character varying, 'podcast'::character varying, 'blog'::character varying, 'forum'::character varying, 'releases'::character varying])::text[])),
	CONSTRAINT "ck_learn_sources_tell" CHECK (("tell")::text = ANY ((ARRAY['every'::character varying, 'top'::character varying, 'digest'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "public"."spine_executions";--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "fk_items_source_id_sources" FOREIGN KEY ("source_id") REFERENCES "learn"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD CONSTRAINT "fk_sop_sources_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_items_source" ON "learn"."items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ix_learn_items_created" ON "learn"."items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_learn_items_saved" ON "learn"."items" USING btree ("saved_at");--> statement-breakpoint
CREATE INDEX "ix_learn_items_search" ON "learn"."items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "ix_learn_sop_sources_sop" ON "learn"."sop_sources" USING btree ("sop");--> statement-breakpoint
CREATE VIEW "learn"."item_records" AS (
    select i.id, i.title, i.kind::text kind, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.done_at is not null then 'done'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      i.read_failure failure,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id);--> statement-breakpoint
CREATE VIEW "learn"."saved_records" AS (select * from (
    select i.id, i.title, i.kind::text kind, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.done_at is not null then 'done'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      i.read_failure failure,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id) x where x.saved_at is not null);--> statement-breakpoint
CREATE VIEW "learn"."source_records" AS (
    select s.id, s.name, s.url, s.page, s.kind::text kind, s.tell::text tell,
      case when s.stopped_at is not null then 'stopped' when s.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      s.fetched_at, s.failure, s.by::text by, s.created_at
    from learn.sources s left join learn.items i on i.source_id = s.id
    group by s.id);--> statement-breakpoint
CREATE VIEW "public"."spine_executions" AS (
  select x.*, coalesce(case
      when subject ~ '^mail:[0-9]{1,9}$' then (select coalesce(nullif(m.from_name, ''),
        m.from_address) || ': ' || coalesce(nullif(m.subject, ''), 'Email')
        from watch.mail m where m.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^item:[0-9]{1,9}$' then (select i.title from learn.items i
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
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Learn item'
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
  from events group by workflow, subject) x);--> statement-breakpoint
DROP VIEW "watch"."feed_records";--> statement-breakpoint
DROP VIEW "watch"."item_records";--> statement-breakpoint
DROP TABLE "watch"."feeds" CASCADE;--> statement-breakpoint
DROP TABLE "watch"."items" CASCADE;
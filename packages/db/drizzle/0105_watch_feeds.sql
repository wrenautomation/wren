CREATE TABLE "watch"."feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"fetched_at" timestamp with time zone,
	"failure" text,
	"stopped_at" timestamp with time zone,
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_watch_feeds_url" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "watch"."items" (
	"id" serial PRIMARY KEY NOT NULL,
	"feed_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"published_at" timestamp with time zone,
	"score" smallint,
	"verdict" varchar(8),
	"summary" text,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text,
	"tries" smallint DEFAULT 0 NOT NULL,
	"scored_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_watch_items_url" UNIQUE("url"),
	CONSTRAINT "ck_watch_items_score" CHECK ("watch"."items"."score" between 0 and 10),
	CONSTRAINT "ck_watch_items_verdict" CHECK (("verdict")::text = ANY ((ARRAY['show'::character varying, 'hold'::character varying, 'drop'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "watch"."items" ADD CONSTRAINT "items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "watch"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_watch_items_feed" ON "watch"."items" USING btree ("feed_id");--> statement-breakpoint
CREATE INDEX "ix_watch_items_created" ON "watch"."items" USING btree ("created_at");--> statement-breakpoint
CREATE VIEW "watch"."feed_records" AS (
    select f.id, f.name, f.url,
      case when f.stopped_at is not null then 'stopped' when f.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      f.fetched_at, f.failure, f.by::text by, f.created_at
    from watch.feeds f left join watch.items i on i.feed_id = f.id
    group by f.id);--> statement-breakpoint
CREATE VIEW "watch"."item_records" AS (
    select i.id, i.title, f.name feed, i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.done_at is not null then 'done' when i.verdict is null then 'waiting'
        when i.verdict = 'show' then 'needs_you' when i.verdict = 'hold' then 'held'
        else 'dropped' end queue,
      coalesce(i.published_at, i.created_at) at, i.url open
    from watch.items i join watch.feeds f on f.id = i.feed_id);
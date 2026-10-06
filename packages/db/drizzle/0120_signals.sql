CREATE TABLE "signal_checks" (
	"collector" varchar(32) NOT NULL,
	"subject" varchar(160) NOT NULL,
	"state" varchar(16) NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"tried" jsonb NOT NULL,
	"answer" jsonb,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_signal_checks" PRIMARY KEY("collector","subject"),
	CONSTRAINT "ck_signal_checks_state" CHECK (("state")::text = ANY ((ARRAY['found'::character varying, 'none'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "findings" DROP CONSTRAINT "ck_findings_findingkind";--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "signal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "signal_dated" varchar(12);--> statement-breakpoint
ALTER TABLE "signal_checks" ADD CONSTRAINT "fk_signal_checks_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_signal_checks_run_id" ON "signal_checks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_signal_checks_checked_at" ON "signal_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "ix_findings_signal_at" ON "findings" USING btree ("signal_at") WHERE signal_at IS NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_signal_dated" CHECK (("signal_dated")::text = ANY ((ARRAY['published'::character varying, 'approx'::character varying, 'seen'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_signal_both" CHECK ((signal_at IS NULL) = (signal_dated IS NULL));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_signal_link" CHECK (signal_at IS NULL OR source_url IS NOT NULL);--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_signal_kind" CHECK (signal_at IS NULL OR kind IN ('news', 'post', 'hiring', 'job_change', 'stack', 'site_change', 'talk', 'demand'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_findingkind" CHECK (("kind")::text = ANY ((ARRAY['job_change'::character varying, 'still_there'::character varying, 'left'::character varying, 'hiring'::character varying, 'post'::character varying, 'news'::character varying, 'profile'::character varying, 'stack'::character varying, 'site_change'::character varying, 'talk'::character varying, 'demand'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "public"."research_signals" AS (
  select f.id, f.kind,
    coalesce(f.value ->> 'topic', f.value ->> 'event', f.value ->> 'site', replace(f.kind, '_', ' ')) topic,
    coalesce(f.company_id, p.company_id) company_id, f.person_id,
    coalesce(p.full_name, co.name, co.domain) subject,
    coalesce(f.value ->> 'title', left(coalesce(f.value ->> 'caption', f.value ->> 'text'), 200),
      case f.kind when 'hiring' then (f.value ->> 'count') || ' open roles'
        when 'job_change' then concat_ws(' at ', f.value ->> 'title', f.value ->> 'to') end) title,
    f.source_url url, f.signal_at "at", f.signal_dated dated, f.via, f.confidence, f.document_id,
    f.created_at first_seen, f.observed_at seen,
    case when f.signal_at > now() - interval '30 days' then 'fresh' else 'older' end age
  from findings f
  left join people p on p.id = f.person_id
  left join companies co on co.id = coalesce(f.company_id, p.company_id)
  where f.signal_at is not null);--> statement-breakpoint
-- Hand-written backfill: date the signals already held. A row with no link stays undated.
UPDATE "findings" SET "signal_at" = ("value" ->> 'date')::timestamptz, "signal_dated" = 'published'
WHERE "kind" = 'news' AND "source_url" IS NOT NULL AND "value" ->> 'date' ~ '^\d{4}-\d{2}-\d{2}($|T)';--> statement-breakpoint
UPDATE "findings" SET "signal_at" = ("value" ->> 'published_at')::timestamptz, "signal_dated" = 'published'
WHERE "kind" = 'post' AND "source_url" IS NOT NULL AND "value" ->> 'published_at' ~ '^\d{4}-\d{2}-\d{2}($|T)';--> statement-breakpoint
UPDATE "findings" f SET "signal_at" = coalesce(r.newest::timestamptz, f."created_at"),
  "signal_dated" = CASE WHEN r.newest IS NULL THEN 'seen' ELSE 'published' END
FROM (
  SELECT h."id", (
    SELECT max(j ->> 'postedAt') FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(h."value" -> 'roles') = 'array' THEN h."value" -> 'roles' ELSE '[]'::jsonb END) j
    WHERE j ->> 'postedAt' ~ '^\d{4}-\d{2}-\d{2}($|T)') newest
  FROM "findings" h WHERE h."kind" = 'hiring'
) r
WHERE f."id" = r."id" AND f."source_url" IS NOT NULL;--> statement-breakpoint
UPDATE "findings" SET "signal_at" = "created_at", "signal_dated" = 'seen'
WHERE "kind" = 'job_change' AND "source_url" IS NOT NULL;
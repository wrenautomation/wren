ALTER TABLE "events" ADD COLUMN "sent" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE VIEW "public"."spine_executions" AS (
  select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due, max(error) error,
    count(*)::int steps
  from events group by workflow, subject);
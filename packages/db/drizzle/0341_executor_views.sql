-- spine renamed to executor (designs/2026-10-25-ingestion-engine.md, phase 0).
ALTER VIEW "public"."spine_events" RENAME TO "executor_events";--> statement-breakpoint
ALTER VIEW "public"."spine_executions" RENAME TO "executions";

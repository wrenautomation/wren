ALTER TABLE "events" ADD COLUMN "version" integer;--> statement-breakpoint
ALTER TABLE "workflow_saves" ADD COLUMN "live" boolean DEFAULT true NOT NULL;
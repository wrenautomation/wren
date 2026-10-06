ALTER TABLE "content_ideas" DROP CONSTRAINT "ck_content_ideas_source";--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "ref" varchar(200);--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "uq_content_ideas_ref" UNIQUE("ref");--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "ck_content_ideas_source" CHECK (("source")::text = ANY ((ARRAY['cli'::character varying, 'api'::character varying, 'ads'::character varying, 'build_log'::character varying, 'question'::character varying])::text[]));
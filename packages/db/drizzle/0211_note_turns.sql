ALTER TABLE "content_ideas" DROP CONSTRAINT "ck_content_ideas_source";--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD COLUMN "note_id" uuid;--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD COLUMN "client" varchar(40);--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "ck_content_ideas_source" CHECK (("source")::text = ANY ((ARRAY['cli'::character varying, 'api'::character varying, 'ads'::character varying, 'build_log'::character varying, 'question'::character varying, 'promo'::character varying, 'note'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "learn"."sop_sources" ADD CONSTRAINT "ck_learn_sop_sources_from" CHECK (("learn"."sop_sources"."item_id" is not null) <> ("learn"."sop_sources"."note_id" is not null and "learn"."sop_sources"."client" is not null and "learn"."sop_sources"."text" is not null));
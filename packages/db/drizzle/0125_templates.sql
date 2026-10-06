CREATE TABLE "templates" (
	"id" serial NOT NULL,
	"kind" varchar(16) NOT NULL,
	"system" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"live_version_id" integer,
	"draft_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_templates" PRIMARY KEY("id"),
	CONSTRAINT "uq_templates_kind_system_name" UNIQUE("kind","system","name"),
	CONSTRAINT "ck_templates_kind" CHECK (("kind")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'dm'::character varying, 'prompt'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "template_versions" DROP CONSTRAINT "fk_template_versions_experiment_id_experiments";
--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "template_id" integer;--> statement-breakpoint
-- Every version email kept so far becomes a version of its template (kind email, system its niche).
INSERT INTO "templates" ("kind", "system", "name", "created_at", "updated_at")
SELECT 'email', "niche", "template", min("created_at"), max("created_at")
FROM "template_versions" GROUP BY "niche", "template";--> statement-breakpoint
UPDATE "template_versions" v SET "template_id" = t."id"
FROM "templates" t WHERE t."kind" = 'email' AND t."system" = v."niche" AND t."name" = v."template";--> statement-breakpoint
ALTER TABLE "template_versions" ALTER COLUMN "template_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "created_by" varchar(200);--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "published_by" varchar(200);--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "template_version" varchar(12);--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "reach_messages" ADD COLUMN "template_version" varchar(12);--> statement-breakpoint
ALTER TABLE "reach_messages" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "fk_templates_live_version_id_template_versions" FOREIGN KEY ("live_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "fk_templates_draft_version_id_template_versions" FOREIGN KEY ("draft_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "fk_template_versions_template_id_templates" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_template_versions_template_id" ON "template_versions" USING btree ("template_id");
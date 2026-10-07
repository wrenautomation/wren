ALTER TABLE "template_versions" DROP CONSTRAINT "uq_template_versions_niche";--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "ck_templates_kind";--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "number" integer;--> statement-breakpoint
-- Number the kept versions 1, 2, 3 per template in the order they were saved.
UPDATE "template_versions" v SET "number" = n.rn FROM (
  SELECT "id", row_number() OVER (PARTITION BY "template_id" ORDER BY "id") rn FROM "template_versions"
) n WHERE n."id" = v."id";--> statement-breakpoint
ALTER TABLE "template_versions" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "origin" varchar(16) DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "opened_from" integer;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "default_hash" varchar(64);--> statement-breakpoint
-- Where each kept version came from: an import, an experiment's model, else a person's edit.
UPDATE "template_versions" SET "origin" = CASE WHEN "created_by" LIKE 'import:%' THEN 'import'
  WHEN "experiment_id" IS NOT NULL THEN 'ai' ELSE 'edit' END;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "waiting_version_id" integer;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "waiting_by" varchar(200);--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "folder" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "follows_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "why" text;--> statement-breakpoint
-- Each template shows under its system, then its name's folders.
UPDATE "templates" SET "folder" = CASE WHEN position('/' in "name") > 0
  THEN "system" || '/' || regexp_replace("name", '/[^/]*$', '') ELSE "system" END;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "fk_template_versions_opened_from_template_versions" FOREIGN KEY ("opened_from") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "fk_templates_waiting_version_id_template_versions" FOREIGN KEY ("waiting_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_template_versions_niche" ON "template_versions" USING btree ("niche","template","version");--> statement-breakpoint
CREATE INDEX "ix_templates_waiting_version_id" ON "templates" USING btree ("waiting_version_id");--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "uq_template_versions_template_id_number" UNIQUE("template_id","number");--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "ck_template_versions_origin" CHECK (("origin")::text = ANY ((ARRAY['default'::character varying, 'edit'::character varying, 'restore'::character varying, 'ai'::character varying, 'import'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "ck_templates_kind" CHECK (("kind")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'dm'::character varying, 'post'::character varying, 'prompt'::character varying])::text[]));
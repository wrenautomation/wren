CREATE TABLE "pipeline"."shape_drafts" (
	"id" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"moves" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"state" varchar(8) DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_version" integer,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"drop_reason" text,
	CONSTRAINT "pk_shape_drafts" PRIMARY KEY("id"),
	CONSTRAINT "ck_shape_drafts_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'proposed'::character varying, 'applied'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pipeline"."shape_mirrors" (
	"version" integer NOT NULL,
	"repo" text NOT NULL,
	"path" text NOT NULL,
	"sha" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_shape_mirrors" PRIMARY KEY("version")
);
--> statement-breakpoint
CREATE TABLE "pipeline"."shape_tags" (
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_shape_tags" PRIMARY KEY("name")
);
--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ADD COLUMN "draft" varchar(40);--> statement-breakpoint
ALTER TABLE "pipeline"."shape_drafts" ADD CONSTRAINT "fk_shape_drafts_base_shape_versions" FOREIGN KEY ("base") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."shape_drafts" ADD CONSTRAINT "fk_shape_drafts_applied_version_shape_versions" FOREIGN KEY ("applied_version") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."shape_mirrors" ADD CONSTRAINT "fk_shape_mirrors_version_shape_versions" FOREIGN KEY ("version") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."shape_tags" ADD CONSTRAINT "fk_shape_tags_version_shape_versions" FOREIGN KEY ("version") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_shape_drafts_base" ON "pipeline"."shape_drafts" USING btree ("base");--> statement-breakpoint
CREATE INDEX "ix_shape_drafts_applied_version" ON "pipeline"."shape_drafts" USING btree ("applied_version");--> statement-breakpoint
CREATE INDEX "ix_shape_tags_version" ON "pipeline"."shape_tags" USING btree ("version");--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ADD CONSTRAINT "fk_shape_versions_draft_shape_drafts" FOREIGN KEY ("draft") REFERENCES "pipeline"."shape_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_shape_versions_draft" ON "pipeline"."shape_versions" USING btree ("draft");--> statement-breakpoint
-- A tag is never moved or removed, as a version is not (`pipeline.never_edited`, 0295).
CREATE TRIGGER "shape_tags_never_edited" BEFORE UPDATE OR DELETE ON "pipeline"."shape_tags" FOR EACH ROW EXECUTE FUNCTION "pipeline"."never_edited"();

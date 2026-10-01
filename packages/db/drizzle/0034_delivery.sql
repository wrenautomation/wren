CREATE SCHEMA "delivery";
--> statement-breakpoint
CREATE TABLE "delivery"."asks" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"milestone_id" integer,
	"text" text NOT NULL,
	"due_on" date,
	"answer" text,
	"file_key" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_asks" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "delivery"."deliverables" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"milestone_id" integer,
	"title" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"url" text,
	"file_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_id" integer,
	"status" varchar(8) DEFAULT 'waiting' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_deliverables" PRIMARY KEY("id"),
	CONSTRAINT "ck_deliverables_kind" CHECK (("kind")::text = ANY ((ARRAY['file'::character varying, 'link'::character varying, 'loom'::character varying, 'doc'::character varying])::text[])),
	CONSTRAINT "ck_deliverables_status" CHECK (("status")::text = ANY ((ARRAY['waiting'::character varying, 'approved'::character varying, 'changes'::character varying])::text[])),
	CONSTRAINT "ck_deliverables_where" CHECK ("delivery"."deliverables"."url" is not null or "delivery"."deliverables"."file_key" is not null)
);
--> statement-breakpoint
CREATE TABLE "delivery"."engagements" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"offer_id" varchar(64) NOT NULL,
	"starts_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_engagements" PRIMARY KEY("id"),
	CONSTRAINT "ck_engagements_status" CHECK (("status")::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying, 'done'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "delivery"."milestones" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"planned_from" date NOT NULL,
	"planned_to" date,
	"due_on" date,
	"done_on" date,
	"slip_reason" text,
	"promised" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "pk_milestones" PRIMARY KEY("id"),
	CONSTRAINT "uq_milestones_key" UNIQUE("engagement_id","key")
);
--> statement-breakpoint
CREATE TABLE "delivery"."results" (
	"engagement_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" numeric NOT NULL,
	"note" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_results" PRIMARY KEY("engagement_id","key")
);
--> statement-breakpoint
CREATE TABLE "delivery"."updates" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"milestone_id" integer,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_updates" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "delivery"."asks" ADD CONSTRAINT "fk_asks_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."asks" ADD CONSTRAINT "fk_asks_milestone" FOREIGN KEY ("milestone_id") REFERENCES "delivery"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."deliverables" ADD CONSTRAINT "fk_deliverables_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."deliverables" ADD CONSTRAINT "fk_deliverables_milestone" FOREIGN KEY ("milestone_id") REFERENCES "delivery"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."deliverables" ADD CONSTRAINT "fk_deliverables_previous" FOREIGN KEY ("previous_id") REFERENCES "delivery"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."engagements" ADD CONSTRAINT "fk_engagements_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."milestones" ADD CONSTRAINT "fk_milestones_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."results" ADD CONSTRAINT "fk_results_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."updates" ADD CONSTRAINT "fk_updates_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."updates" ADD CONSTRAINT "fk_updates_milestone" FOREIGN KEY ("milestone_id") REFERENCES "delivery"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_asks_engagement" ON "delivery"."asks" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "ix_asks_milestone" ON "delivery"."asks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "ix_deliverables_engagement" ON "delivery"."deliverables" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "ix_deliverables_milestone" ON "delivery"."deliverables" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "ix_deliverables_previous" ON "delivery"."deliverables" USING btree ("previous_id");--> statement-breakpoint
CREATE INDEX "ix_engagements_client" ON "delivery"."engagements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "ix_updates_engagement" ON "delivery"."updates" USING btree ("engagement_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_updates_milestone" ON "delivery"."updates" USING btree ("milestone_id");
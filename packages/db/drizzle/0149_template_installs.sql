CREATE TABLE "workflow_installs" (
	"id" serial NOT NULL,
	"client" varchar(40) NOT NULL,
	"template" varchar(64) NOT NULL,
	"workflow" varchar(64) NOT NULL,
	"version" varchar(16) NOT NULL,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"applied" jsonb NOT NULL,
	"hook" uuid,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"asked_by" text,
	"asked_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"removed_by" text,
	"removed_at" timestamp with time zone,
	CONSTRAINT "pk_workflow_installs" PRIMARY KEY("id"),
	CONSTRAINT "uq_workflow_installs_client_template" UNIQUE("client","template"),
	CONSTRAINT "ck_workflow_installs_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'waiting'::character varying, 'live'::character varying, 'off'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "hooks" ADD COLUMN "open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_installs" ADD CONSTRAINT "fk_workflow_installs_client_clients" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_installs" ADD CONSTRAINT "fk_workflow_installs_hook_hooks" FOREIGN KEY ("hook") REFERENCES "public"."hooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_workflow_installs_hook" ON "workflow_installs" USING btree ("hook");
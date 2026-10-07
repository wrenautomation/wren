CREATE TABLE "workflow_templates" (
	"id" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"workflow" varchar(64) NOT NULL,
	"edits" jsonb,
	"from_client" varchar(40),
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workflow_templates" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "fk_workflow_templates_from_client_clients" FOREIGN KEY ("from_client") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_workflow_templates_from_client" ON "workflow_templates" USING btree ("from_client");
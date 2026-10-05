CREATE TABLE "workflow_saves" (
	"id" serial NOT NULL,
	"client" varchar(40),
	"workflow" varchar(64) NOT NULL,
	"edits" jsonb,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workflow_saves" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE INDEX "ix_workflow_saves_client_workflow" ON "workflow_saves" USING btree ("client","workflow","id");
CREATE TABLE "delivery"."comments" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"update_id" integer,
	"deliverable_id" integer,
	"author" text NOT NULL,
	"from_wren" boolean NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_comments" PRIMARY KEY("id"),
	CONSTRAINT "ck_comments_on" CHECK (num_nonnulls("delivery"."comments"."update_id", "delivery"."comments"."deliverable_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "delivery"."comments" ADD CONSTRAINT "fk_comments_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."comments" ADD CONSTRAINT "fk_comments_update" FOREIGN KEY ("update_id") REFERENCES "delivery"."updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."comments" ADD CONSTRAINT "fk_comments_deliverable" FOREIGN KEY ("deliverable_id") REFERENCES "delivery"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_comments_update" ON "delivery"."comments" USING btree ("update_id");--> statement-breakpoint
CREATE INDEX "ix_comments_deliverable" ON "delivery"."comments" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "ix_comments_engagement" ON "delivery"."comments" USING btree ("engagement_id","created_at");
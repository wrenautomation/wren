CREATE TABLE "access_asks" (
	"id" serial NOT NULL,
	"email" text NOT NULL,
	"client" varchar(40) NOT NULL,
	"verbs" text[] NOT NULL,
	"apps" text[],
	"channels" text[],
	"record" text,
	"until" timestamp with time zone,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"approved" boolean,
	"grant_id" integer,
	CONSTRAINT "pk_access_asks" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial NOT NULL,
	"client" varchar(40) NOT NULL,
	"record" text NOT NULL,
	"title" text,
	"app" varchar(40) NOT NULL,
	"channel" varchar(40),
	"body" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "pk_issues" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "access_asks" ADD CONSTRAINT "fk_access_asks_grant" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_access_asks_grant" ON "access_asks" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "ix_access_asks_open" ON "access_asks" USING btree ("client","decided_at");--> statement-breakpoint
CREATE INDEX "ix_access_asks_email" ON "access_asks" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_issues_record" ON "issues" USING btree ("client","record");--> statement-breakpoint
CREATE INDEX "ix_issues_open" ON "issues" USING btree ("client","resolved_at");
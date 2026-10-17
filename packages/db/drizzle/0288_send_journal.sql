CREATE TABLE "send_journal" (
	"key" varchar(200) NOT NULL,
	"site" varchar(40) NOT NULL,
	"method" varchar(8) NOT NULL,
	"path" text NOT NULL,
	"account" varchar(120),
	"started_at" timestamp with time zone NOT NULL,
	"verdict" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_send_journal" PRIMARY KEY("key")
);
--> statement-breakpoint
CREATE INDEX "ix_send_journal_started" ON "send_journal" USING btree ("started_at");
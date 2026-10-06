CREATE TABLE "client_domains" (
	"hostname" text NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"cf_id" text NOT NULL,
	"status" text NOT NULL,
	"ssl_status" text NOT NULL,
	"records" jsonb NOT NULL,
	"problem" text,
	"added_by" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_client_domains" PRIMARY KEY("hostname")
);
--> statement-breakpoint
ALTER TABLE "client_domains" ADD CONSTRAINT "fk_client_domains_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_client_domains_client" ON "client_domains" USING btree ("client_id");
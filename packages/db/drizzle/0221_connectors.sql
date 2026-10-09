CREATE TABLE "connector_fired" (
	"link_id" integer NOT NULL,
	"key" varchar(160) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_connector_fired" PRIMARY KEY("link_id","key")
);
--> statement-breakpoint
CREATE TABLE "connector_grants" (
	"state" varchar(64) NOT NULL,
	"client" varchar(64) NOT NULL,
	"app" varchar(16) NOT NULL,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "pk_connector_grants" PRIMARY KEY("state"),
	CONSTRAINT "ck_connector_grants_app" CHECK (("app")::text = ANY ((ARRAY['hubspot'::character varying, 'quickbooks'::character varying, 'jobber'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "connector_links" (
	"id" serial NOT NULL,
	"client" varchar(64) NOT NULL,
	"app" varchar(16) NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"name" text,
	"scopes" text NOT NULL,
	"token_ref" varchar(64) NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(12) DEFAULT 'connected' NOT NULL,
	"why" text,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"people" integer DEFAULT 0 NOT NULL,
	"fired" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" varchar(320) NOT NULL,
	CONSTRAINT "pk_connector_links" PRIMARY KEY("id"),
	CONSTRAINT "uq_connector_links_account" UNIQUE("client","app","external_id"),
	CONSTRAINT "ck_connector_links_app" CHECK (("app")::text = ANY ((ARRAY['hubspot'::character varying, 'quickbooks'::character varying, 'jobber'::character varying])::text[])),
	CONSTRAINT "ck_connector_links_state" CHECK (("state")::text = ANY ((ARRAY['connected'::character varying, 'broken'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "connector_fired" ADD CONSTRAINT "fk_connector_fired_link" FOREIGN KEY ("link_id") REFERENCES "public"."connector_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_connector_grants_client" ON "connector_grants" USING btree ("client");
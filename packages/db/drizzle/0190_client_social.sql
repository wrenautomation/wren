CREATE TABLE "social_connections" (
	"id" serial NOT NULL,
	"client" varchar(64) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"account_id" integer NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"name" text,
	"handle" varchar(120),
	"scopes" text NOT NULL,
	"token_ref" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(12) DEFAULT 'connected' NOT NULL,
	"why" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	CONSTRAINT "pk_social_connections" PRIMARY KEY("id"),
	CONSTRAINT "uq_social_connections_account" UNIQUE("client","platform","external_id"),
	CONSTRAINT "ck_social_connections_platform" CHECK (("platform")::text = ANY ((ARRAY['facebook'::character varying, 'instagram'::character varying, 'linkedin'::character varying, 'youtube'::character varying, 'x'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[])),
	CONSTRAINT "ck_social_connections_state" CHECK (("state")::text = ANY ((ARRAY['connected'::character varying, 'broken'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "social_grants" (
	"state" varchar(64) NOT NULL,
	"client" varchar(64) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"verifier" varchar(128),
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "pk_social_grants" PRIMARY KEY("state"),
	CONSTRAINT "ck_social_grants_platform" CHECK (("platform")::text = ANY ((ARRAY['facebook'::character varying, 'instagram'::character varying, 'linkedin'::character varying, 'youtube'::character varying, 'x'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "reach_contacts" DROP CONSTRAINT "ck_reach_contacts_platform";--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "fk_social_connections_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_social_connections_client" ON "social_connections" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_social_grants_client" ON "social_grants" USING btree ("client");--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD CONSTRAINT "ck_reach_contacts_platform" CHECK (("platform")::text = ANY ((ARRAY['reddit'::character varying, 'linkedin'::character varying, 'facebook'::character varying, 'instagram'::character varying, 'x'::character varying])::text[]));
CREATE TABLE "delivery"."access_requests" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"system" text NOT NULL,
	"scope" text NOT NULL,
	"why" text NOT NULL,
	"revoke" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"note" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_access_requests" PRIMARY KEY("id"),
	CONSTRAINT "ck_access_requests_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'granted'::character varying, 'declined'::character varying, 'revoked'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "delivery"."agreements" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"version" varchar(16) NOT NULL,
	"terms" jsonb NOT NULL,
	"body" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signer_name" text,
	"signer_title" text,
	"signer_email" text,
	"signed_at" timestamp with time zone,
	"signed_ip" text,
	"signed_agent" text,
	"mailed_at" timestamp with time zone,
	CONSTRAINT "pk_agreements" PRIMARY KEY("id"),
	CONSTRAINT "uq_agreements_engagement" UNIQUE("engagement_id"),
	CONSTRAINT "ck_agreements_signed" CHECK (("delivery"."agreements"."signed_at" is null) = ("delivery"."agreements"."signer_name" is null) and ("delivery"."agreements"."signed_at" is null) = ("delivery"."agreements"."signer_email" is null))
);
--> statement-breakpoint
ALTER TABLE "delivery"."engagements" DROP CONSTRAINT "ck_engagements_status";--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD COLUMN "setup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery"."access_requests" ADD CONSTRAINT "fk_access_requests_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."agreements" ADD CONSTRAINT "fk_agreements_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_access_requests_engagement" ON "delivery"."access_requests" USING btree ("engagement_id");--> statement-breakpoint
ALTER TABLE "delivery"."engagements" ADD CONSTRAINT "ck_engagements_status" CHECK (("status")::text = ANY ((ARRAY['onboarding'::character varying, 'active'::character varying, 'paused'::character varying, 'done'::character varying])::text[]));
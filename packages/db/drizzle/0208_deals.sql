CREATE TABLE "deal_moves" (
	"id" bigserial NOT NULL,
	"deal" uuid NOT NULL,
	"from" varchar(40),
	"to" varchar(40) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" text NOT NULL,
	CONSTRAINT "pk_deal_moves" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "deal_pipelines" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"name" varchar(80) NOT NULL,
	"stages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_deal_pipelines" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"pipeline" uuid NOT NULL,
	"stage" varchar(40) NOT NULL,
	"status" varchar(4) DEFAULT 'open' NOT NULL,
	"name" varchar(200) NOT NULL,
	"value_cents" integer,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" varchar(20),
	"source" varchar(8) DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"owner" text,
	"note" text,
	"next_on" date,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_deals" PRIMARY KEY("id"),
	CONSTRAINT "ck_deals_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'won'::character varying, 'lost'::character varying])::text[])),
	CONSTRAINT "ck_deals_source" CHECK (("source")::text = ANY ((ARRAY['manual'::character varying, 'form'::character varying, 'text'::character varying, 'booking'::character varying, 'call'::character varying])::text[])),
	CONSTRAINT "ck_deals_value" CHECK ("deals"."value_cents" is null or "deals"."value_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "ck_events_kind";--> statement-breakpoint
ALTER TABLE "deal_moves" ADD CONSTRAINT "fk_deal_moves_deal" FOREIGN KEY ("deal") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pipelines" ADD CONSTRAINT "fk_deal_pipelines_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "fk_deals_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "fk_deals_pipeline" FOREIGN KEY ("pipeline") REFERENCES "public"."deal_pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_deal_moves_deal_at" ON "deal_moves" USING btree ("deal","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deal_pipelines_name" ON "deal_pipelines" USING btree (coalesce("client", ''),"name");--> statement-breakpoint
CREATE INDEX "ix_deals_client_status" ON "deals" USING btree ("client","status");--> statement-breakpoint
CREATE INDEX "ix_deals_pipeline_stage" ON "deals" USING btree ("pipeline","stage");--> statement-breakpoint
CREATE INDEX "ix_deals_source" ON "deals" USING btree ("source","source_ref");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "ck_events_kind" CHECK (("kind")::text = ANY ((ARRAY['firm'::character varying, 'person'::character varying, 'lead'::character varying, 'reply'::character varying, 'call'::character varying, 'form'::character varying, 'post'::character varying, 'video'::character varying, 'client'::character varying, 'invoice'::character varying, 'mail'::character varying, 'comment'::character varying, 'item'::character varying, 'account'::character varying, 'deal'::character varying])::text[]));
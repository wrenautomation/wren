CREATE TABLE "webhook_attempts" (
	"id" serial NOT NULL,
	"delivery" uuid NOT NULL,
	"n" integer NOT NULL,
	"status" integer,
	"latency_ms" integer NOT NULL,
	"response" text,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_webhook_attempts" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"subscription" uuid NOT NULL,
	"event" varchar(40) NOT NULL,
	"event_id" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"state" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" integer,
	"latency_ms" integer,
	"response" text,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone,
	CONSTRAINT "pk_webhook_deliveries" PRIMARY KEY("id"),
	CONSTRAINT "uq_webhook_deliveries_event" UNIQUE("subscription","event_id"),
	CONSTRAINT "ck_webhook_deliveries_state" CHECK (("state")::text = ANY ((ARRAY['pending'::character varying, 'delivered'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"prev_secret" text,
	"prev_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "pk_webhook_subscriptions" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "delivery"."flags" DROP CONSTRAINT "ck_flags_source";--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "fk_webhook_attempts_delivery_webhook_deliveries" FOREIGN KEY ("delivery") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_subscription_webhook_subscriptions" FOREIGN KEY ("subscription") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "fk_webhook_subscriptions_client_clients" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_webhook_attempts_delivery" ON "webhook_attempts" USING btree ("delivery","n");--> statement-breakpoint
CREATE INDEX "ix_webhook_deliveries_subscription_at" ON "webhook_deliveries" USING btree ("subscription","at");--> statement-breakpoint
CREATE INDEX "ix_webhook_subscriptions_client" ON "webhook_subscriptions" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_events_failed" ON "events" USING btree ("workflow") WHERE error is not null;--> statement-breakpoint
ALTER TABLE "delivery"."flags" ADD CONSTRAINT "ck_flags_source" CHECK (("source")::text = ANY ((ARRAY['delivery'::character varying, 'health'::character varying, 'workflows'::character varying, 'person'::character varying])::text[]));
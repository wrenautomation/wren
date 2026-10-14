ALTER TABLE "pay_events" DROP CONSTRAINT "ck_pay_events_result";--> statement-breakpoint
ALTER TABLE "pay_links" DROP CONSTRAINT "ck_pay_links_status";--> statement-breakpoint
ALTER TABLE "pay_events" ALTER COLUMN "result" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "pay_links" ALTER COLUMN "status" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "pay_links" ALTER COLUMN "status" SET DEFAULT 'waiting';--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "intent" varchar(80);--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "dispute" varchar(8);--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "dispute_at" bigint;--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "told" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_pay_links_intent" ON "pay_links" USING btree ("intent");--> statement-breakpoint
ALTER TABLE "pay_events" ADD CONSTRAINT "ck_pay_events_result" CHECK (("result")::text = ANY ((ARRAY['paid'::character varying, 'processing'::character varying, 'unpaid'::character varying, 'refunded'::character varying, 'disputed'::character varying, 'stale'::character varying, 'unknown'::character varying, 'ignored'::character varying, 'drift'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "pay_links" ADD CONSTRAINT "ck_pay_links_dispute" CHECK (("dispute")::text = ANY ((ARRAY['open'::character varying, 'won'::character varying, 'lost'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "pay_links" ADD CONSTRAINT "ck_pay_links_refunded" CHECK ("pay_links"."refunded_cents" >= 0);--> statement-breakpoint
ALTER TABLE "pay_links" ADD CONSTRAINT "ck_pay_links_status" CHECK (("status")::text = ANY ((ARRAY['waiting'::character varying, 'sending'::character varying, 'sent'::character varying, 'processing'::character varying, 'unpaid'::character varying, 'paid'::character varying, 'refunded'::character varying, 'declined'::character varying, 'failed'::character varying])::text[]));
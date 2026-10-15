ALTER TABLE "delivery"."invoices" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD COLUMN "dispute" varchar(8);--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD CONSTRAINT "ck_invoices_dispute" CHECK (("dispute")::text = ANY ((ARRAY['open'::character varying, 'won'::character varying, 'lost'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD CONSTRAINT "ck_invoices_refunded" CHECK ("delivery"."invoices"."refunded_cents" between 0 and "delivery"."invoices"."cents");
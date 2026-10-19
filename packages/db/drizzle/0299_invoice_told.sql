ALTER TABLE "delivery"."invoices" ADD COLUMN "told" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- History never fires: every change an invoice already reached counts as told.
UPDATE "delivery"."invoices" SET "told" = jsonb_strip_nulls(jsonb_build_object(
  'invoiced', CASE WHEN "status" <> 'void' THEN 'seed' END,
  'paid', CASE WHEN "status" = 'paid' THEN 'seed' END,
  'refunded', CASE WHEN "refunded_cents" > 0 THEN 'seed' END,
  'late', CASE WHEN "status" = 'open' AND "due_on" < current_date THEN 'seed' END));

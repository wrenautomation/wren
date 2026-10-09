ALTER TABLE "delivery"."invoices" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Invoices from before lines: one line, what they were for.
UPDATE "delivery"."invoices" SET "lines" = jsonb_build_array(jsonb_build_object('what', "description", 'cents', "cents"));

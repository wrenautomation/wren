ALTER TABLE "books"."bill_payments" DROP CONSTRAINT "uq_bill_payments_key";--> statement-breakpoint
ALTER TABLE "books"."bill_payments" ALTER COLUMN "invoice_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books"."bill_payments" ADD CONSTRAINT "uq_bill_payments_key" UNIQUE NULLS NOT DISTINCT("vendor_id","invoice_number","key");
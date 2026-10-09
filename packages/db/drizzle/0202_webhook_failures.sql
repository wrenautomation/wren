ALTER TABLE "webhook_deliveries" ADD COLUMN "next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "disabled_why" text;
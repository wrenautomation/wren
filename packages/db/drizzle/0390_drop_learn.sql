-- Learn retired (WA-1317); William's yes 11-11 (WA-1318). Backup: jsonl per table, off repo. CASCADE takes the items_document trigger function.
DROP VIEW "learn"."breakdown_records";--> statement-breakpoint
DROP VIEW "learn"."hook_records";--> statement-breakpoint
DROP VIEW "learn"."item_records";--> statement-breakpoint
DROP VIEW "learn"."saved_records";--> statement-breakpoint
DROP VIEW "learn"."source_records";--> statement-breakpoint
DROP VIEW "learn"."standards";--> statement-breakpoint
DROP TABLE "learn"."ads" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."alert_picks" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."alerts" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."breakdowns" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."checks" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."collections" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."digests" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."item_tags" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."items" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."settings" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."readers" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."seen" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."sop_sources" CASCADE;--> statement-breakpoint
DROP TABLE "learn"."sources" CASCADE;--> statement-breakpoint
DROP SCHEMA "learn" CASCADE;

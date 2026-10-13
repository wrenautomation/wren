-- Copy experiments retired (2026-10-13, William): the email variants system goes. Its rows stay
-- in the lake (wren_lake, never expired). Views first, the dependent one before its source.
DROP VIEW "public"."email_candidate_records";--> statement-breakpoint
DROP VIEW "public"."email_experiment_journal";--> statement-breakpoint
DROP VIEW "public"."email_experiment_records";--> statement-breakpoint
DROP VIEW "public"."email_allele_records";--> statement-breakpoint
DROP TABLE "experiment_alleles" CASCADE;--> statement-breakpoint
DROP TABLE "experiment_journal" CASCADE;--> statement-breakpoint
DROP TABLE "experiment_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "experiments" CASCADE;--> statement-breakpoint
DROP INDEX "ix_template_versions_experiment_id";--> statement-breakpoint
ALTER TABLE "template_versions" DROP COLUMN "parent_version";--> statement-breakpoint
ALTER TABLE "template_versions" DROP COLUMN "experiment_id";

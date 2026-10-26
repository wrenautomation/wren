-- journeys -> instances (ingestion engine, phase 1). A rename keeps every row, the audit
-- and segment triggers, the deals' links and the views over it (bound by oid, they print the new
-- name); each row so far is about a person.
ALTER TABLE "pipeline"."journeys" RENAME TO "instances";--> statement-breakpoint
ALTER TABLE "pipeline"."instances" RENAME CONSTRAINT "pk_journeys" TO "pk_instances";--> statement-breakpoint
ALTER TABLE "pipeline"."instances" RENAME CONSTRAINT "ck_journeys_status" TO "ck_instances_status";--> statement-breakpoint
ALTER TABLE "pipeline"."instances" RENAME CONSTRAINT "fk_journeys_profile_id_profiles" TO "fk_instances_profile_id_profiles";--> statement-breakpoint
ALTER TABLE "pipeline"."instances" RENAME CONSTRAINT "fk_journeys_shape_version" TO "fk_instances_shape_version";--> statement-breakpoint
ALTER TABLE "pipeline"."deals" RENAME CONSTRAINT "fk_deals_journey_journeys" TO "fk_deals_journey_instances";--> statement-breakpoint
ALTER TABLE "pipeline"."journey_research" RENAME CONSTRAINT "fk_journey_research_journey_journeys" TO "fk_journey_research_journey_instances";--> statement-breakpoint
ALTER INDEX "pipeline"."ix_journeys_profile_status" RENAME TO "ix_instances_profile_status";--> statement-breakpoint
ALTER INDEX "pipeline"."ix_journeys_shape_version" RENAME TO "ix_instances_shape_version";--> statement-breakpoint
ALTER INDEX "pipeline"."uq_journeys_legacy_deal" RENAME TO "uq_instances_legacy_deal";--> statement-breakpoint
ALTER TRIGGER "journeys_segments_wake" ON "pipeline"."instances" RENAME TO "instances_segments_wake";--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ADD COLUMN "subject_kind" varchar(8) DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ADD COLUMN "document_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ADD CONSTRAINT "fk_instances_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ADD CONSTRAINT "ck_instances_subject_kind" CHECK (("subject_kind")::text = ANY ((ARRAY['person'::character varying, 'document'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "pipeline"."instances" ADD CONSTRAINT "ck_instances_subject" CHECK ((subject_kind = 'person' and profile_id is not null and document_id is null) or (subject_kind = 'document' and document_id is not null and profile_id is null));--> statement-breakpoint
DROP INDEX "pipeline"."uq_journeys_open";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_instances_open_person" ON "pipeline"."instances" USING btree ("profile_id") WHERE status = 'open' and subject_kind = 'person';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_instances_open_document" ON "pipeline"."instances" USING btree ("document_id","entry") WHERE status = 'open' and subject_kind = 'document';

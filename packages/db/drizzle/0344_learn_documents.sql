ALTER TABLE "documents" DROP CONSTRAINT "ck_documents_documentkind";--> statement-breakpoint
ALTER TABLE "findings" DROP CONSTRAINT "ck_findings_findingkind";--> statement-breakpoint
ALTER TABLE "findings" DROP CONSTRAINT "ck_findings_one_subject";--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "question" varchar(80);--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "proof" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "by" varchar(8);--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "document_id" integer;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "fk_items_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_items_document_id" ON "learn"."items" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_documentkind" CHECK (("kind")::text = ANY ((ARRAY['webpage'::character varying, 'pdf'::character varying, 'snippet'::character varying, 'profile'::character varying, 'video'::character varying, 'post'::character varying, 'audio'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_by" CHECK (("by")::text = ANY ((ARRAY['model'::character varying, 'code'::character varying, 'hand'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_findingkind" CHECK (("kind")::text = ANY ((ARRAY['job_change'::character varying, 'still_there'::character varying, 'left'::character varying, 'hiring'::character varying, 'post'::character varying, 'news'::character varying, 'profile'::character varying, 'stack'::character varying, 'site_change'::character varying, 'talk'::character varying, 'demand'::character varying, 'fact'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_one_subject" CHECK (CASE WHEN kind = 'fact' THEN person_id IS NULL AND company_id IS NULL AND document_id IS NOT NULL AND question IS NOT NULL ELSE (person_id IS NULL) <> (company_id IS NULL) END);
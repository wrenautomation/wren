ALTER TABLE "decision_calls" DROP CONSTRAINT "ck_decision_calls_kind";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "ck_decisions_kind";--> statement-breakpoint
ALTER TABLE "decision_calls" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "decision_calls" ADD CONSTRAINT "ck_decision_calls_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying, 'lead_fit'::character varying, 'learn_fact'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "ck_decisions_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying, 'lead_fit'::character varying, 'learn_fact'::character varying])::text[]));
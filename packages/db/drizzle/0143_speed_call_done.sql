ALTER TABLE "speed_runs" ADD COLUMN "call_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "call_outcome" varchar(16);--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "call_done_by" text;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD CONSTRAINT "ck_speed_runs_call_outcome" CHECK (("call_outcome")::text = ANY ((ARRAY['reached'::character varying, 'voicemail'::character varying, 'no_answer'::character varying, 'wrong_number'::character varying])::text[]));
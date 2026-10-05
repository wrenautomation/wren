ALTER TABLE "sender_pauses" DROP CONSTRAINT "ck_sender_pauses_pausesource";--> statement-breakpoint
-- Rows before this were all copies of the opener.
ALTER TABLE "placement_checks" ADD COLUMN "kind" varchar(8) DEFAULT 'real' NOT NULL;--> statement-breakpoint
ALTER TABLE "placement_checks" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "placement_checks" ADD COLUMN "auth" jsonb;--> statement-breakpoint
ALTER TABLE "placement_checks" DROP CONSTRAINT "pk_placement_checks";
--> statement-breakpoint
ALTER TABLE "placement_checks" ADD CONSTRAINT "pk_placement_checks" PRIMARY KEY("sender","seed","day","kind");--> statement-breakpoint
ALTER TABLE "placement_checks" ADD CONSTRAINT "ck_placement_checks_kind" CHECK (("kind")::text = ANY ((ARRAY['plain'::character varying, 'real'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "sender_pauses" ADD CONSTRAINT "ck_sender_pauses_pausesource" CHECK (("source")::text = ANY ((ARRAY['kill_switch'::character varying, 'operator'::character varying, 'placement'::character varying])::text[]));
ALTER TABLE "clients" ADD COLUMN "approver" varchar(8) DEFAULT 'wren' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "ck_clients_approver" CHECK (("approver")::text = ANY ((ARRAY['wren'::character varying, 'client'::character varying, 'either'::character varying])::text[]));--> statement-breakpoint
-- Clients that exist now keep what they had: both sides approve. New clients start with Wren's team.
UPDATE "clients" SET "approver" = 'either';

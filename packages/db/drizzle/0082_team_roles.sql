ALTER TABLE "client_members" DROP CONSTRAINT "ck_client_members_role";--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "role" varchar(16) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "clients" text[];--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "ck_client_members_role" CHECK (("role")::text = ANY ((ARRAY['owner'::character varying, 'member'::character varying, 'viewer'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "ck_operators_role" CHECK (("role")::text = ANY ((ARRAY['admin'::character varying, 'operator'::character varying, 'viewer'::character varying])::text[]));
-- Verdicts are shared on main for clients' walks (designs/2026-10-04-outbound-per-client.md, O1): such a row names only its address.
ALTER TABLE "verifications" DROP CONSTRAINT "ck_verifications_attributed";--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "ck_verifications_attributed" CHECK ((lead_id IS NOT NULL) OR (contact_candidate_id IS NOT NULL) OR (email IS NOT NULL));
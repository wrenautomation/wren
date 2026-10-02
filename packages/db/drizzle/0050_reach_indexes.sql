CREATE INDEX IF NOT EXISTS "ix_reach_contacts_person_id" ON "reach_contacts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_reach_contacts_account_id" ON "reach_contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_reach_messages_account_id" ON "reach_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_reach_messages_run_id" ON "reach_messages" USING btree ("run_id");
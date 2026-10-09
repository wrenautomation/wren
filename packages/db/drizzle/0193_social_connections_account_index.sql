DROP INDEX "ix_social_connections_client";--> statement-breakpoint
CREATE INDEX "ix_social_connections_account" ON "social_connections" USING btree ("account_id");
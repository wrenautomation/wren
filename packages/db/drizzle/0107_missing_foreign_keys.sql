ALTER TABLE "hooks" ADD CONSTRAINT "fk_hooks_client_clients" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_saves" ADD CONSTRAINT "fk_workflow_saves_client_clients" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_alleles" ADD CONSTRAINT "fk_experiment_alleles_journal_id_experiment_journal" FOREIGN KEY ("journal_id") REFERENCES "public"."experiment_journal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_push_subscriptions" ADD CONSTRAINT "fk_sms_push_subscriptions_operator_operators" FOREIGN KEY ("operator") REFERENCES "public"."operators"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_hooks_client" ON "hooks" USING btree ("client");--> statement-breakpoint
CREATE INDEX "ix_experiment_alleles_journal_id" ON "experiment_alleles" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ix_sms_push_subscriptions_operator" ON "sms_push_subscriptions" USING btree ("operator");
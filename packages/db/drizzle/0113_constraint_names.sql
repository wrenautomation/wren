-- Drizzle's default names become pk_<table> and fk_<table>_<col>_<parent>. A rename keeps the
-- index and every dependent foreign key, so no table is rebuilt or scanned.
-- The audit log's three keys are renamed by installAudit (those tables are made there).
ALTER TABLE "content_drafts" RENAME CONSTRAINT "content_drafts_pkey" TO "pk_content_drafts";--> statement-breakpoint
ALTER TABLE "content_ideas" RENAME CONSTRAINT "content_ideas_pkey" TO "pk_content_ideas";--> statement-breakpoint
ALTER TABLE "content_metrics" RENAME CONSTRAINT "content_metrics_pkey" TO "pk_content_metrics";--> statement-breakpoint
ALTER TABLE "content_playbooks" RENAME CONSTRAINT "content_playbooks_pkey" TO "pk_content_playbooks";--> statement-breakpoint
ALTER TABLE "ad_launches" RENAME CONSTRAINT "ad_launches_pkey" TO "pk_ad_launches";--> statement-breakpoint
ALTER TABLE "sms_contacts" RENAME CONSTRAINT "sms_contacts_pkey" TO "pk_sms_contacts";--> statement-breakpoint
ALTER TABLE "sms_events" RENAME CONSTRAINT "sms_events_pkey" TO "pk_sms_events";--> statement-breakpoint
ALTER TABLE "sms_messages" RENAME CONSTRAINT "sms_messages_pkey" TO "pk_sms_messages";--> statement-breakpoint
ALTER TABLE "sms_numbers" RENAME CONSTRAINT "sms_numbers_pkey" TO "pk_sms_numbers";--> statement-breakpoint
ALTER TABLE "sms_push_subscriptions" RENAME CONSTRAINT "sms_push_subscriptions_pkey" TO "pk_sms_push_subscriptions";--> statement-breakpoint
ALTER TABLE "sms_templates" RENAME CONSTRAINT "sms_templates_pkey" TO "pk_sms_templates";--> statement-breakpoint
ALTER TABLE "books"."alerts" RENAME CONSTRAINT "alerts_pkey" TO "pk_alerts";--> statement-breakpoint
ALTER TABLE "comments" RENAME CONSTRAINT "comments_pkey" TO "pk_comments";--> statement-breakpoint
ALTER TABLE "reach_accounts" RENAME CONSTRAINT "reach_accounts_pkey" TO "pk_reach_accounts";--> statement-breakpoint
ALTER TABLE "reach_contacts" RENAME CONSTRAINT "reach_contacts_pkey" TO "pk_reach_contacts";--> statement-breakpoint
ALTER TABLE "reach_messages" RENAME CONSTRAINT "reach_messages_pkey" TO "pk_reach_messages";--> statement-breakpoint
ALTER TABLE "reach_templates" RENAME CONSTRAINT "reach_templates_pkey" TO "pk_reach_templates";--> statement-breakpoint
ALTER TABLE "watch"."feeds" RENAME CONSTRAINT "feeds_pkey" TO "pk_feeds";--> statement-breakpoint
ALTER TABLE "watch"."items" RENAME CONSTRAINT "items_pkey" TO "pk_items";--> statement-breakpoint
ALTER TABLE "watch"."mail" RENAME CONSTRAINT "mail_pkey" TO "pk_mail";--> statement-breakpoint
ALTER TABLE "watch"."rules" RENAME CONSTRAINT "rules_pkey" TO "pk_rules";--> statement-breakpoint
ALTER TABLE "content_drafts" RENAME CONSTRAINT "content_drafts_idea_id_content_ideas_id_fk" TO "fk_content_drafts_idea_id_content_ideas";--> statement-breakpoint
ALTER TABLE "content_drafts" RENAME CONSTRAINT "content_drafts_redraft_of_content_drafts_id_fk" TO "fk_content_drafts_redraft_of_content_drafts";--> statement-breakpoint
ALTER TABLE "content_drafts" RENAME CONSTRAINT "content_drafts_playbook_id_content_playbooks_id_fk" TO "fk_content_drafts_playbook_id_content_playbooks";--> statement-breakpoint
ALTER TABLE "content_metrics" RENAME CONSTRAINT "content_metrics_draft_id_content_drafts_id_fk" TO "fk_content_metrics_draft_id_content_drafts";--> statement-breakpoint
ALTER TABLE "watch"."items" RENAME CONSTRAINT "items_feed_id_feeds_id_fk" TO "fk_items_feed_id_feeds";--> statement-breakpoint
ALTER TABLE "watch"."mail" RENAME CONSTRAINT "mail_rule_id_rules_id_fk" TO "fk_mail_rule_id_rules";

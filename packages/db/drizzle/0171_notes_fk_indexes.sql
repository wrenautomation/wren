CREATE INDEX "ix_note_comments_parent" ON "note_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_note_mentions_comment" ON "note_mentions" USING btree ("comment_id");
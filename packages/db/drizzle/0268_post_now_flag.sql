-- 2026-10-15: Post now on a client's drafts (a yes that posts on the next pass, not the next
-- slot) sits behind the `post_now` portal flag. On for the app reviewers' test client only, so a
-- TikTok review screencast can show a post going out in one take; off for everyone else.
-- Turn it on elsewhere with a rule on the flag (Loops, Flags), never by editing this file.
INSERT INTO "flags" ("key", "about", "rules", "created_by")
VALUES (
  'post_now',
  'Post now on a client''s drafts: posts on the next pass instead of the next slot.',
  '[{"variant":"on","clients":["wren_test"]}]'::jsonb,
  'migration 0268'
)
ON CONFLICT ("key") DO NOTHING;

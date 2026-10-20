-- Our posts and comments are platform objects (2026-10-20, brief O2). Every row that names one
-- of our posts or comments now holds an object's ref, by a composite key into `platform_objects`.
-- The data goes first: Reddit posts spelled as fullnames (`t3_`), one object per distinct ref in
-- each role column, then the alias for each bare Reddit spelling and each draft URL. The keys
-- come last, from drizzle. Rows a client already holds are kept; this never fails on an odd
-- spelling (the object takes the spelling as it is, and the next read of it settles the rest).
-- Widths stay: the views read `comments`, so a column cannot change type. `canonRef` caps a ref
-- at 200 instead, so a key cascade fits.
ALTER TABLE "comments" DROP CONSTRAINT "ck_comments_reddit_ref";--> statement-breakpoint
-- 1. Reddit posts as fullnames. A root comment's parent is its post, so it moves with it.
UPDATE "content_drafts" SET "published_id" = 't3_' || lower("published_id")
WHERE "platform" = 'reddit' AND "published_id" IS NOT NULL AND "published_id" !~ '^t3_';--> statement-breakpoint
UPDATE "draft_events" SET "external_id" = 't3_' || lower("external_id")
WHERE "platform" = 'reddit' AND "kind" IN ('post', 'video', 'post_comment') AND "external_id" IS NOT NULL AND "external_id" !~ '^t3_';--> statement-breakpoint
UPDATE "draft_events" SET "external_id" = 't1_' || lower("external_id")
WHERE "platform" = 'reddit' AND "kind" IN ('thread', 'comment') AND "external_id" IS NOT NULL AND "external_id" !~ '^t1_';--> statement-breakpoint
UPDATE "comments" SET "parent" = CASE WHEN "parent" = "post" THEN 't3_' || lower("post") ELSE "parent" END, "post" = 't3_' || lower("post")
WHERE "platform" = 'reddit' AND "post" !~ '^t3_';--> statement-breakpoint
UPDATE "comments" SET "parent" = 't1_' || lower("parent")
WHERE "platform" = 'reddit' AND "parent" !~ '^t[13]_';--> statement-breakpoint
UPDATE "comments" SET "answer_ref" = 't1_' || lower("answer_ref")
WHERE "platform" = 'reddit' AND "answer_ref" IS NOT NULL AND "answer_ref" !~ '^t1_';--> statement-breakpoint
-- A thread kept under both spellings keeps the fullname's row.
DELETE FROM "comment_threads" b USING "comment_threads" t
WHERE b."platform" = 'reddit' AND t."platform" = 'reddit' AND b."post" !~ '^t3_' AND t."post" = 't3_' || lower(b."post");--> statement-breakpoint
UPDATE "comment_threads" SET "post" = 't3_' || lower("post")
WHERE "platform" = 'reddit' AND "post" !~ '^t3_';--> statement-breakpoint
-- A DM or invite has a message id, which is no post or comment: it stays in `meta`.
UPDATE "draft_events" SET "meta" = "meta" || jsonb_build_object('external_id', "external_id"), "external_id" = NULL
WHERE "external_id" IS NOT NULL AND "kind" NOT IN ('post', 'video', 'post_comment', 'thread', 'comment');--> statement-breakpoint
-- 2. One object per distinct ref in each role column. A row that sees more of the object goes
-- first; the first insert of a ref stays.
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "post", "parent", "author", "at")
SELECT DISTINCT ON ("platform", "ref") "platform", "ref", 'comment', NULLIF("url", ''), "post", "parent", NULLIF("author", ''), "at"
FROM "comments" ORDER BY "platform", "ref", "at"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "at")
SELECT DISTINCT ON ("platform", "published_id") "platform", "published_id", 'post', NULLIF("url", ''), "published_at"
FROM "content_drafts" WHERE "published_id" IS NOT NULL ORDER BY "platform", "published_id", "published_at"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "author", "at")
SELECT DISTINCT ON ("platform", "post") "platform", "post", 'post', NULLIF("post_url", ''), NULLIF("post_author", ''), "post_at"
FROM "comment_threads" ORDER BY "platform", "post", "id"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind")
SELECT DISTINCT "platform", "post", 'post' FROM "comments"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "post")
SELECT DISTINCT ON ("platform", "parent") "platform", "parent", 'comment', "post"
FROM "comments" WHERE "parent" <> "post" ORDER BY "platform", "parent", "id"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "post", "parent")
SELECT DISTINCT ON ("platform", "answer_ref") "platform", "answer_ref", 'comment', "post", "ref"
FROM "comments" WHERE "answer_ref" IS NOT NULL ORDER BY "platform", "answer_ref", "id"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind")
SELECT DISTINCT "platform", "post", 'post' FROM "comment_keywords" WHERE "platform" IS NOT NULL AND "post" IS NOT NULL
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "at")
SELECT DISTINCT ON ("platform", "external_id") "platform", "external_id",
  CASE WHEN "kind" IN ('thread', 'comment') THEN 'comment' ELSE 'post' END, NULLIF("url", ''), "at"
FROM "draft_events" WHERE "platform" IS NOT NULL AND "external_id" IS NOT NULL ORDER BY "platform", "external_id", "id"
ON CONFLICT ("platform", "ref") DO NOTHING;--> statement-breakpoint
-- 3. Aliases. A Reddit object is also known by its bare id, and a draft is known by its page, as
-- `normalUrl` spells it: https, no www, no query (a YouTube watch link keeps v), no fragment, no
-- trailing slash. A URL is kept only when it holds the object's own id (the same-object test of
-- `fromUrl`, without its platform rules); a link to a profile or a page is no alias.
INSERT INTO "platform_object_refs" ("platform", "alias", "ref")
SELECT "platform", substr("ref", 4), "ref" FROM "platform_objects"
WHERE "platform" = 'reddit' AND "ref" ~ '^t[13]_.'
ON CONFLICT ("platform", "alias") DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_object_refs" ("platform", "alias", "ref")
SELECT DISTINCT ON (n."platform", n."alias") n."platform", n."alias", n."ref"
FROM (
  SELECT d."platform", d."published_id" AS "ref", d."url" AS "src",
    CASE d."platform" WHEN 'reddit' THEN substr(d."published_id", 4)
      WHEN 'linkedin' THEN coalesce(substring(d."published_id" from '(\d+)$'), d."published_id")
      ELSE d."published_id" END AS "tail",
    'https://' || h."host" || h."path" || CASE
      WHEN h."host" ~ '^(m\.|music\.)?youtube\.com$' AND h."path" = '/watch' AND h."v" IS NOT NULL THEN '?v=' || h."v"
      ELSE '' END AS "alias"
  FROM "content_drafts" d,
  LATERAL (
    SELECT s."hostpath",
      lower(regexp_replace(regexp_replace(split_part(s."hostpath", '/', 1), '^www\.', '', 'i'), ':(443|80)$', '')) AS "host",
      regexp_replace(substr(s."hostpath", length(split_part(s."hostpath", '/', 1)) + 1), '/+$', '') AS "path",
      substring(s."query" from '(?:^|&)v=([^&]*)') AS "v"
    FROM (
      SELECT split_part(split_part(regexp_replace(btrim(d."url"), '^https?://', '', 'i'), '#', 1), '?', 1) AS "hostpath",
        split_part(split_part(regexp_replace(btrim(d."url"), '^https?://', '', 'i'), '#', 1), '?', 2) AS "query"
    ) s
  ) h
  WHERE d."published_id" IS NOT NULL AND d."url" ~* '^https?://'
) n
WHERE n."alias" <> n."ref" AND length(n."alias") <= 1000 AND n."alias" ~ '^https://[^/]+'
  AND strpos(lower(n."src"), lower(n."tail")) > 0
ORDER BY n."platform", n."alias"
ON CONFLICT ("platform", "alias") DO NOTHING;--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "fk_draft_events_platform_external_id_platform_objects" FOREIGN KEY ("platform","external_id") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment_keywords" ADD CONSTRAINT "fk_comment_keywords_platform_post_platform_objects" FOREIGN KEY ("platform","post") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "fk_content_drafts_platform_published_id_platform_objects" FOREIGN KEY ("platform","published_id") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "fk_comment_threads_platform_post_platform_objects" FOREIGN KEY ("platform","post") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_platform_post_platform_objects" FOREIGN KEY ("platform","post") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_platform_parent_platform_objects" FOREIGN KEY ("platform","parent") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_platform_answer_ref_platform_objects" FOREIGN KEY ("platform","answer_ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ix_draft_events_platform_external_id" ON "draft_events" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "ix_comment_keywords_platform_post" ON "comment_keywords" USING btree ("platform","post");--> statement-breakpoint
CREATE INDEX "ix_content_drafts_platform_published_id" ON "content_drafts" USING btree ("platform","published_id");--> statement-breakpoint
CREATE INDEX "ix_comments_platform_post" ON "comments" USING btree ("platform","post");--> statement-breakpoint
CREATE INDEX "ix_comments_platform_parent" ON "comments" USING btree ("platform","parent");--> statement-breakpoint
CREATE INDEX "ix_comments_platform_answer_ref" ON "comments" USING btree ("platform","answer_ref");

-- Every post we may answer and every Facebook group is a platform object (2026-10-20, brief O3).
-- `reddit_threads` gets a platform column (always reddit) and `reach_posts.ref` grows to the width
-- of `platform_objects.ref`. The data goes first: one object for each ref the role columns hold,
-- then an alias for each URL that spells it. Nothing is rewritten: Reddit refs, LinkedIn URNs, X
-- ids and Facebook ids are already the canon spelling (no twins on prod), and a ref migration 0312
-- made keeps its row. This runs on an empty database too. The keys come last, from drizzle.
ALTER TABLE "reddit_threads" ADD COLUMN "platform" varchar(16) DEFAULT 'reddit' NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_posts" ALTER COLUMN "ref" SET DATA TYPE varchar(255);--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "author", "at")
SELECT 'reddit', t."id", 'post', t."url", left(nullif(nullif(t."author", ''), '[deleted]'), 200), t."posted_at"
FROM "reddit_threads" t
ORDER BY t."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind")
SELECT DISTINCT 'reddit', t."target", 'post'
FROM "reddit_threads" t
WHERE t."target" LIKE 't3\_%'
ORDER BY 2
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "post", "parent")
SELECT DISTINCT ON (t."target") 'reddit', t."target", 'comment', t."id", t."id"
FROM "reddit_threads" t
WHERE t."target" IS NOT NULL AND t."target" NOT LIKE 't3\_%'
ORDER BY t."target", t."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "post", "parent", "at")
SELECT DISTINCT ON (t."answer_ref") 'reddit', t."answer_ref", 'comment', t."id", coalesce(t."target", t."id"), t."answered_at"
FROM "reddit_threads" t
WHERE t."answer_ref" IS NOT NULL
ORDER BY t."answer_ref", t."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url", "author", "at")
SELECT p."platform", p."ref", 'post', p."url", left(nullif(coalesce(p."handle", p."author"), ''), 200), p."posted_at"
FROM "reach_posts" p
ORDER BY p."platform", p."ref"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url")
SELECT g."network", g."ref", 'group', g."url"
FROM "social_groups" g
ORDER BY g."network", g."ref"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_objects" ("platform", "ref", "kind", "url")
SELECT s."network", s."ref", 'post', s."url"
FROM "social_posts" s
ORDER BY s."network", s."ref"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "platform_object_refs" ("platform", "alias", "ref")
SELECT DISTINCT ON (s."platform", a."alias") s."platform", a."alias", s."ref"
FROM (
  SELECT 'reddit'::varchar AS "platform", "id" AS "ref", "url" FROM "reddit_threads"
  UNION ALL SELECT "platform", "ref", "url" FROM "reach_posts"
  UNION ALL SELECT "network", "ref", "url" FROM "social_groups"
  UNION ALL SELECT "network", "ref", "url" FROM "social_posts"
) s
CROSS JOIN LATERAL regexp_match(s."url", '^https?://([^/?#:@]+)(:[0-9]+)?([^?#]*)', 'i') AS m(g)
CROSS JOIN LATERAL (
  SELECT 'https://' || lower(regexp_replace((m.g)[1], '^www\.', '', 'i'))
    || CASE WHEN (m.g)[2] IS NULL OR (m.g)[2] IN (':80', ':443') THEN '' ELSE (m.g)[2] END
    || regexp_replace(coalesce((m.g)[3], ''), '/+$', '') AS "alias"
) a
WHERE m.g IS NOT NULL AND a."alias" <> s."ref" AND length(a."alias") <= 1000
  AND (s."platform" <> 'linkedin' OR substring(s."url" from 'urn:li:[a-zA-Z]+:[0-9]+') IS NOT DISTINCT FROM s."ref")
ORDER BY s."platform", a."alias", s."ref"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "social_groups" ADD CONSTRAINT "fk_social_groups_network_ref_platform_objects" FOREIGN KEY ("network","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "fk_social_posts_network_ref_platform_objects" FOREIGN KEY ("network","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD CONSTRAINT "fk_reach_posts_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "fk_reddit_threads_platform_id_platform_objects" FOREIGN KEY ("platform","id") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "fk_reddit_threads_platform_target_platform_objects" FOREIGN KEY ("platform","target") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "fk_reddit_threads_platform_answer_ref_platform_objects" FOREIGN KEY ("platform","answer_ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ix_reddit_threads_platform_target" ON "reddit_threads" USING btree ("platform","target");--> statement-breakpoint
CREATE INDEX "ix_reddit_threads_platform_answer_ref" ON "reddit_threads" USING btree ("platform","answer_ref");--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "ck_reddit_threads_platform" CHECK ("reddit_threads"."platform" = 'reddit');
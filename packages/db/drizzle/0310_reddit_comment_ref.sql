-- One row per Reddit comment (2026-10-20). The content reader kept bare ids ("abc"), the reach
-- inbox kept fullnames ("t1_abc"), so a reply under our post could be kept twice. Fold each pair
-- into the content row, carry the reach twin's answer and history over, then spell every Reddit
-- ref as a fullname and hold it there with a check.
UPDATE "comments" c SET "state" = 'answered', "answer" = r."answer", "answer_ref" = r."answer_ref", "answered_at" = r."answered_at"
FROM "comments" r
WHERE c."platform" = 'reddit' AND r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
  AND r."state" = 'answered' AND c."state" <> 'answered';--> statement-breakpoint
UPDATE "comment_proofs" p SET "item" = 'comment:' || c."id"
FROM "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND p."item" = 'comment:' || r."id"
  AND NOT EXISTS (SELECT 1 FROM "comment_proofs" q WHERE q."item" = 'comment:' || c."id");--> statement-breakpoint
UPDATE "send_attempts" s SET "item" = 'comment:' || c."id"
FROM "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND s."item" = 'comment:' || r."id"
  AND NOT EXISTS (SELECT 1 FROM "send_attempts" q WHERE q."item" = 'comment:' || c."id");--> statement-breakpoint
UPDATE "touches" t SET "answers" = k."id"
FROM "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref",
  "touches" k, "touches" d
WHERE c."platform" = 'reddit' AND k."ref" = 'c:' || c."id" AND d."ref" = 'c:' || r."id"
  AND t."answers" = d."id";--> statement-breakpoint
UPDATE "touches" t SET "ref" = 'ca:' || c."id"
FROM "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND t."ref" = 'ca:' || r."id"
  AND NOT EXISTS (SELECT 1 FROM "touches" q WHERE q."ref" = 'ca:' || c."id");--> statement-breakpoint
DELETE FROM "touches" t
USING "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND t."ref" IN ('c:' || r."id", 'ca:' || r."id");--> statement-breakpoint
DELETE FROM "comment_proofs" p
USING "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND p."item" = 'comment:' || r."id";--> statement-breakpoint
DELETE FROM "send_attempts" s
USING "comments" c JOIN "comments" r ON r."platform" = 'reddit' AND r."ref" = 't1_' || c."ref"
WHERE c."platform" = 'reddit' AND s."item" = 'comment:' || r."id";--> statement-breakpoint
DELETE FROM "comments" r
USING "comments" c
WHERE r."platform" = 'reddit' AND c."platform" = 'reddit' AND r."ref" = 't1_' || c."ref";--> statement-breakpoint
UPDATE "touches" t SET "external_id" = 't1_' || t."external_id"
FROM "comments" c
WHERE c."platform" = 'reddit' AND c."ref" !~ '^t1_' AND t."ref" = 'c:' || c."id"
  AND t."external_id" IS NOT NULL AND t."external_id" !~ '^t1_';--> statement-breakpoint
UPDATE "comments" SET "parent" = 't1_' || "parent"
WHERE "platform" = 'reddit' AND "ref" !~ '^t1_' AND "parent" <> "post" AND "parent" !~ '^t[13]_';--> statement-breakpoint
UPDATE "comments" SET "answer_ref" = 't1_' || "answer_ref"
WHERE "platform" = 'reddit' AND "answer_ref" IS NOT NULL AND "answer_ref" !~ '^t[13]_';--> statement-breakpoint
UPDATE "comments" SET "ref" = 't1_' || "ref" WHERE "platform" = 'reddit' AND "ref" !~ '^t1_';--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_reddit_ref" CHECK (platform <> 'reddit' OR ref ~ '^t1_');

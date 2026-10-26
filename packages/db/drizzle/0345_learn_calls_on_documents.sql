-- Learn items as documents, and decide's Learn kinds on them (designs/2026-10-25-ingestion-engine.md,
-- commit 3b). Every item gets its research `documents` row: the backfill here, then the insert
-- trigger `learn.items_document` for each new one. `learn_worth` becomes `document` (worth -> keep,
-- skip -> drop) and `learn_fact` becomes `finding`; both move from `learn:<item>` to the item's
-- document, `doc:<document>` and `doc:<document>/<path>` (the finding's own key).
DROP VIEW "learn"."standards";--> statement-breakpoint
DROP VIEW "learn"."hook_records";--> statement-breakpoint
DROP VIEW "learn"."breakdown_records";--> statement-breakpoint
ALTER TABLE "decision_calls" DROP CONSTRAINT "ck_decision_calls_kind";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "ck_decisions_kind";--> statement-breakpoint
INSERT INTO "documents" ("url", "kind", "content_hash", "title", "text", "fetch_tier")
SELECT DISTINCT ON (i.url, h.hash) i.url, m.kind, h.hash, i.title, i.text, 'learn'
FROM "learn"."items" i
  CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(i.text, 'UTF8')), 'hex') hash) h
  CROSS JOIN LATERAL (SELECT CASE i.kind::text WHEN 'article' THEN 'webpage' WHEN 'post' THEN 'post'
    WHEN 'episode' THEN 'audio' ELSE 'video' END kind) m
WHERE i.document_id IS NULL
ORDER BY i.url, h.hash, i.id
ON CONFLICT ("url", "content_hash") DO NOTHING;--> statement-breakpoint
UPDATE "learn"."items" i SET "document_id" = d.id
FROM "documents" d
WHERE i.document_id IS NULL AND d.url = i.url
  AND d.content_hash = encode(sha256(convert_to(i.text, 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "learn"."items" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
UPDATE "decisions" d SET
  "kind" = 'document',
  "subject" = 'doc:' || i.document_id,
  "label" = CASE d.label WHEN 'worth' THEN 'keep' WHEN 'skip' THEN 'drop' ELSE d.label END,
  "answers" = CASE WHEN d.answers ? 'pick' THEN jsonb_set(d.answers, '{pick}',
    (d.answers->'pick') - 'choice' - 'probabilities'
    || CASE WHEN d.answers->'pick' ? 'choice' THEN jsonb_build_object('choice',
      CASE d.answers->'pick'->>'choice' WHEN 'worth' THEN 'keep' WHEN 'skip' THEN 'drop'
        ELSE d.answers->'pick'->>'choice' END) ELSE '{}'::jsonb END
    || CASE WHEN d.answers->'pick' ? 'probabilities' THEN jsonb_build_object('probabilities',
      jsonb_strip_nulls(jsonb_build_object('keep', d.answers->'pick'->'probabilities'->'worth',
        'drop', d.answers->'pick'->'probabilities'->'skip'))) ELSE '{}'::jsonb END)
    ELSE d.answers END,
  "ref" = CASE WHEN d.ref LIKE 'learn_worth:learn:' || i.id || ':%'
    THEN 'document:doc:' || i.document_id || substr(d.ref, length('learn_worth:learn:' || i.id) + 1)
    ELSE d.ref END
FROM "learn"."items" i
WHERE d.kind = 'learn_worth' AND d.subject = 'learn:' || i.id;--> statement-breakpoint
UPDATE "decision_calls" c SET
  "kind" = 'document',
  "subject" = 'doc:' || i.document_id,
  "label" = CASE c.label WHEN 'worth' THEN 'keep' WHEN 'skip' THEN 'drop' ELSE c.label END,
  "ref" = replace(c.ref, 'learn_worth', 'document')
FROM "learn"."items" i
WHERE c.kind = 'learn_worth' AND c.subject = 'learn:' || i.id;--> statement-breakpoint
UPDATE "decisions" d SET
  "kind" = CASE WHEN d.subject LIKE 'learn:%/%' THEN 'finding' ELSE 'document' END,
  "subject" = 'doc:' || i.document_id || substr(d.subject, length('learn:' || i.id) + 1)
FROM "learn"."items" i
WHERE d.kind = 'learn_fact' AND split_part(substr(d.subject, 7), '/', 1) = i.id::text;--> statement-breakpoint
UPDATE "decision_calls" c SET
  "kind" = CASE WHEN c.subject LIKE 'learn:%/%' THEN 'finding' ELSE 'document' END,
  "subject" = 'doc:' || i.document_id || substr(c.subject, length('learn:' || i.id) + 1)
FROM "learn"."items" i
WHERE c.kind = 'learn_fact' AND split_part(substr(c.subject, 7), '/', 1) = i.id::text;--> statement-breakpoint
ALTER TABLE "decision_calls" ADD CONSTRAINT "ck_decision_calls_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'document'::character varying, 'lead_fit'::character varying, 'finding'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "ck_decisions_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'document'::character varying, 'lead_fit'::character varying, 'finding'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "learn"."breakdown_records" AS (
    select i.id, i.title, coalesce(i.creator, s.name) creator, coalesce(s.name, 'Saved') source,
      i.source_id, case when i.source_id is null then 'saved' else 'followed' end followed,
      i.type::text type, i.kind::text kind, b.hook_style::text hook_style, b.hook, b.hook_why,
      b.topic, b.facts->>'format' format,
      (select string_agg(case when x.value->>'t' is null then '' else
          '[' || ((x.value->>'t')::int / 60) || ':' || lpad(((x.value->>'t')::int % 60)::text, 2, '0') || '] ' end
          || (x.value->>'beat'), chr(10) order by x.ordinality)
        from jsonb_array_elements(b.beats) with ordinality x) beats,
      b.cta_kind::text cta_kind, b.cta,
      (i.stats->>'likes')::int likes, (i.stats->>'comments')::int comments,
      (i.stats->>'views')::int views,
      coalesce((i.stats->>'views')::int,
        nullif(coalesce((i.stats->>'likes')::int, 0) + coalesce((i.stats->>'comments')::int, 0), 0)) reach,
      i.score::int score, coalesce(i.published_at, i.created_at) at, i.stats_at, i.url open,
      c.calls, c.calls > 0 called,
      case when k.why is not null then 'check' end "check", k.why check_why
    from learn.breakdowns b join learn.items i on i.id = b.item_id
      left join learn.sources s on s.id = i.source_id
      left join lateral (select count(*)::int calls from decision_calls c
        where (c.kind = 'document' and c.subject = 'doc:' || i.document_id
            and c.source in ('console', 'cli'))
          or (c.kind = 'finding' and c.subject like 'doc:' || i.document_id || '/%')) c on true
      left join lateral (select string_agg(k.label || ' ' || k.value || ': our ' || k.with_n
          || ' with it ' || m.word || ' ' || round(k.with_median::numeric * 100, 1) || '%, all our '
          || k.all_n || ' ' || m.word || ' ' || round(k.all_median::numeric * 100, 1) || '% (' || k.sop || ')', chr(10)
          order by k.sop, k.path) why
        from learn.checks k
          cross join lateral (select case k.measure when 'hook' then 'hold at 3 s'
            when 'watched' then 'watched' else 'engaged' end word) m
        where k.item_id = b.item_id) k on true
    where i.client = 'wren' and i.draft_id is null);--> statement-breakpoint
CREATE VIEW "learn"."hook_records" AS (
    select r.hook_style id, r.hook_style style, count(*)::int reels, count(distinct r.creator)::int creators,
      (percentile_cont(0.5) within group (order by r.reach))::int median_reach,
      max(r.reach)::int top_reach,
      (array_agg(r.title order by r.reach desc nulls last))[1] top,
      (array_agg(r.creator order by r.reach desc nulls last))[1] top_creator,
      max(r.at) last_at
    from learn.breakdown_records r
    group by r.hook_style);--> statement-breakpoint
CREATE VIEW "learn"."standards" AS (
    select r.id, r.kind, r.type platform, r.creator, r.title, r.reach, r.at, b."by"::text "by",
      r.hook_style, r.cta_kind,
      b.facts->>'format' format, b.facts->>'shape' shape, b.facts->>'link' link,
      (b.facts->>'chars')::int chars, (b.facts->>'lines')::int lines,
      (b.facts->>'first_line_chars')::int first_line_chars, (b.facts->>'hashtags')::int hashtags,
      (b.facts->>'duration_s')::numeric duration_s, (b.facts->>'cuts')::int cuts,
      (b.facts->>'shot_median_s')::numeric shot_median_s, (b.facts->>'shot_p90_s')::numeric shot_p90_s,
      (b.facts->>'first_product_s')::numeric first_product_s, (b.facts->>'logo_s')::numeric logo_s,
      (b.facts->>'cta_s')::numeric cta_s, b.facts->>'cuts_trust' cuts_trust,
      (b.facts->>'music')::boolean music, (b.facts->>'vo')::boolean vo, r.calls
    from learn.breakdown_records r join learn.breakdowns b on b.item_id = r.id
      join learn.items i on i.id = r.id
      left join lateral (select c.label from decision_calls c
        where c.kind = 'document' and c.subject = 'doc:' || i.document_id
        order by c.at desc, c.id desc limit 1) his on true
    where i.archived_at is null and his.label is distinct from 'drop'
      and (b."by" = 'hand' or i.saved_by is not null or i.source_id is not null
        or his.label = 'keep'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "learn"."items_document"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS NULL THEN
    -- One url and one feed text share a document across workspaces.
    INSERT INTO public.documents (url, kind, content_hash, title, text, fetch_tier)
    VALUES (NEW.url,
      CASE NEW.kind::text WHEN 'article' THEN 'webpage' WHEN 'post' THEN 'post'
        WHEN 'episode' THEN 'audio' ELSE 'video' END,
      encode(sha256(convert_to(NEW.text, 'UTF8')), 'hex'), NEW.title, NEW.text, 'learn')
    ON CONFLICT (url, content_hash) DO UPDATE SET title = public.documents.title
    RETURNING id INTO NEW.document_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER items_document BEFORE INSERT ON "learn"."items"
  FOR EACH ROW EXECUTE FUNCTION "learn"."items_document"();

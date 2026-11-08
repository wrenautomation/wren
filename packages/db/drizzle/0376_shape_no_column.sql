-- Columns are gone (WA-1143, designs/2026-11-06-orrery-business-look.md): the map places by tracks only.
-- Strip `column` from every metro station, in the body and in each shared flow. Order stays.
-- 0306 refuses an edit of a version. This drops a field no reader has, so the guard is off for it alone.
ALTER TABLE "pipeline"."shape_versions" DISABLE TRIGGER "shape_versions_never_edited";--> statement-breakpoint
UPDATE "pipeline"."shape_versions" v SET "body" = jsonb_set(
  case when jsonb_typeof(v.body -> 'flows') = 'array' then jsonb_set(v.body, '{flows}', (
    select coalesce(jsonb_agg(case when jsonb_typeof(f -> 'stations') = 'array' then jsonb_set(f, '{stations}', (
      select coalesce(jsonb_agg(s - 'column' order by j), '[]'::jsonb)
      from jsonb_array_elements(f -> 'stations') with ordinality y(s, j))) else f end order by i), '[]'::jsonb)
    from jsonb_array_elements(v.body -> 'flows') with ordinality x(f, i))) else v.body end,
  '{stations}', (
    select coalesce(jsonb_agg(s - 'column' order by i), '[]'::jsonb)
    from jsonb_array_elements(v.body -> 'stations') with ordinality x(s, i)))
WHERE v.body ->> 'model' = 'metro' AND jsonb_typeof(v.body -> 'stations') = 'array';--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ENABLE TRIGGER "shape_versions_never_edited";--> statement-breakpoint
UPDATE "pipeline"."shape_drafts" v SET "body" = jsonb_set(
  case when jsonb_typeof(v.body -> 'flows') = 'array' then jsonb_set(v.body, '{flows}', (
    select coalesce(jsonb_agg(case when jsonb_typeof(f -> 'stations') = 'array' then jsonb_set(f, '{stations}', (
      select coalesce(jsonb_agg(s - 'column' order by j), '[]'::jsonb)
      from jsonb_array_elements(f -> 'stations') with ordinality y(s, j))) else f end order by i), '[]'::jsonb)
    from jsonb_array_elements(v.body -> 'flows') with ordinality x(f, i))) else v.body end,
  '{stations}', (
    select coalesce(jsonb_agg(s - 'column' order by i), '[]'::jsonb)
    from jsonb_array_elements(v.body -> 'stations') with ordinality x(s, i)))
WHERE v.body ->> 'model' = 'metro' AND jsonb_typeof(v.body -> 'stations') = 'array';

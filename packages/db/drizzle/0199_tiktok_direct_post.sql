DROP VIEW "public"."marketing_draft_records";--> statement-breakpoint
CREATE VIEW "public"."marketing_draft_records" AS (
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.stage::text stage, d.points_to::text "to",
    case
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      else 'post' end format,
    case
      when d.platform = 'tiktok' and coalesce(d.extra->>'privacy', '') = '' then 'privacy'
      when d.platform = 'tiktok' and d.extra->>'disclose' = 'true'
        and coalesce(d.extra->>'yourBrand', '') <> 'true'
        and coalesce(d.extra->>'brandedContent', '') <> 'true' then 'disclosure'
      end missing,
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published');
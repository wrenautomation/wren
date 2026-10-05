CREATE VIEW "public"."marketing_draft_records" AS (
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published');
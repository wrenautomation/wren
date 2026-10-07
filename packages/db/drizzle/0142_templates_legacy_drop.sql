-- The text and DM words that lived in sms_templates and reach_templates, into the template store
-- where it lacks them (as `import` versions, live where nothing is), checked, then both dropped.
-- The stored hash is the words' sha256, not the parsed template's: SQL can't parse a template.
DO $$
DECLARE
  r record;
  tid integer;
  vid integer;
  missing integer;
BEGIN
  FOR r IN
    SELECT 'sms'::varchar kind, 'texts'::varchar sys, key, body, updated_at, updated_by FROM sms_templates
    UNION ALL
    SELECT 'dm', 'reach', key, body, updated_at, updated_by FROM reach_templates
  LOOP
    INSERT INTO templates (kind, system, name, folder)
      VALUES (r.kind, r.sys, r.key, CASE WHEN position('/' in r.key) > 0
        THEN r.sys || '/' || regexp_replace(r.key, '/[^/]*$', '') ELSE r.sys END)
      ON CONFLICT (kind, system, name) DO NOTHING;
    SELECT id INTO tid FROM templates WHERE kind = r.kind AND system = r.sys AND name = r.key FOR UPDATE;
    CONTINUE WHEN EXISTS (SELECT 1 FROM template_versions WHERE template_id = tid AND source = r.body);
    INSERT INTO template_versions (template_id, niche, template, version, number, source, origin, why,
        created_by, created_at)
      SELECT tid, r.sys, r.key, left(encode(sha256(convert_to(r.body, 'UTF8')), 'hex'), 12),
        coalesce(max(number), 0) + 1, r.body, 'import', 'kept when ' || r.kind || ' templates moved here',
        r.updated_by, r.updated_at
      FROM template_versions WHERE template_id = tid
      RETURNING id INTO vid;
    UPDATE templates SET live_version_id = vid, updated_at = now()
      WHERE id = tid AND live_version_id IS NULL AND NOT follows_default;
    UPDATE template_versions SET published_at = r.updated_at, published_by = r.updated_by
      WHERE id = vid AND EXISTS (SELECT 1 FROM templates WHERE id = tid AND live_version_id = vid);
  END LOOP;
  SELECT count(*) INTO missing FROM (
    SELECT 'sms' kind, 'texts' sys, key, body FROM sms_templates
    UNION ALL SELECT 'dm', 'reach', key, body FROM reach_templates) l
  WHERE NOT EXISTS (SELECT 1 FROM templates t JOIN template_versions v ON v.template_id = t.id
    WHERE t.kind = l.kind AND t.system = l.sys AND t.name = l.key AND v.source = l.body);
  IF missing > 0 THEN
    RAISE EXCEPTION 'templates legacy drop: % rows did not copy', missing;
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "sms_templates" CASCADE;--> statement-breakpoint
DROP TABLE "reach_templates" CASCADE;

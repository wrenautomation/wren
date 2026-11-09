-- WA-1219 deploy 2: triggers wake SegmentPass by its own name (deploy 1 renamed it; the door alias carried 'Segments/')
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tgname, t.tgrelid::regclass AS tbl, pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    WHERE NOT t.tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%wren_wake(''Segments/%'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
    EXECUTE replace(r.def, 'wren_wake(''Segments/', 'wren_wake(''SegmentPass/');
  END LOOP;
END $$;

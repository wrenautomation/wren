-- Vireo 0.13.0 (D11) moved each old call to vireo.calls with by 'person': it never kept who.
-- The audit did. Every old call was one person's: the one who set scores, by email.
DO $$
DECLARE judge text;
BEGIN
  IF to_regclass('public.audit_events') IS NULL OR to_regclass('vireo.calls') IS NULL THEN
    RETURN;
  END IF;
  SELECT e.actor INTO judge FROM audit_events e
  WHERE e.table_name = 'vireo.samples' AND e.actor LIKE '%@%'
    AND (e.new_values ? 'score' OR e.new_values ? 'verdict')
  GROUP BY e.actor ORDER BY count(*) DESC LIMIT 1;
  IF judge IS NOT NULL THEN
    UPDATE vireo.calls SET by = judge WHERE by = 'person';
  END IF;
END $$;

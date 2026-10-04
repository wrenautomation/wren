CREATE VIEW "public"."lead_sheet" AS (SELECT l.id AS lead_id, c.niche, p.id AS person_id, c.id AS company_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(concat_ws(' ', l.first_name, l.last_name), '')) AS person_name,
  COALESCE(NULLIF(p.title, ''), there.title, NULLIF(l.title, '')) AS result_title,
  p.linkedin_url, l.email,
  (v.checked_at AT TIME ZONE 'UTC')::date AS valid_email_on,
  CASE WHEN split_part(split_part(lower(l.email), '@', 1), '+', 1) IN ('abuse', 'admin', 'administrator', 'billing', 'contact', 'hello', 'help', 'hr', 'info', 'jobs', 'mail', 'marketing', 'no-reply', 'noreply', 'office', 'postmaster', 'privacy', 'sales', 'security', 'support', 'team', 'webmaster') THEN 'role' ELSE 'person' END AS email_type,
  CASE v.result WHEN 'valid' THEN 'ok' WHEN 'risky' THEN 'risky' WHEN 'catch_all' THEN 'risky' WHEN 'invalid' THEN 'bad' ELSE 'unchecked' END AS mail_status,
  c.name AS company_name, c.domain AS company_domain, c.linkedin_url AS company_linkedin,
  COALESCE(NULLIF(prof.value ->> 'location', ''), NULLIF(c.raw ->> 'geo', ''), NULLIF(l.geo, '')) AS company_location,
  COALESCE(NULLIF(prof.value ->> 'industry', ''),
    NULLIF(replace(c.raw -> 'overture' -> 'categories' ->> 'primary', '_', ' '), ''),
    'NAICS ' || NULLIF(c.raw -> 'sba' ->> 'naics_primary', '')) AS industry,
  COALESCE(NULLIF(prof.value ->> 'description', ''), home.description) AS description
FROM leads l
LEFT JOIN companies c ON c.id = l.company_id
LEFT JOIN LATERAL (SELECT cc.person_id FROM contact_candidates cc WHERE cc.lead_id = l.id ORDER BY cc.id DESC LIMIT 1) cand ON true
LEFT JOIN people p ON p.id = cand.person_id
LEFT JOIN LATERAL (SELECT vv.result, vv.checked_at FROM verifications vv
  WHERE vv.lead_id = l.id OR vv.contact_candidate_id IN (SELECT cc.id FROM contact_candidates cc WHERE cc.lead_id = l.id)
  ORDER BY vv.checked_at DESC, vv.id DESC LIMIT 1) v ON true
LEFT JOIN LATERAL (SELECT NULLIF(f.value ->> 'title', '') AS title FROM findings f
  WHERE f.person_id = p.id AND f.kind = 'still_there' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) there ON true
LEFT JOIN LATERAL (SELECT f.value FROM findings f
  WHERE f.company_id = c.id AND f.kind = 'profile' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) prof ON true
LEFT JOIN LATERAL (SELECT NULLIF(btrim(COALESCE(
    substring(d.html FROM '(?i)<meta[^>]*name=["'']description["''][^>]*content="([^"]*)"'),
    substring(d.html FROM '(?i)<meta[^>]*content="([^"]*)"[^>]*name=["'']description["'']'))), '') AS description
  FROM documents d WHERE d.company_id = c.id AND d.kind = 'webpage' AND d.html IS NOT NULL
  ORDER BY length(COALESCE(d.final_url, d.url)), d.id LIMIT 1) home ON true);
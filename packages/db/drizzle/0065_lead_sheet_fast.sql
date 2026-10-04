DROP VIEW "public"."lead_sheet";--> statement-breakpoint
CREATE VIEW "public"."lead_sheet" AS (SELECT l.id AS lead_id, c.niche, p.id AS person_id, c.id AS company_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(concat_ws(' ', l.first_name, l.last_name), '')) AS person_name,
  COALESCE(NULLIF(p.title, ''), there.title, NULLIF(l.title, '')) AS result_title,
  p.linkedin_url, l.email,
  (v.checked_at AT TIME ZONE 'UTC')::date AS valid_email_on,
  m.email_type, m.mail_status,
  c.name AS company_name, c.domain AS company_domain, c.linkedin_url AS company_linkedin,
  COALESCE(NULLIF(prof.value ->> 'location', ''), NULLIF(c.raw ->> 'geo', ''), NULLIF(l.geo, '')) AS company_location,
  COALESCE(NULLIF(prof.value ->> 'industry', ''),
    NULLIF(replace(c.raw -> 'overture' -> 'categories' ->> 'primary', '_', ' '), ''),
    'NAICS ' || NULLIF(c.raw -> 'sba' ->> 'naics_primary', '')) AS industry,
  COALESCE(NULLIF(prof.value ->> 'description', ''), home.description) AS description,
  concat_ws(' · ', 'mail ' || m.mail_status,
    CASE WHEN m.email_type = 'role' THEN 'role inbox' WHEN ck.fits_name = 'pass' THEN 'fits name' WHEN ck.fits_name = 'fail' THEN 'fits someone else' END,
    CASE ck.domain_is_firm WHEN 'pass' THEN 'firm domain' WHEN 'fail' THEN 'other domain' END,
    CASE ck.works_there WHEN 'pass' THEN 'works there' WHEN 'fail' THEN 'moved on' END,
    CASE ck.title_agrees WHEN 'pass' THEN 'title agrees' WHEN 'fail' THEN 'title differs' END,
    CASE ck.page_is_firm WHEN 'pass' THEN 'firm page' WHEN 'fail' THEN 'no firm page' END,
    CASE ck.phone_agrees WHEN 'pass' THEN 'phone agrees' WHEN 'fail' THEN 'phone differs' END) AS checks,
  CASE WHEN ck.fits_name = 'fail' OR ck.works_there = 'fail' THEN 'wrong person'
    WHEN m.mail_status = 'ok' AND ck.domain_is_firm = 'pass' AND ck.works_there = 'pass'
      AND (ck.fits_name = 'pass' OR m.email_type = 'role') THEN 'yes'
    ELSE 'partial' END AS verified
FROM leads l
LEFT JOIN companies c ON c.id = l.company_id
LEFT JOIN LATERAL (SELECT cc.person_id FROM contact_candidates cc WHERE cc.lead_id = l.id ORDER BY cc.id DESC LIMIT 1) cand ON true
LEFT JOIN people p ON p.id = cand.person_id
LEFT JOIN LATERAL (SELECT x.result, x.checked_at FROM (
  (SELECT vv.result, vv.checked_at, vv.id FROM verifications vv WHERE vv.lead_id = l.id
    ORDER BY vv.checked_at DESC, vv.id DESC LIMIT 1)
  UNION ALL
  (SELECT vv.result, vv.checked_at, vv.id FROM contact_candidates cc JOIN verifications vv ON vv.contact_candidate_id = cc.id
    WHERE cc.lead_id = l.id ORDER BY vv.checked_at DESC, vv.id DESC LIMIT 1)
  ) x ORDER BY x.checked_at DESC, x.id DESC LIMIT 1) v ON true
CROSS JOIN LATERAL (SELECT
  CASE WHEN split_part(split_part(lower(l.email), '@', 1), '+', 1) IN ('abuse', 'admin', 'administrator', 'billing', 'contact', 'hello', 'help', 'hr', 'info', 'jobs', 'mail', 'marketing', 'no-reply', 'noreply', 'office', 'postmaster', 'privacy', 'sales', 'security', 'support', 'team', 'webmaster') THEN 'role' ELSE 'person' END AS email_type,
  CASE v.result WHEN 'valid' THEN 'ok' WHEN 'risky' THEN 'risky' WHEN 'catch_all' THEN 'risky' WHEN 'invalid' THEN 'bad' ELSE 'unchecked' END AS mail_status) m
LEFT JOIN LATERAL (SELECT
  max(lc.result) FILTER (WHERE lc.kind = 'mailbox_fits_name') AS fits_name,
  max(lc.result) FILTER (WHERE lc.kind = 'domain_is_firm') AS domain_is_firm,
  max(lc.result) FILTER (WHERE lc.kind = 'works_there') AS works_there,
  max(lc.result) FILTER (WHERE lc.kind = 'title_agrees') AS title_agrees,
  max(lc.result) FILTER (WHERE lc.kind = 'page_is_firm') AS page_is_firm,
  max(lc.result) FILTER (WHERE lc.kind = 'phone_agrees') AS phone_agrees
  FROM lead_checks lc WHERE lc.lead_id = l.id) ck ON true
LEFT JOIN LATERAL (SELECT NULLIF(f.value ->> 'title', '') AS title FROM findings f
  WHERE f.person_id = p.id AND f.kind = 'still_there' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) there ON true
LEFT JOIN LATERAL (SELECT f.value FROM findings f
  WHERE f.company_id = c.id AND f.kind = 'profile' ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) prof ON true
LEFT JOIN LATERAL (SELECT NULLIF(btrim(COALESCE(
    substring(d.html FROM '(?i)<meta[^>]*name=["'']description["''][^>]*content="([^"]*)"'),
    substring(d.html FROM '(?i)<meta[^>]*content="([^"]*)"[^>]*name=["'']description["'']'))), '') AS description
  FROM documents d WHERE d.company_id = c.id AND d.kind = 'webpage' AND d.html IS NOT NULL
  ORDER BY length(COALESCE(d.final_url, d.url)), d.id LIMIT 1) home ON true);
-- Both views keep their columns, so they are replaced in place (reply_by_evidence reads enrollment_outcomes).
ALTER TABLE "leads" ADD COLUMN "person_id" integer;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "lead_id" integer;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "candidate_id" integer;--> statement-breakpoint
-- Backfill: enrollments from step 0's recorded address, leads from their newest linked candidate.
UPDATE "enrollments" e SET
  "lead_id" = (m.provenance->'address'->>'lead_id')::integer,
  "candidate_id" = (m.provenance->'address'->>'candidate_id')::integer
FROM "messages" m
WHERE m.enrollment_id = e.id AND m.step = 0 AND m.provenance->'address' IS NOT NULL;--> statement-breakpoint
UPDATE "leads" l SET "person_id" = c.person_id
FROM (SELECT DISTINCT ON (lead_id) lead_id, person_id FROM "contact_candidates"
  WHERE lead_id IS NOT NULL ORDER BY lead_id, id DESC) c
WHERE c.lead_id = l.id;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_lead_id_leads" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_candidate_id_contact_candidates" FOREIGN KEY ("candidate_id") REFERENCES "public"."contact_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_leads_person_id" ON "leads" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_enrollments_lead_id" ON "enrollments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ix_enrollments_candidate_id" ON "enrollments" USING btree ("candidate_id");--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."enrollment_outcomes" AS (WITH opener AS ( SELECT m.enrollment_id, m.template AS opener_template, m.template_version AS opener_template_version, m.state AS opener_state, m.provenance -> 'address'::text AS address FROM messages m WHERE m.step = 0 ), sends AS ( SELECT m.enrollment_id, count(*) FILTER (WHERE m.state::text = 'sent'::text) AS steps_sent, min(m.sent_at) AS first_sent_at, max(m.sent_at) AS last_sent_at FROM messages m GROUP BY m.enrollment_id ), events AS ( SELECT te.enrollment_id, count(*) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, bool_or(te.kind::text = 'reply'::text) AS replied, bool_or(te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[]))) AS interested, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounced, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'soft'::text) AS soft_bounced, bool_or(te.kind::text = 'unsubscribe'::text) AS unsubscribed, bool_or(te.kind::text = 'complaint'::text) AS complained, bool_or(te.kind::text = 'auto_reply'::text) AS auto_replied, min(te.received_at) FILTER (WHERE te.kind::text = 'reply'::text) AS first_reply_at, (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text AND te.disposition IS NOT NULL))[1] AS disposition FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.id AS enrollment_id, e.niche, e.sequence_name, e.kind AS enrollment_kind, e.company_id, e.person_id, e.to_email, e.sender, e.state, e.stop_reason, e.created_at AS enrolled_at, o.opener_template, o.opener_template_version, o.opener_state, o.address ->> 'evidence'::text AS evidence, o.address ->> 'verification_result'::text AS verification_result, o.address ->> 'pick_method'::text AS pick_method, e.lead_id, e.candidate_id, (o.address ->> 'document_id'::text)::integer AS source_document_id, o.address ->> 'source_url'::text AS source_url, COALESCE(s.steps_sent, 0::bigint) AS steps_sent, s.first_sent_at, s.last_sent_at, COALESCE(ev.replies, 0::bigint) AS replies, COALESCE(ev.replied, false) AS replied, COALESCE(ev.interested, false) AS interested, ev.disposition, COALESCE(ev.hard_bounced, false) AS hard_bounced, COALESCE(ev.soft_bounced, false) AS soft_bounced, COALESCE(ev.unsubscribed, false) AS unsubscribed, COALESCE(ev.complained, false) AS complained, COALESCE(ev.auto_replied, false) AS auto_replied, ev.first_reply_at, e.contact_round FROM enrollments e LEFT JOIN opener o ON o.enrollment_id = e.id LEFT JOIN sends s ON s.enrollment_id = e.id LEFT JOIN events ev ON ev.enrollment_id = e.id);--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."lead_sheet" AS (SELECT l.id AS lead_id, c.niche, p.id AS person_id, c.id AS company_id,
  COALESCE(NULLIF(p.full_name, ''), NULLIF(concat_ws(' ', l.first_name, l.last_name), '')) AS person_name,
  COALESCE(NULLIF(p.title, ''), there.title, NULLIF(l.title, '')) AS result_title,
  COALESCE(p.linkedin_url, pub.person_linkedin) AS linkedin_url, l.email,
  (v.checked_at AT TIME ZONE 'UTC')::date AS valid_email_on,
  m.email_type, m.mail_status,
  c.name AS company_name, c.domain AS company_domain,
  COALESCE(c.linkedin_url, pub.company_linkedin) AS company_linkedin, pub.phone, pub.socials,
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
LEFT JOIN people p ON p.id = l.person_id
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
  ORDER BY length(COALESCE(d.final_url, d.url)), d.id LIMIT 1) home ON true
LEFT JOIN LATERAL (SELECT
  (SELECT cp.value FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind = 'phone'
    ORDER BY cp.value ~ '^[+]18(00|33|44|55|66|77|88)', cp.source, cp.pages DESC, cp.id LIMIT 1) AS phone,
  (SELECT cp.value FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind = 'linkedin_company'
    ORDER BY cp.pages DESC, cp.id LIMIT 1) AS company_linkedin,
  (SELECT cp.value FROM own_contact_points cp WHERE cp.person_id = p.id AND cp.kind = 'linkedin_person'
    ORDER BY cp.pages DESC, cp.id LIMIT 1) AS person_linkedin,
  (SELECT string_agg(s.value, ' ' ORDER BY s.kind) FROM (SELECT DISTINCT ON (cp.kind) cp.kind, cp.value
    FROM own_contact_points cp WHERE cp.company_id = c.id AND cp.kind IN ('x', 'instagram', 'facebook', 'youtube', 'tiktok')
    ORDER BY cp.kind, cp.pages DESC, cp.id) s) AS socials) pub ON true);
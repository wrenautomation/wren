import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgView,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * One row per channel enrollment: an email sequence, a text contact or a DM contact, with the
 * lead it is for (the person when known, else the firm), where it stands, whether it holds the
 * lead now and when it first touched them. The cross-channel rules (`leads.ts`) and the
 * per-channel funnel (`books.econ_channels`) read it, so the three tables' states are named once.
 * An email's first touch is its sent opener; a text or DM is touched when its opener queues.
 */
export const leadChannels = pgView("lead_channels", {
  channel: text("channel"),
  id: integer("id"),
  companyId: integer("company_id"),
  personId: integer("person_id"),
  state: text("state"),
  active: boolean("active"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  firstTouchAt: timestamp("first_touch_at", { withTimezone: true }),
}).as(
  sql`SELECT 'email'::text AS channel, e.id, e.company_id, e.person_id, e.state::text AS state, e.state = 'active' AS active, e.created_at, (SELECT min(m.sent_at) FROM messages m WHERE m.enrollment_id = e.id AND m.step = 0 AND m.state = 'sent') AS first_touch_at FROM enrollments e UNION ALL SELECT 'text', c.id, c.company_id, c.person_id, c.state::text, c.state IN ('enrolled', 'replied'), c.created_at, c.enrolled_at FROM sms_contacts c UNION ALL SELECT 'dm', c.id, c.company_id, c.person_id, c.state::text, c.state IN ('enrolled', 'connected', 'replied'), c.created_at, c.enrolled_at FROM reach_contacts c`,
);

export const personFacts = pgView("person_facts", {
  personId: integer("person_id"),
  companyId: integer("company_id"),
  companySourceKey: varchar("company_source_key", { length: 64 }),
  companyName: varchar("company_name"),
  companyDomain: varchar("company_domain", { length: 255 }),
  companyNiche: varchar("company_niche", { length: 32 }),
  sourceKey: varchar("source_key", { length: 64 }),
  fullName: text("full_name"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  title: text("title"),
  isCompliance: boolean("is_compliance"),
  isTestimonial: boolean("is_testimonial"),
  testimonialOrg: text("testimonial_org"),
  origin: varchar("origin", { length: 32 }),
  asOf: date("as_of"),
  linkedinUrl: varchar("linkedin_url", { length: 512 }),
  roleRank: integer("role_rank"),
  avoidEmailingFirst: boolean("avoid_emailing_first"),
}).as(
  sql`SELECT p.id AS person_id, p.company_id, c.source_key AS company_source_key, c.name AS company_name, c.domain AS company_domain, c.niche AS company_niche, p.source_key, p.full_name, p.first_name, p.last_name, p.title, p.is_compliance, p.is_testimonial, p.testimonial_org, p.origin, p.as_of, p.linkedin_url, CASE WHEN p.is_testimonial THEN NULL::integer WHEN p.title IS NULL THEN CASE WHEN p.origin::text = 'registry'::text THEN 3 ELSE NULL::integer END WHEN c.niche::text = 'sec_ria'::text THEN CASE WHEN p.title ~* '\\y(vice president|executive vice|senior vice)\\y'::text THEN 3 WHEN p.title ~* '\\y(owner|founder|principal|chief executive|ceo|president|managing member|manager)\\y'::text THEN 1 WHEN p.title ~* '\\y(cio|chief investment|coo|chief operating|managing partner|managing director|partner)\\y'::text THEN 2 WHEN p.title ~* '\\y(cmo|chief marketing|business development|wealth advisor|financial advisor|portfolio manager|director)\\y'::text THEN 3 ELSE NULL::integer END WHEN c.niche::text = 'agencies'::text THEN CASE WHEN p.title ~* '\\y(vice president|executive vice|senior vice)\\y'::text THEN 3 WHEN p.title ~* '\\y(owner|founder|co-founder|chief executive|ceo|president|principal|managing director|managing partner)\\y'::text THEN 1 WHEN p.title ~* '\\y(coo|chief operating|operations director|head of operations|general manager|managing member|partner)\\y'::text THEN 2 WHEN p.title ~* '\\y(cmo|chief marketing|creative director|marketing director|account director|business development|head of|director)\\y'::text THEN 3 ELSE NULL::integer END WHEN c.niche::text = 'recruiting'::text THEN CASE WHEN p.title ~* '\\y(vice president|executive vice|senior vice)\\y'::text THEN 3 WHEN p.title ~* '\\y(owner|co-owner|founder|co-founder|chief executive|ceo|president|principal|managing member|managing partner)\\y'::text THEN 1 WHEN p.title ~* '\\y(coo|chief operating|cfo|chief financial|managing director|general manager|partner|member)\\y'::text THEN 2 WHEN p.title ~* '\\y(director|head of|manager)\\y'::text THEN 3 ELSE NULL::integer END ELSE CASE WHEN p.title ~* '\\y(vice president|executive vice|senior vice)\\y'::text THEN 3 WHEN p.title ~* '\\y(owner|founder|co-founder|chief executive|ceo|president|managing member)\\y'::text THEN 1 WHEN p.title ~* '\\y(coo|chief operating|managing partner|managing director)\\y'::text THEN 2 WHEN p.title ~* '\\y(director|head of)\\y'::text THEN 3 ELSE NULL::integer END END AS role_rank, p.is_compliance OR COALESCE(p.title ~* '\\y(compliance|counsel|attorney|paralegal|regulatory)\\y'::text, false) AS avoid_emailing_first FROM people p JOIN companies c ON c.id = p.company_id`,
);

export const agencyFacts = pgView("agency_facts", {
  companyId: integer("company_id"),
  sourceKey: varchar("source_key", { length: 64 }),
  domain: varchar("domain", { length: 255 }),
  name: varchar("name"),
  country: varchar("country", { length: 2 }),
  employees: integer("employees"),
  minBudgetUsd: bigint("min_budget_usd", { mode: "number" }),
  hourlyRateUsd: integer("hourly_rate_usd"),
  foundedYear: integer("founded_year"),
  rating: numeric("rating", { mode: "number" }),
  services: text("services"),
  industries: text("industries"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  segment: text("segment"),
}).as(
  sql`WITH newest_sighting AS ( SELECT DISTINCT ON (sightings.company_id) sightings.company_id, sightings.raw, sightings.seen_at FROM sightings WHERE sightings.company_id IS NOT NULL AND sightings.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text] ORDER BY sightings.company_id, sightings.seen_at DESC ), eff AS ( SELECT c_1.id AS company_id, COALESCE(ns.raw, c_1.raw) AS raw, ns.seen_at AS last_seen_at FROM companies c_1 LEFT JOIN newest_sighting ns ON ns.company_id = c_1.id ), shares AS ( SELECT eff_1.company_id, COALESCE(sum( CASE WHEN m.m[2] ~* 'marketing|advertis|pay per click|\\yppc\\y|search engine|\\yseo\\y|\\ysem\\y|social media|public relations|media (buying|planning)|influencer|conversion|lead generation|digital strategy|market research|affiliate'::text THEN m.m[1]::integer ELSE NULL::integer END), 0::bigint) AS marketing, COALESCE(sum( CASE WHEN m.m[2] ~* 'development|software|engineering|\\yapp\\y|mobile|web design|ux|ui|product design|branding|graphic design|logo|video|animation|e-?commerce|shopify|it (managed|strategy)|cloud|data|\\yai\\y|system integrat|blockchain|iot|cyber|testing|design|store|theme'::text THEN m.m[1]::integer ELSE NULL::integer END), 0::bigint) AS build FROM eff eff_1, LATERAL regexp_matches(eff_1.raw ->> 'agency.services'::text, '([0-9]+)%\\s*([^,]+)'::text, 'g'::text) m(m) GROUP BY eff_1.company_id ) SELECT c.id AS company_id, c.source_key, c.domain, c.name, c.country, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.team_size'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::integer AS employees, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.min_budget'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::bigint AS min_budget_usd, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.hourly_rate'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::integer AS hourly_rate_usd, (regexp_match(eff.raw ->> 'agency.founded'::text, '[0-9]{4}'::text))[1]::integer AS founded_year, (regexp_match(eff.raw ->> 'agency.rating'::text, '[0-9]+(?:\\.[0-9]+)?'::text))[1]::numeric AS rating, eff.raw ->> 'agency.services'::text AS services, eff.raw ->> 'agency.industries'::text AS industries, eff.last_seen_at, CASE WHEN shares.marketing > shares.build THEN 'marketing'::text WHEN shares.build > shares.marketing THEN 'build'::text ELSE NULL::text END AS segment FROM companies c JOIN eff ON eff.company_id = c.id LEFT JOIN shares ON shares.company_id = c.id WHERE eff.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text]`,
);

export const firmFacts = pgView("firm_facts", {
  companyId: integer("company_id"),
  sourceKey: varchar("source_key", { length: 64 }),
  domain: varchar("domain", { length: 255 }),
  name: varchar("name"),
  country: varchar("country", { length: 2 }),
  aumUsd: bigint("aum_usd", { mode: "number" }),
  employees: integer("employees"),
  indClients: integer("ind_clients"),
  hnwClients: integer("hnw_clients"),
  pooledClients: integer("pooled_clients"),
  countryRaw: text("country_raw"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  segment: text("segment"),
}).as(
  sql`WITH facts AS ( WITH newest_sighting AS ( SELECT DISTINCT ON (sightings.company_id) sightings.company_id, sightings.raw, sightings.seen_at FROM sightings WHERE sightings.company_id IS NOT NULL AND sightings.raw ? '5F(2)(c)'::text ORDER BY sightings.company_id, sightings.seen_at DESC ), eff AS ( SELECT c_1.id AS company_id, COALESCE(ns.raw, c_1.raw) AS raw, ns.seen_at AS last_seen_at FROM companies c_1 LEFT JOIN newest_sighting ns ON ns.company_id = c_1.id ) SELECT c.id AS company_id, c.source_key, c.domain, c.name, c.country, NULLIF(regexp_replace(split_part(eff.raw ->> '5F(2)(c)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::bigint AS aum_usd, NULLIF(regexp_replace(split_part(eff.raw ->> '5A'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS employees, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(a)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS ind_clients, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(b)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS hnw_clients, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(f)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS pooled_clients, eff.raw ->> 'Main Office Country'::text AS country_raw, eff.last_seen_at FROM companies c JOIN eff ON eff.company_id = c.id WHERE eff.raw ? '5F(2)(c)'::text ) SELECT company_id, source_key, domain, name, country, aum_usd, employees, ind_clients, hnw_clients, pooled_clients, country_raw, last_seen_at, CASE WHEN COALESCE(ind_clients, 0) > 0 OR COALESCE(hnw_clients, 0) > 0 THEN 'individual'::text WHEN COALESCE(pooled_clients, 0) > 0 THEN 'pooled'::text WHEN ind_clients IS NOT NULL OR hnw_clients IS NOT NULL OR pooled_clients IS NOT NULL THEN 'institutional'::text ELSE 'unknown'::text END AS segment FROM facts`,
);

/**
 * Recruiting firms: size from PPP loans (jobs reported, a yearly payroll estimate),
 * the SBA founding year, the opener line (newest grounded one, any model), and the
 * firm's demo video page (newest render, any walk).
 */
export const recruitingFacts = pgView("recruiting_facts", {
  companyId: integer("company_id"),
  sourceKey: varchar("source_key", { length: 64 }),
  domain: varchar("domain", { length: 255 }),
  name: varchar("name"),
  country: varchar("country", { length: 2 }),
  employees: integer("employees"),
  payrollYearlyUsd: bigint("payroll_yearly_usd", { mode: "number" }),
  foundedYear: integer("founded_year"),
  opener: text("opener"),
  videoUrl: text("video_url"),
}).as(
  sql`SELECT c.id AS company_id, c.source_key, c.domain, c.name, c.country, NULLIF(round((ppp.output ->> 'jobs_reported')::numeric)::integer, 0) AS employees, NULLIF(round((ppp.output ->> 'payroll_yearly_estimate')::numeric)::bigint, 0) AS payroll_yearly_usd, substring(c.raw -> 'sba' ->> 'year_established' from '[0-9]{4}')::integer AS founded_year, op.output -> 'opener' ->> 'line' AS opener, vid.output ->> 'url' AS video_url FROM companies c LEFT JOIN LATERAL ( SELECT e.output FROM enrichments e WHERE e.company_id = c.id AND e.kind = 'firmographics' AND e.model = 'ppp-foia' ORDER BY e.prompt_version DESC, e.created_at DESC LIMIT 1 ) ppp ON true LEFT JOIN LATERAL ( SELECT e.output FROM enrichments e WHERE e.company_id = c.id AND e.kind = 'opener' AND e.output -> 'opener' ->> 'line' IS NOT NULL ORDER BY e.created_at DESC LIMIT 1 ) op ON true LEFT JOIN LATERAL ( SELECT e.output FROM enrichments e WHERE e.company_id = c.id AND e.kind = 'video' AND e.output ->> 'url' IS NOT NULL ORDER BY e.created_at DESC LIMIT 1 ) vid ON true WHERE c.niche = 'recruiting'`,
);

/**
 * Every channel's sends, replies and bookings per template version and variant: one row per
 * (kind, system, template, version, picks), joined to the template store by its name. A send is
 * one message out; a reply or booking after it on the same thread credits it, so a reply to a
 * follow-up still counts for the opener. `picks` is the variant each `[[..]]` point chose (the
 * render's provenance); texts and DMs have no booking link yet, so `booked` is null for them.
 */
export const templateStats = pgView("template_stats", {
  kind: text("kind"),
  system: text("system"),
  template: text("template"),
  templateId: integer("template_id"),
  version: text("version"),
  picks: jsonb("picks"),
  sends: bigint("sends", { mode: "number" }),
  replies: bigint("replies", { mode: "number" }),
  booked: bigint("booked", { mode: "number" }),
  lastSent: timestamp("last_sent", { withTimezone: true }),
}).as(sql`
  with sent as (
    select 'email'::text kind, e.niche::text system, m.template::text template,
      m.template_version::text version, m.provenance -> 'picks' picks, m.sent_at,
      exists (select 1 from thread_events te where te.enrollment_id = m.enrollment_id
        and te.kind = 'reply' and te.received_at >= m.sent_at) replied,
      exists (select 1 from thread_events te where te.enrollment_id = m.enrollment_id
          and te.disposition = 'meeting_booked' and te.received_at >= m.sent_at)
        or exists (select 1 from call_invites ci where ci.enrollment_id = m.enrollment_id
          and ci.state in ('booked', 'already_booked') and ci.created_at >= m.sent_at)
        or exists (select 1 from call_bookings cb where cb.enrollment_id = m.enrollment_id
          and cb.state = 'booked' and cb.booked_at >= m.sent_at) booked
    from messages m join enrollments e on e.id = m.enrollment_id
    where m.state = 'sent'
    union all
    select 'sms', 'texts', m.template, m.template_version, m.provenance -> 'picks', m.sent_at,
      exists (select 1 from sms_messages r where r.contact_id = m.contact_id
        and r.direction = 'in' and coalesce(r.received_at, r.created_at) >= m.sent_at),
      null
    from sms_messages m
    where m.direction = 'out' and m.state in ('sent', 'delivered') and m.template is not null
    union all
    select 'dm', 'reach', m.template, m.template_version, m.provenance -> 'picks', m.sent_at,
      exists (select 1 from reach_messages r where r.contact_id = m.contact_id
        and r.direction = 'in' and coalesce(r.sent_at, r.created_at) >= m.sent_at),
      null
    from reach_messages m
    where m.direction = 'out' and m.state = 'sent' and m.template is not null
  )
  select s.kind, s.system, s.template, t.id template_id, s.version, s.picks,
    count(*) sends,
    count(*) filter (where s.replied) replies,
    case when s.kind = 'email' then count(*) filter (where s.booked) end booked,
    max(s.sent_at) last_sent
  from sent s
  left join templates t on t.kind = s.kind and t.system = s.system and t.name = s.template
  group by s.kind, s.system, s.template, t.id, s.version, s.picks
`);

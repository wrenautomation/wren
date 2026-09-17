-- pg_dump --schema-only of the emails_gen Postgres (alembic head a9c4e17d5b62), 2026-09-17.
-- Ground truth for test/integration/legacy-parity.test.ts. Do not edit; regenerate from the live DB.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    domain character varying(255),
    name character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    import_id integer,
    raw jsonb,
    source_key character varying(64),
    social_url character varying(512),
    country character varying(2),
    domain_verified_at timestamp with time zone,
    niche character varying(32),
    timezone character varying(64),
    CONSTRAINT ck_companies_identified CHECK (((domain IS NOT NULL) OR (source_key IS NOT NULL)))
);


--
-- Name: sightings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sightings (
    id integer NOT NULL,
    company_id integer,
    lead_id integer,
    import_id integer NOT NULL,
    row_number integer NOT NULL,
    raw jsonb NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL,
    person_id integer,
    CONSTRAINT ck_sightings_one_entity CHECK ((((((company_id IS NOT NULL))::integer + ((lead_id IS NOT NULL))::integer) + ((person_id IS NOT NULL))::integer) = 1))
);


--
-- Name: agency_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.agency_facts AS
 WITH newest_sighting AS (
         SELECT DISTINCT ON (sightings.company_id) sightings.company_id,
            sightings.raw,
            sightings.seen_at
           FROM public.sightings
          WHERE ((sightings.company_id IS NOT NULL) AND (sightings.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text]))
          ORDER BY sightings.company_id, sightings.seen_at DESC
        ), eff AS (
         SELECT c_1.id AS company_id,
            COALESCE(ns.raw, c_1.raw) AS raw,
            ns.seen_at AS last_seen_at
           FROM (public.companies c_1
             LEFT JOIN newest_sighting ns ON ((ns.company_id = c_1.id)))
        ), shares AS (
         SELECT eff_1.company_id,
            COALESCE(sum(
                CASE
                    WHEN (m.m[2] ~* 'marketing|advertis|pay per click|\yppc\y|search engine|\yseo\y|\ysem\y|social media|public relations|media (buying|planning)|influencer|conversion|lead generation|digital strategy|market research|affiliate'::text) THEN (m.m[1])::integer
                    ELSE NULL::integer
                END), (0)::bigint) AS marketing,
            COALESCE(sum(
                CASE
                    WHEN (m.m[2] ~* 'development|software|engineering|\yapp\y|mobile|web design|ux|ui|product design|branding|graphic design|logo|video|animation|e-?commerce|shopify|it (managed|strategy)|cloud|data|\yai\y|system integrat|blockchain|iot|cyber|testing|design|store|theme'::text) THEN (m.m[1])::integer
                    ELSE NULL::integer
                END), (0)::bigint) AS build
           FROM eff eff_1,
            LATERAL regexp_matches((eff_1.raw ->> 'agency.services'::text), '([0-9]+)%\s*([^,]+)'::text, 'g'::text) m(m)
          GROUP BY eff_1.company_id
        )
 SELECT c.id AS company_id,
    c.source_key,
    c.domain,
    c.name,
    c.country,
    (NULLIF(regexp_replace((regexp_match((eff.raw ->> 'agency.team_size'::text), '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text))::integer AS employees,
    (NULLIF(regexp_replace((regexp_match((eff.raw ->> 'agency.min_budget'::text), '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text))::bigint AS min_budget_usd,
    (NULLIF(regexp_replace((regexp_match((eff.raw ->> 'agency.hourly_rate'::text), '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text))::integer AS hourly_rate_usd,
    ((regexp_match((eff.raw ->> 'agency.founded'::text), '[0-9]{4}'::text))[1])::integer AS founded_year,
    ((regexp_match((eff.raw ->> 'agency.rating'::text), '[0-9]+(?:\.[0-9]+)?'::text))[1])::numeric AS rating,
    (eff.raw ->> 'agency.services'::text) AS services,
    (eff.raw ->> 'agency.industries'::text) AS industries,
    eff.last_seen_at,
        CASE
            WHEN (shares.marketing > shares.build) THEN 'marketing'::text
            WHEN (shares.build > shares.marketing) THEN 'build'::text
            ELSE NULL::text
        END AS segment
   FROM ((public.companies c
     JOIN eff ON ((eff.company_id = c.id)))
     LEFT JOIN shares ON ((shares.company_id = c.id)))
  WHERE (eff.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text]);


--
-- Name: VIEW agency_facts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.agency_facts IS 'agency_facts is the sanctioned targeting read surface for the agencies niche (D33 design b, D35). One row per company whose effective raw carries any agency.* fact key; facts are read from the newest FACT-BEARING sighting, else the create-time raw -- non-fact sightings never shadow facts. Numeric floors are parsed once here (first number of a range); never re-derive them from raw ad hoc. Spine columns (company_id, source_key, domain, name, country, employees, last_seen_at, segment) match firm_facts for cross-niche UNIONs; segment is marketing or build, whichever bucket holds the larger share of the listed services (a9c4e17d5b62), NULL on a tie or when no service classifies. Templates read it as company.segment; compose --where company.segment=... picks the arm.';


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    id integer NOT NULL,
    person_id integer,
    niche character varying(32) NOT NULL,
    sequence_name character varying(64) NOT NULL,
    sequence_snapshot jsonb NOT NULL,
    state character varying(32) NOT NULL,
    stop_reason character varying(32),
    stopped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer NOT NULL,
    kind character varying(32) NOT NULL,
    to_email character varying(320) NOT NULL,
    sender character varying(320) NOT NULL,
    run_id uuid,
    CONSTRAINT ck_enrollments_enrollmentkind CHECK (((kind)::text = ANY ((ARRAY['person'::character varying, 'role_inbox'::character varying])::text[]))),
    CONSTRAINT ck_enrollments_enrollmentstate CHECK (((state)::text = ANY ((ARRAY['active'::character varying, 'finished'::character varying, 'stopped'::character varying])::text[]))),
    CONSTRAINT ck_enrollments_person_unless_role_inbox CHECK (((person_id IS NOT NULL) OR ((kind)::text = 'role_inbox'::text))),
    CONSTRAINT ck_enrollments_stop_reason_iff_stopped CHECK ((((state)::text = 'stopped'::text) = (stop_reason IS NOT NULL))),
    CONSTRAINT ck_enrollments_stopreason CHECK (((stop_reason)::text = ANY ((ARRAY['reply'::character varying, 'bounce'::character varying, 'opt_out'::character varying, 'complaint'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    enrollment_id integer NOT NULL,
    step integer NOT NULL,
    template character varying(64) NOT NULL,
    template_version character varying(12) NOT NULL,
    to_email character varying(320) NOT NULL,
    subject text,
    body text NOT NULL,
    provenance jsonb NOT NULL,
    state character varying(32) NOT NULL,
    message_id character varying(255),
    detail text,
    approved_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    gmail_id character varying(64),
    thread_id character varying(64),
    attempted_at timestamp with time zone,
    transport character varying(32),
    run_id uuid,
    sent_run_id uuid,
    review_reason character varying(32),
    edited_at timestamp with time zone,
    open_token character varying(64),
    approved_by character varying(32),
    CONSTRAINT ck_messages_approvalsource CHECK (((approved_by)::text = ANY ((ARRAY['operator'::character varying, 'auto'::character varying])::text[]))),
    CONSTRAINT ck_messages_approved_by_iff_approved_at CHECK (((approved_by IS NULL) = (approved_at IS NULL))),
    CONSTRAINT ck_messages_message_id_before_send CHECK ((((state)::text <> ALL ((ARRAY['sending'::character varying, 'sent'::character varying, 'unknown'::character varying])::text[])) OR (message_id IS NOT NULL))),
    CONSTRAINT ck_messages_messagestate CHECK (((state)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'rejected'::character varying, 'sending'::character varying, 'sent'::character varying, 'skipped'::character varying, 'failed'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT ck_messages_rejectreason CHECK (((review_reason)::text = ANY ((ARRAY['wrong_fact'::character varying, 'too_salesy'::character varying, 'generic_opener'::character varying, 'bad_tone'::character varying, 'wrong_person'::character varying, 'bad_address'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT ck_messages_review_reason_only_on_reject CHECK (((review_reason IS NULL) OR ((state)::text = 'rejected'::text))),
    CONSTRAINT ck_messages_sent_at_iff_sent CHECK (((sent_at IS NOT NULL) = ((state)::text = 'sent'::text))),
    CONSTRAINT ck_messages_transport_iff_attempted CHECK (((attempted_at IS NULL) = (transport IS NULL)))
);


--
-- Name: thread_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_events (
    id integer NOT NULL,
    enrollment_id integer NOT NULL,
    in_reply_to_message_id integer,
    kind character varying(32) NOT NULL,
    bounce_class character varying(32),
    disposition character varying(32),
    disposition_source character varying(32),
    classified_at timestamp with time zone,
    gmail_id character varying(64),
    gmail_thread_id character varying(64),
    from_address character varying(320),
    subject text,
    snippet text,
    headers jsonb,
    detail text,
    received_at timestamp with time zone NOT NULL,
    run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body_text text,
    classification jsonb,
    CONSTRAINT ck_thread_events_bounce_class_iff_bounce CHECK ((((kind)::text = 'bounce'::text) = (bounce_class IS NOT NULL))),
    CONSTRAINT ck_thread_events_bounceclass CHECK (((bounce_class)::text = ANY ((ARRAY['hard'::character varying, 'soft'::character varying])::text[]))),
    CONSTRAINT ck_thread_events_disposition_only_on_reply CHECK (((disposition IS NULL) OR ((kind)::text = 'reply'::text))),
    CONSTRAINT ck_thread_events_disposition_source_iff_disposition CHECK (((disposition IS NULL) = (disposition_source IS NULL))),
    CONSTRAINT ck_thread_events_dispositionsource CHECK (((disposition_source)::text = ANY ((ARRAY['rule'::character varying, 'operator'::character varying, 'llm'::character varying])::text[]))),
    CONSTRAINT ck_thread_events_replydisposition CHECK (((disposition)::text = ANY ((ARRAY['interested'::character varying, 'meeting_booked'::character varying, 'not_interested'::character varying, 'not_now'::character varying, 'wrong_person'::character varying, 'referral'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT ck_thread_events_threadeventkind CHECK (((kind)::text = ANY ((ARRAY['reply'::character varying, 'bounce'::character varying, 'auto_reply'::character varying, 'unsubscribe'::character varying, 'complaint'::character varying, 'note'::character varying])::text[])))
);


--
-- Name: campaign_funnel; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.campaign_funnel AS
 WITH sends AS (
         SELECT m.enrollment_id,
            count(*) FILTER (WHERE (m.step = 0)) AS openers_sent,
            count(*) FILTER (WHERE (m.step > 0)) AS followups_sent
           FROM public.messages m
          WHERE ((m.state)::text = 'sent'::text)
          GROUP BY m.enrollment_id
        ), inbound AS (
         SELECT te.enrollment_id,
            count(*) FILTER (WHERE ((te.kind)::text = 'reply'::text)) AS replies,
            count(*) FILTER (WHERE ((te.disposition)::text = ANY ((ARRAY['interested'::character varying, 'meeting_booked'::character varying])::text[]))) AS interested,
            count(*) FILTER (WHERE ((te.kind)::text = 'auto_reply'::text)) AS auto_replies,
            count(*) FILTER (WHERE (((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'hard'::text))) AS hard_bounces,
            count(*) FILTER (WHERE ((te.kind)::text = 'unsubscribe'::text)) AS unsubscribes
           FROM public.thread_events te
          GROUP BY te.enrollment_id
        )
 SELECT e.niche,
    e.sequence_name,
    e.kind AS enrollment_kind,
    count(*) AS enrolled,
    count(*) FILTER (WHERE ((e.state)::text = 'active'::text)) AS active,
    count(*) FILTER (WHERE ((e.state)::text = 'finished'::text)) AS finished,
    count(*) FILTER (WHERE ((e.stop_reason)::text = 'reply'::text)) AS stopped_reply,
    count(*) FILTER (WHERE ((e.stop_reason)::text = 'bounce'::text)) AS stopped_bounce,
    count(*) FILTER (WHERE ((e.stop_reason)::text = 'opt_out'::text)) AS stopped_opt_out,
    count(*) FILTER (WHERE ((e.stop_reason)::text = 'complaint'::text)) AS stopped_complaint,
    count(*) FILTER (WHERE ((e.stop_reason)::text = 'manual'::text)) AS stopped_manual,
    COALESCE(sum(sends.openers_sent), (0)::numeric) AS openers_sent,
    COALESCE(sum(sends.followups_sent), (0)::numeric) AS followups_sent,
    COALESCE(sum(inbound.replies), (0)::numeric) AS replies,
    COALESCE(sum(inbound.interested), (0)::numeric) AS interested,
    COALESCE(sum(inbound.auto_replies), (0)::numeric) AS auto_replies,
    COALESCE(sum(inbound.hard_bounces), (0)::numeric) AS hard_bounces,
    COALESCE(sum(inbound.unsubscribes), (0)::numeric) AS unsubscribes
   FROM ((public.enrollments e
     LEFT JOIN sends ON ((sends.enrollment_id = e.id)))
     LEFT JOIN inbound ON ((inbound.enrollment_id = e.id)))
  GROUP BY e.niche, e.sequence_name, e.kind;


--
-- Name: VIEW campaign_funnel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.campaign_funnel IS 'campaign_funnel is the whole campaign in one row per (niche, sequence, enrollment kind) (C-D8): enrolled, still active, finished, stopped by each reason, openers vs follow-ups actually sent, and the inbound outcomes -- replies, interested (disposition interested or meeting_booked), auto-replies, hard bounces, unsubscribes. Kind is a dimension because whether role inboxes deserve sends at all is an open question (Phase B). There is no campaign entity: (niche, sequence_name) is pinned on every enrollment and caps live per inbox and per fleet, which is where reputation lives. Opens/clicks are absent by decision (N-D5).';


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: contact_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_candidates (
    id integer NOT NULL,
    person_id integer NOT NULL,
    email character varying(320) NOT NULL,
    domain character varying(255) NOT NULL,
    evidence character varying(32) NOT NULL,
    pattern character varying(32),
    rank integer NOT NULL,
    state character varying(32) NOT NULL,
    source_ref text NOT NULL,
    lead_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_contact_candidates_candidateevidence CHECK (((evidence)::text = ANY ((ARRAY['scraped'::character varying, 'derived_pattern'::character varying, 'guessed_pattern'::character varying])::text[]))),
    CONSTRAINT ck_contact_candidates_candidatestate CHECK (((state)::text = ANY ((ARRAY['candidate'::character varying, 'queued'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: contact_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_candidates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_candidates_id_seq OWNED BY public.contact_candidates.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id integer NOT NULL,
    company_id integer,
    url text NOT NULL,
    final_url text,
    kind character varying(32) NOT NULL,
    status_code integer,
    content_hash character varying(64) NOT NULL,
    title text,
    text text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    html text,
    fetch_tier character varying(16) DEFAULT 'httpx'::character varying NOT NULL,
    is_shell boolean DEFAULT false NOT NULL,
    robots_disallowed boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_documents_documentkind CHECK (((kind)::text = ANY ((ARRAY['webpage'::character varying, 'pdf'::character varying])::text[])))
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: enrichments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichments (
    id integer NOT NULL,
    document_id integer,
    kind character varying(32) NOT NULL,
    model character varying(64) NOT NULL,
    prompt_version character varying(16) NOT NULL,
    output jsonb NOT NULL,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id integer,
    run_id uuid,
    CONSTRAINT ck_enrichments_enrichmentkind CHECK (((kind)::text = ANY ((ARRAY['people_extraction'::character varying, 'firmographics'::character varying, 'email_scan'::character varying, 'email_pick'::character varying])::text[]))),
    CONSTRAINT ck_enrichments_one_subject CHECK (((document_id IS NULL) <> (company_id IS NULL)))
);


--
-- Name: enrichments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enrichments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enrichments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enrichments_id_seq OWNED BY public.enrichments.id;


--
-- Name: enrollment_outcomes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.enrollment_outcomes AS
 WITH opener AS (
         SELECT m.enrollment_id,
            m.template AS opener_template,
            m.template_version AS opener_template_version,
            m.state AS opener_state,
            (m.provenance -> 'address'::text) AS address
           FROM public.messages m
          WHERE (m.step = 0)
        ), sends AS (
         SELECT m.enrollment_id,
            count(*) FILTER (WHERE ((m.state)::text = 'sent'::text)) AS steps_sent,
            min(m.sent_at) AS first_sent_at,
            max(m.sent_at) AS last_sent_at
           FROM public.messages m
          GROUP BY m.enrollment_id
        ), events AS (
         SELECT te.enrollment_id,
            count(*) FILTER (WHERE ((te.kind)::text = 'reply'::text)) AS replies,
            bool_or(((te.kind)::text = 'reply'::text)) AS replied,
            bool_or((((te.kind)::text = 'reply'::text) AND ((te.disposition)::text = ANY ((ARRAY['interested'::character varying, 'meeting_booked'::character varying])::text[])))) AS interested,
            bool_or((((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'hard'::text))) AS hard_bounced,
            bool_or((((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'soft'::text))) AS soft_bounced,
            bool_or(((te.kind)::text = 'unsubscribe'::text)) AS unsubscribed,
            bool_or(((te.kind)::text = 'complaint'::text)) AS complained,
            bool_or(((te.kind)::text = 'auto_reply'::text)) AS auto_replied,
            min(te.received_at) FILTER (WHERE ((te.kind)::text = 'reply'::text)) AS first_reply_at,
            (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE (((te.kind)::text = 'reply'::text) AND (te.disposition IS NOT NULL))))[1] AS disposition
           FROM public.thread_events te
          GROUP BY te.enrollment_id
        )
 SELECT e.id AS enrollment_id,
    e.niche,
    e.sequence_name,
    e.kind AS enrollment_kind,
    e.company_id,
    e.person_id,
    e.to_email,
    e.sender,
    e.state,
    e.stop_reason,
    e.created_at AS enrolled_at,
    o.opener_template,
    o.opener_template_version,
    o.opener_state,
    (o.address ->> 'evidence'::text) AS evidence,
    (o.address ->> 'verification_result'::text) AS verification_result,
    (o.address ->> 'pick_method'::text) AS pick_method,
    ((o.address ->> 'lead_id'::text))::integer AS lead_id,
    ((o.address ->> 'candidate_id'::text))::integer AS candidate_id,
    ((o.address ->> 'document_id'::text))::integer AS source_document_id,
    (o.address ->> 'source_url'::text) AS source_url,
    COALESCE(s.steps_sent, (0)::bigint) AS steps_sent,
    s.first_sent_at,
    s.last_sent_at,
    COALESCE(ev.replies, (0)::bigint) AS replies,
    COALESCE(ev.replied, false) AS replied,
    COALESCE(ev.interested, false) AS interested,
    ev.disposition,
    COALESCE(ev.hard_bounced, false) AS hard_bounced,
    COALESCE(ev.soft_bounced, false) AS soft_bounced,
    COALESCE(ev.unsubscribed, false) AS unsubscribed,
    COALESCE(ev.complained, false) AS complained,
    COALESCE(ev.auto_replied, false) AS auto_replied,
    ev.first_reply_at
   FROM (((public.enrollments e
     LEFT JOIN opener o ON ((o.enrollment_id = e.id)))
     LEFT JOIN sends s ON ((s.enrollment_id = e.id)))
     LEFT JOIN events ev ON ((ev.enrollment_id = e.id)));


--
-- Name: VIEW enrollment_outcomes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.enrollment_outcomes IS 'enrollment_outcomes is one row per enrollment: the pinned campaign dimensions, the opener''s address provenance (Phase D, messages.provenance.address: evidence tier, verification result, pick method, source page), and the thread''s outcome folded to booleans. Every reply_by_* view is a GROUP BY over it; a per-niche segment split is a JOIN with the niche''s facts view (agency_facts USING (company_id)) -- core never names a niche''s columns (D32/D33).';


--
-- Name: enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enrollments_id_seq OWNED BY public.enrollments.id;


--
-- Name: firm_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.firm_facts AS
 WITH facts AS (
         WITH newest_sighting AS (
                 SELECT DISTINCT ON (sightings.company_id) sightings.company_id,
                    sightings.raw,
                    sightings.seen_at
                   FROM public.sightings
                  WHERE ((sightings.company_id IS NOT NULL) AND (sightings.raw ? '5F(2)(c)'::text))
                  ORDER BY sightings.company_id, sightings.seen_at DESC
                ), eff AS (
                 SELECT c_1.id AS company_id,
                    COALESCE(ns.raw, c_1.raw) AS raw,
                    ns.seen_at AS last_seen_at
                   FROM (public.companies c_1
                     LEFT JOIN newest_sighting ns ON ((ns.company_id = c_1.id)))
                )
         SELECT c.id AS company_id,
            c.source_key,
            c.domain,
            c.name,
            c.country,
            (NULLIF(regexp_replace(split_part((eff.raw ->> '5F(2)(c)'::text), '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::bigint AS aum_usd,
            (NULLIF(regexp_replace(split_part((eff.raw ->> '5A'::text), '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::integer AS employees,
            (NULLIF(regexp_replace(split_part((eff.raw ->> '5D(a)(1)'::text), '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::integer AS ind_clients,
            (NULLIF(regexp_replace(split_part((eff.raw ->> '5D(b)(1)'::text), '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::integer AS hnw_clients,
            (NULLIF(regexp_replace(split_part((eff.raw ->> '5D(f)(1)'::text), '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::integer AS pooled_clients,
            (eff.raw ->> 'Main Office Country'::text) AS country_raw,
            eff.last_seen_at
           FROM (public.companies c
             JOIN eff ON ((eff.company_id = c.id)))
          WHERE (eff.raw ? '5F(2)(c)'::text)
        )
 SELECT company_id,
    source_key,
    domain,
    name,
    country,
    aum_usd,
    employees,
    ind_clients,
    hnw_clients,
    pooled_clients,
    country_raw,
    last_seen_at,
        CASE
            WHEN ((COALESCE(ind_clients, 0) > 0) OR (COALESCE(hnw_clients, 0) > 0)) THEN 'individual'::text
            WHEN (COALESCE(pooled_clients, 0) > 0) THEN 'pooled'::text
            WHEN ((ind_clients IS NOT NULL) OR (hnw_clients IS NOT NULL) OR (pooled_clients IS NOT NULL)) THEN 'institutional'::text
            ELSE 'unknown'::text
        END AS segment
   FROM facts;


--
-- Name: VIEW firm_facts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.firm_facts IS 'firm_facts is the ONLY sanctioned targeting read surface (audit F2/F3). One row per company that filed Form ADV item 5F(2)(c) (regulatory AUM); facts are read from the newest FACT-BEARING sighting (raw carries the roster-dialect keys -- adapters for other products, e.g. the daily firm feed, must prepend them), else the owning companys create-time raw. Non-fact sightings (discovery evidence, corroborations) never shadow facts. Currency/count fields are parsed once here -- never re-derive them from raw ad hoc. segment (D29) is the canonical client-mix classification: individual = serves people (ADV 5D(a)/(b) > 0), pooled = fund shop (5D(f) > 0, no individuals), institutional = filed counts but none of those, unknown = never filed them. Campaigns email all segments and track the difference; segment never gates storage.';


--
-- Name: funnel_latency; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.funnel_latency AS
 WITH stamps AS (
         SELECT c.id AS company_id,
            c.niche,
            c.domain,
            c.created_at AS imported_at,
            ( SELECT min(d.fetched_at) AS min
                   FROM public.documents d
                  WHERE (d.company_id = c.id)) AS first_fetch_at,
            ( SELECT min(e.created_at) AS min
                   FROM public.enrollments e
                  WHERE (e.company_id = c.id)) AS enrolled_at,
            ( SELECT min(m.sent_at) AS min
                   FROM (public.messages m
                     JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
                  WHERE ((e.company_id = c.id) AND (m.step = 0) AND ((m.state)::text = 'sent'::text))) AS first_send_at,
            ( SELECT min(te.received_at) AS min
                   FROM (public.thread_events te
                     JOIN public.enrollments e ON ((e.id = te.enrollment_id)))
                  WHERE ((e.company_id = c.id) AND ((te.kind)::text = 'reply'::text))) AS first_reply_at
           FROM public.companies c
        )
 SELECT company_id,
    niche,
    domain,
    imported_at,
    first_fetch_at,
    enrolled_at,
    first_send_at,
    first_reply_at,
    (EXTRACT(epoch FROM (first_fetch_at - imported_at)) / 86400.0) AS days_import_to_fetch,
    (EXTRACT(epoch FROM (enrolled_at - imported_at)) / 86400.0) AS days_import_to_enroll,
    (EXTRACT(epoch FROM (first_send_at - enrolled_at)) / 86400.0) AS days_enroll_to_send,
    (EXTRACT(epoch FROM (first_send_at - imported_at)) / 86400.0) AS days_import_to_send,
    (EXTRACT(epoch FROM (first_reply_at - first_send_at)) / 86400.0) AS days_send_to_reply
   FROM stamps s;


--
-- Name: VIEW funnel_latency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.funnel_latency IS 'funnel_latency is one row per company: import -> first fetch -> enroll -> first send -> first reply as timestamps and day gaps (NULL where the stage has not happened). days_import_to_send is the number that must fall for ''ramp from 0 asap'' (first-sends section 8).';


--
-- Name: import_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_errors (
    id integer NOT NULL,
    import_id integer NOT NULL,
    row_number integer NOT NULL,
    kind character varying(32) NOT NULL,
    reason text NOT NULL,
    raw jsonb,
    company_id integer,
    claimant_company_id integer,
    CONSTRAINT ck_import_errors_importerrorkind CHECK (((kind)::text = ANY ((ARRAY['rejected'::character varying, 'domain_conflict'::character varying, 'domain_changed'::character varying])::text[])))
);


--
-- Name: import_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_errors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_errors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_errors_id_seq OWNED BY public.import_errors.id;


--
-- Name: imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.imports (
    id integer NOT NULL,
    source_type character varying(32) NOT NULL,
    source_ref text NOT NULL,
    stats jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash character varying(64),
    as_of date,
    superseded_by integer,
    defaults jsonb
);


--
-- Name: imports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.imports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.imports_id_seq OWNED BY public.imports.id;


--
-- Name: inbox_syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_syncs (
    sender character varying(320) NOT NULL,
    cursor_ms bigint DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone,
    stats jsonb
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id integer NOT NULL,
    email character varying(320) NOT NULL,
    first_name character varying,
    last_name character varying,
    title character varying,
    persona character varying(64),
    source character varying(64),
    geo character varying(64),
    status character varying(32) NOT NULL,
    raw jsonb NOT NULL,
    company_id integer,
    import_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    country character varying(2),
    suppression_id integer,
    social_url character varying(512),
    CONSTRAINT ck_leads_leadstatus CHECK (((status)::text = ANY ((ARRAY['imported'::character varying, 'verified'::character varying, 'suppressed'::character varying, 'undeliverable'::character varying])::text[])))
);


--
-- Name: leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leads_id_seq OWNED BY public.leads.id;


--
-- Name: llm_calls; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.llm_calls AS
 SELECT e.id AS enrichment_id,
    NULL::integer AS thread_event_id,
    e.run_id,
    (e.kind)::text AS kind,
    (e.model)::text AS model,
    ((e.output -> 'call'::text) ->> 'provider'::text) AS provider,
    (e.prompt_version)::text AS prompt_version,
    e.company_id,
    e.document_id,
    ((((e.output -> 'call'::text) -> 'usage'::text) ->> 'input'::text))::integer AS input_tokens,
    ((((e.output -> 'call'::text) -> 'usage'::text) ->> 'output'::text))::integer AS output_tokens,
    ((((e.output -> 'call'::text) -> 'usage'::text) ->> 'total'::text))::integer AS total_tokens,
    ((((e.output -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text))::integer AS reasoning_tokens,
    (((e.output -> 'call'::text) ->> 'latency_ms'::text))::integer AS latency_ms,
    ((e.output -> 'call'::text) ->> 'finish_reason'::text) AS finish_reason,
    COALESCE((((e.output -> 'call'::text) ->> 'rejected'::text))::boolean, false) AS rejected,
    ((e.output ->> 'parse_error'::text) IS NOT NULL) AS parse_failed,
    (e.output ? 'call'::text) AS has_call_record,
    e.applied_at,
    e.created_at
   FROM public.enrichments e
  WHERE (((e.model)::text <> 'deterministic'::text) AND (jsonb_typeof((e.output -> 'call'::text)) IS DISTINCT FROM 'null'::text))
UNION ALL
 SELECT NULL::integer AS enrichment_id,
    te.id AS thread_event_id,
    (((te.classification -> 'call'::text) ->> 'run_id'::text))::uuid AS run_id,
    'reply_disposition'::text AS kind,
    (te.classification ->> 'model'::text) AS model,
    ((te.classification -> 'call'::text) ->> 'provider'::text) AS provider,
    (te.classification ->> 'prompt_version'::text) AS prompt_version,
    en.company_id,
    NULL::integer AS document_id,
    ((((te.classification -> 'call'::text) -> 'usage'::text) ->> 'input'::text))::integer AS input_tokens,
    ((((te.classification -> 'call'::text) -> 'usage'::text) ->> 'output'::text))::integer AS output_tokens,
    ((((te.classification -> 'call'::text) -> 'usage'::text) ->> 'total'::text))::integer AS total_tokens,
    ((((te.classification -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text))::integer AS reasoning_tokens,
    (((te.classification -> 'call'::text) ->> 'latency_ms'::text))::integer AS latency_ms,
    ((te.classification -> 'call'::text) ->> 'finish_reason'::text) AS finish_reason,
    COALESCE((((te.classification -> 'call'::text) ->> 'rejected'::text))::boolean, false) AS rejected,
    ((te.classification ->> 'parse_error'::text) IS NOT NULL) AS parse_failed,
    (te.classification ? 'call'::text) AS has_call_record,
        CASE
            WHEN ((te.disposition_source)::text = 'llm'::text) THEN te.classified_at
            ELSE NULL::timestamp with time zone
        END AS applied_at,
    ((te.classification ->> 'classified_at'::text))::timestamp with time zone AS created_at
   FROM (public.thread_events te
     JOIN public.enrollments en ON ((en.id = te.enrollment_id)))
  WHERE ((te.classification IS NOT NULL) AND (jsonb_typeof((te.classification -> 'call'::text)) IS DISTINCT FROM 'null'::text));


--
-- Name: VIEW llm_calls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.llm_calls IS 'llm_calls is the audit surface for paid completions (section 8 of the 2026-09-07 next-steps design, N-D4): one row per LLM enrichment, plus -- since Phase C -- one per reply the disposition classifier read (kind = reply_disposition, thread_event_id set, enrichment_id NULL), usage and latency read from the normalized call record that emailsgen.llm.audit writes, never from a provider''s own body shape. has_call_record=false marks pre-ledger rows awaiting `emailsgen enrich backfill-calls`. Deterministic (email_scan) rows, picks that took a free route, and replies with no text (call = null) are excluded: nothing was bought.';


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: open_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_events (
    id integer NOT NULL,
    message_id integer NOT NULL,
    remote_id bigint NOT NULL,
    seen_at timestamp with time zone NOT NULL,
    user_agent text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id uuid
);


--
-- Name: open_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_events_id_seq OWNED BY public.open_events.id;


--
-- Name: open_outcomes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.open_outcomes AS
 WITH tracked AS (
         SELECT m.id,
            m.sent_at,
            m.template,
            e.niche,
            e.sequence_name,
            m.step
           FROM (public.messages m
             JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
          WHERE (((m.state)::text = 'sent'::text) AND (m.open_token IS NOT NULL))
        ), hits AS (
         SELECT t_1.id,
            count(oe.id) AS fetches,
            count(oe.id) FILTER (WHERE ((oe.seen_at - t_1.sent_at) >= '00:02:00'::interval)) AS slow_fetches
           FROM (tracked t_1
             LEFT JOIN public.open_events oe ON ((oe.message_id = t_1.id)))
          GROUP BY t_1.id
        )
 SELECT t.niche,
    t.sequence_name,
    t.step,
    t.template,
    count(*) AS tracked_sent,
    count(*) FILTER (WHERE (h.fetches > 0)) AS opened_raw,
    count(*) FILTER (WHERE (h.slow_fetches > 0)) AS opened_human_plausible,
    sum(h.fetches) AS fetches,
    ((count(*) FILTER (WHERE (h.fetches > 0)))::numeric / (NULLIF(count(*), 0))::numeric) AS open_rate_raw,
    ((count(*) FILTER (WHERE (h.slow_fetches > 0)))::numeric / (NULLIF(count(*), 0))::numeric) AS open_rate_human_plausible
   FROM (tracked t
     JOIN hits h ON ((h.id = t.id)))
  GROUP BY t.niche, t.sequence_name, t.step, t.template
  ORDER BY t.niche, t.sequence_name, t.step;


--
-- Name: open_syncs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_syncs (
    base_url character varying(255) NOT NULL,
    cursor_id bigint DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone,
    stats jsonb
);


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people (
    id integer NOT NULL,
    source_key character varying(64),
    company_id integer NOT NULL,
    full_name text NOT NULL,
    first_name character varying,
    last_name character varying,
    title text,
    is_compliance boolean NOT NULL,
    origin character varying(32) NOT NULL,
    origin_ref text NOT NULL,
    as_of date,
    linkedin_url character varying(512),
    notes text,
    import_id integer,
    raw jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_testimonial boolean DEFAULT false NOT NULL,
    testimonial_org text,
    CONSTRAINT ck_people_personorigin CHECK (((origin)::text = ANY ((ARRAY['registry'::character varying, 'website'::character varying, 'document'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: people_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.people_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: people_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.people_id_seq OWNED BY public.people.id;


--
-- Name: person_facts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.person_facts AS
 SELECT p.id AS person_id,
    p.company_id,
    c.source_key AS company_source_key,
    c.name AS company_name,
    c.domain AS company_domain,
    c.niche AS company_niche,
    p.source_key,
    p.full_name,
    p.first_name,
    p.last_name,
    p.title,
    p.is_compliance,
    p.is_testimonial,
    p.testimonial_org,
    p.origin,
    p.as_of,
    p.linkedin_url,
        CASE
            WHEN (p.title IS NULL) THEN NULL::integer
            WHEN p.is_testimonial THEN NULL::integer
            WHEN ((c.niche)::text = 'sec_ria'::text) THEN
            CASE
                WHEN (p.title ~* '\y(vice president|executive vice|senior vice)\y'::text) THEN 3
                WHEN (p.title ~* '\y(owner|founder|principal|chief executive|ceo|president|managing member|manager)\y'::text) THEN 1
                WHEN (p.title ~* '\y(cio|chief investment|coo|chief operating|managing partner|managing director|partner)\y'::text) THEN 2
                WHEN (p.title ~* '\y(cmo|chief marketing|business development|wealth advisor|financial advisor|portfolio manager|director)\y'::text) THEN 3
                ELSE NULL::integer
            END
            WHEN ((c.niche)::text = 'agencies'::text) THEN
            CASE
                WHEN (p.title ~* '\y(vice president|executive vice|senior vice)\y'::text) THEN 3
                WHEN (p.title ~* '\y(owner|founder|co-founder|chief executive|ceo|president|principal|managing director|managing partner)\y'::text) THEN 1
                WHEN (p.title ~* '\y(coo|chief operating|operations director|head of operations|general manager|managing member|partner)\y'::text) THEN 2
                WHEN (p.title ~* '\y(cmo|chief marketing|creative director|marketing director|account director|business development|head of|director)\y'::text) THEN 3
                ELSE NULL::integer
            END
            ELSE
            CASE
                WHEN (p.title ~* '\y(vice president|executive vice|senior vice)\y'::text) THEN 3
                WHEN (p.title ~* '\y(owner|founder|co-founder|chief executive|ceo|president|managing member)\y'::text) THEN 1
                WHEN (p.title ~* '\y(coo|chief operating|managing partner|managing director)\y'::text) THEN 2
                WHEN (p.title ~* '\y(director|head of)\y'::text) THEN 3
                ELSE NULL::integer
            END
        END AS role_rank,
    (p.is_compliance OR COALESCE((p.title ~* '\y(compliance|counsel|attorney|paralegal|regulatory)\y'::text), false)) AS avoid_emailing_first
   FROM (public.people p
     JOIN public.companies c ON ((c.id = p.company_id)));


--
-- Name: VIEW person_facts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.person_facts IS 'person_facts is the sanctioned read surface for people (Phase 2 spec section 7, D33): role_rank is the per-niche send-order taxonomy, branched on company_niche so amending one niche taxonomy can never re-rank people of another niche (1 = owner/CEO tier, 2 = COO tier, 3 = director tier, NULL = unranked); avoid_emailing_first marks compliance staff. Send queries prefer the lowest rank among non-avoid people and only fall back when a firm has nobody else. A new niche adds its own CASE branch via its own migration -- views are the sanctioned niche surface; tables never change. A person tagged is_testimonial is a client quoted on the website of the company they are attached to, not staff: they rank NULL before any niche branch is consulted, so the customers of a firm can never be enrolled under it. testimonial_org names who they were quoted for.';


--
-- Name: postmaster_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postmaster_days (
    domain character varying(253) NOT NULL,
    day date NOT NULL,
    spam_rate double precision,
    domain_reputation character varying(32),
    spf_success_ratio double precision,
    dkim_success_ratio double precision,
    dmarc_success_ratio double precision,
    raw jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id uuid,
    delivery_error_rate double precision,
    tls_outbound_count bigint,
    tls_inbound_count bigint
);


--
-- Name: rejections_by_reason; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rejections_by_reason AS
 SELECT e.niche,
    m.template,
    m.template_version,
    COALESCE(m.review_reason, 'unspecified'::character varying) AS reason,
    count(*) AS rejected
   FROM (public.messages m
     JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
  WHERE ((m.state)::text = 'rejected'::text)
  GROUP BY e.niche, m.template, m.template_version, COALESCE(m.review_reason, 'unspecified'::character varying);


--
-- Name: VIEW rejections_by_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.rejections_by_reason IS 'rejections_by_reason counts struck drafts per niche x template x version x RejectReason (wrong_fact / too_salesy / generic_opener / bad_tone / wrong_person / bad_address / other; ''unspecified'' = struck before the vocabulary existed). A reason that keeps landing in ''other'' becomes a value.';


--
-- Name: reply_by_arm_step; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reply_by_arm_step AS
 SELECT e.niche,
        CASE
            WHEN (strpos((o.template)::text, '/'::text) > 0) THEN (split_part((o.template)::text, '/'::text, 1))::character varying
            ELSE o.template
        END AS arm,
    m.step,
    m.template,
    m.template_version,
    count(DISTINCT m.id) FILTER (WHERE ((m.state)::text = 'sent'::text)) AS sent,
    count(DISTINCT te.id) FILTER (WHERE ((te.kind)::text = 'reply'::text)) AS replies,
    count(DISTINCT te.id) FILTER (WHERE (((te.kind)::text = 'reply'::text) AND ((te.disposition)::text = ANY ((ARRAY['interested'::character varying, 'meeting_booked'::character varying])::text[])))) AS interested,
    count(DISTINCT te.id) FILTER (WHERE (((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'hard'::text))) AS hard_bounces,
    round(((100.0 * (count(DISTINCT te.id) FILTER (WHERE ((te.kind)::text = 'reply'::text)))::numeric) / (NULLIF(count(DISTINCT m.id) FILTER (WHERE ((m.state)::text = 'sent'::text)), 0))::numeric), 2) AS reply_rate_pct
   FROM (((public.messages m
     JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
     JOIN public.messages o ON (((o.enrollment_id = e.id) AND (o.step = 0))))
     LEFT JOIN public.thread_events te ON ((te.in_reply_to_message_id = m.id)))
  GROUP BY e.niche, o.template, m.step, m.template, m.template_version;


--
-- Name: VIEW reply_by_arm_step; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.reply_by_arm_step IS 'reply_by_arm_step is the offer-arm A/B surface: the arm is the directory the opener was authored in (pilot/opener -> pilot; a root-level opener is its own arm, D48), and each step has its sends and the replies attributed to it (thread_events.in_reply_to_message_id, C-D4) beside it. No automatic variant winner by decision (D36): the operator reads the split.';


--
-- Name: reply_by_evidence; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reply_by_evidence AS
 SELECT niche,
    enrollment_kind,
    evidence,
    COALESCE(verification_result, 'none'::text) AS verification_result,
    pick_method,
    count(*) AS enrolled,
    count(*) FILTER (WHERE (first_sent_at IS NOT NULL)) AS opened,
    count(*) FILTER (WHERE replied) AS replied,
    count(*) FILTER (WHERE interested) AS interested,
    count(*) FILTER (WHERE hard_bounced) AS hard_bounced,
    count(*) FILTER (WHERE unsubscribed) AS unsubscribed,
    round(((100.0 * (count(*) FILTER (WHERE replied))::numeric) / (NULLIF(count(*) FILTER (WHERE (first_sent_at IS NOT NULL)), 0))::numeric), 2) AS reply_rate_pct,
    round(((100.0 * (count(*) FILTER (WHERE hard_bounced))::numeric) / (NULLIF(count(*) FILTER (WHERE (first_sent_at IS NOT NULL)), 0))::numeric), 2) AS bounce_rate_pct
   FROM public.enrollment_outcomes eo
  GROUP BY niche, enrollment_kind, evidence, COALESCE(verification_result, 'none'::text), pick_method;


--
-- Name: VIEW reply_by_evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.reply_by_evidence IS 'reply_by_evidence splits outcomes by how the address was obtained (scraped / derived_pattern / guessed_pattern / pick), whether a verification cleared it (''none'' = never bought -- the role-inbox policy, P-D2), and for picks which route chose it (auto_accept / classify). Rates are over opened enrollments (first step sent), not enrolled ones.';


--
-- Name: reply_outcomes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reply_outcomes AS
 SELECT te.id AS event_id,
    te.enrollment_id,
    e.niche,
    e.sequence_name,
    e.kind AS enrollment_kind,
    e.sender,
    e.company_id,
    e.to_email,
    te.kind,
    te.bounce_class,
    te.disposition,
    te.disposition_source,
    te.received_at,
    origin.step AS replied_to_step,
    origin.template AS replied_to_template,
    origin.template_version AS replied_to_template_version
   FROM ((public.thread_events te
     JOIN public.enrollments e ON ((e.id = te.enrollment_id)))
     LEFT JOIN public.messages origin ON ((origin.id = te.in_reply_to_message_id)));


--
-- Name: VIEW reply_outcomes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.reply_outcomes IS 'reply_outcomes is one row per inbound event with the campaign dimensions already pinned on its enrollment (C-D8): niche, sequence (the offer arm), enrollment kind, sending inbox, company, address -- plus the step and template version the event answered. This is the surface the A/B question is read from; there is no automatic variant winner by decision (D36), the operator reads the split. The evidence and pick splits (which page an address came from, which pick method chose it) are reply_by_evidence over enrollment_outcomes (Phase D, d4f7a1c2e9b8); a segment split is a JOIN of enrollment_outcomes with the niche''s facts view (P-D8).';


--
-- Name: review_outcomes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.review_outcomes AS
 SELECT e.niche,
    m.template,
    m.template_version,
    count(*) AS drafted,
    count(*) FILTER (WHERE ((m.state)::text = 'draft'::text)) AS awaiting,
    count(*) FILTER (WHERE (m.edited_at IS NOT NULL)) AS edited,
    count(*) FILTER (WHERE ((m.approved_by)::text = 'operator'::text)) AS approved,
    count(*) FILTER (WHERE ((m.approved_by)::text = 'auto'::text)) AS auto_approved,
    count(*) FILTER (WHERE ((m.state)::text = 'rejected'::text)) AS rejected,
    count(*) FILTER (WHERE ((m.state)::text = 'sent'::text)) AS sent,
    count(*) FILTER (WHERE (((m.approved_by)::text = 'operator'::text) OR ((m.state)::text = 'rejected'::text))) AS reviewed,
    round(((100.0 * (count(*) FILTER (WHERE (m.edited_at IS NOT NULL)))::numeric) / (NULLIF(count(*) FILTER (WHERE (((m.approved_by)::text = 'operator'::text) OR ((m.state)::text = 'rejected'::text))), 0))::numeric), 2) AS edit_rate_pct,
    round(((100.0 * (count(*) FILTER (WHERE ((m.state)::text = 'rejected'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (((m.approved_by)::text = 'operator'::text) OR ((m.state)::text = 'rejected'::text))), 0))::numeric), 2) AS reject_rate_pct
   FROM (public.messages m
     JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
  GROUP BY e.niche, m.template, m.template_version;


--
-- Name: VIEW review_outcomes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.review_outcomes IS 'review_outcomes is the review as data (U-D7/U-D11): per niche x template x version, how many drafts a reviewer edited, approved or struck, and the edit/reject rates over REVIEWED rows -- an operator''s approvals plus rejections. Drafts compose approved itself (auto_approved) are counted but never divided by: nobody read them. Read it after a review session: a template version whose edit rate climbs is the copy pass''s next target, and it says so before any reply arrives.';


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid NOT NULL,
    command character varying(64) NOT NULL,
    argv jsonb NOT NULL,
    niche character varying(64),
    model character varying(64),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    stats jsonb
);


--
-- Name: send_health; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.send_health AS
 SELECT sender,
    split_part((sender)::text, '@'::text, 2) AS domain,
    day,
    sum(sent) AS sent,
    sum(hard_bounces) AS hard_bounces,
    sum(soft_bounces) AS soft_bounces,
    sum(replies) AS replies,
    sum(auto_replies) AS auto_replies,
    sum(unsubscribes) AS unsubscribes,
    sum(complaints) AS complaints,
    ((sum(hard_bounces))::numeric / (NULLIF(sum(sent), 0))::numeric) AS bounce_rate
   FROM ( SELECT e.sender,
            ((m.sent_at AT TIME ZONE 'UTC'::text))::date AS day,
            1 AS sent,
            0 AS hard_bounces,
            0 AS soft_bounces,
            0 AS replies,
            0 AS auto_replies,
            0 AS unsubscribes,
            0 AS complaints
           FROM (public.messages m
             JOIN public.enrollments e ON ((e.id = m.enrollment_id)))
          WHERE ((m.state)::text = 'sent'::text)
        UNION ALL
         SELECT e.sender,
            COALESCE(((origin.sent_at AT TIME ZONE 'UTC'::text))::date, ((te.received_at AT TIME ZONE 'UTC'::text))::date) AS day,
            0 AS sent,
                CASE
                    WHEN (((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'hard'::text)) THEN 1
                    ELSE 0
                END AS hard_bounces,
                CASE
                    WHEN (((te.kind)::text = 'bounce'::text) AND ((te.bounce_class)::text = 'soft'::text)) THEN 1
                    ELSE 0
                END AS soft_bounces,
                CASE
                    WHEN ((te.kind)::text = 'reply'::text) THEN 1
                    ELSE 0
                END AS replies,
                CASE
                    WHEN ((te.kind)::text = 'auto_reply'::text) THEN 1
                    ELSE 0
                END AS auto_replies,
                CASE
                    WHEN ((te.kind)::text = 'unsubscribe'::text) THEN 1
                    ELSE 0
                END AS unsubscribes,
                CASE
                    WHEN ((te.kind)::text = 'complaint'::text) THEN 1
                    ELSE 0
                END AS complaints
           FROM ((public.thread_events te
             JOIN public.enrollments e ON ((e.id = te.enrollment_id)))
             LEFT JOIN public.messages origin ON ((origin.id = te.in_reply_to_message_id)))
          WHERE ((te.kind)::text <> 'note'::text)) rows
  GROUP BY sender, day;


--
-- Name: VIEW send_health; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.send_health IS 'send_health is the daily reputation surface per sending inbox (C-D8, designs/2026-09-08-campaign-parity.md section 8): sends counted on the UTC date they left, inbound events attributed to the day of the send they answer (their own received_at when no originating message is named), bounce_rate = hard bounces over sends. `outreach health` reads today''s rows and the trailing window the kill switches evaluate (C-D7: 2% with at least 2 hard bounces, or any complaint, pauses every inbox on the domain). Opens and clicks are deliberately absent -- we do not track them (N-D5); replies are the metric. Operator notes (kind = ''note'') are excluded from the event arm: a note is an annotation, not deliverability evidence, and counting one would conjure a (sender, day) row with sent = 0 and a NULL bounce_rate.';


--
-- Name: sender_pauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sender_pauses (
    id integer NOT NULL,
    sender character varying(320) NOT NULL,
    domain character varying(255) NOT NULL,
    reason text NOT NULL,
    source character varying(32) NOT NULL,
    paused_at timestamp with time zone DEFAULT now() NOT NULL,
    lifted_at timestamp with time zone,
    lifted_by character varying(64),
    detail jsonb,
    CONSTRAINT ck_sender_pauses_pausesource CHECK (((source)::text = ANY ((ARRAY['kill_switch'::character varying, 'operator'::character varying])::text[])))
);


--
-- Name: sender_pauses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sender_pauses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sender_pauses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sender_pauses_id_seq OWNED BY public.sender_pauses.id;


--
-- Name: sightings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sightings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sightings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sightings_id_seq OWNED BY public.sightings.id;


--
-- Name: stage_costs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stage_costs AS
 SELECT c.run_id,
    r.command,
    r.niche,
    c.kind,
    c.model,
    c.provider,
    count(*) AS calls,
    count(*) FILTER (WHERE c.rejected) AS rejected_calls,
    count(*) FILTER (WHERE c.parse_failed) AS parse_failures,
    sum(c.input_tokens) AS input_tokens,
    sum(c.output_tokens) AS output_tokens,
    sum(c.total_tokens) AS total_tokens,
    sum(c.reasoning_tokens) AS reasoning_tokens,
    (avg(c.latency_ms))::integer AS avg_latency_ms,
    max(c.latency_ms) AS max_latency_ms,
    min(c.created_at) AS first_call_at,
    max(c.created_at) AS last_call_at
   FROM (public.llm_calls c
     LEFT JOIN public.runs r ON ((r.id = c.run_id)))
  GROUP BY c.run_id, r.command, r.niche, c.kind, c.model, c.provider;


--
-- Name: VIEW stage_costs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.stage_costs IS 'stage_costs rolls llm_calls up per (run, kind, model): the token bill of one CLI invocation, one stage, one provider. run_id NULL groups every pre-ledger row. Dollars are deliberately absent until a price table exists (open item, 2026-09-07).';


--
-- Name: suppression_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppression_events (
    id integer NOT NULL,
    suppression_id integer NOT NULL,
    reason character varying(32) NOT NULL,
    evidence jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_suppression_events_suppressionreason CHECK (((reason)::text = ANY ((ARRAY['opt_out'::character varying, 'bounce'::character varying, 'complaint'::character varying, 'manual'::character varying, 'lifted'::character varying])::text[])))
);


--
-- Name: suppression_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppression_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppression_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppression_events_id_seq OWNED BY public.suppression_events.id;


--
-- Name: suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressions (
    id integer NOT NULL,
    kind character varying(32) NOT NULL,
    value character varying(320) NOT NULL,
    reason character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT ck_suppressions_suppressionkind CHECK (((kind)::text = ANY ((ARRAY['email'::character varying, 'domain'::character varying])::text[]))),
    CONSTRAINT ck_suppressions_suppressionreason CHECK (((reason)::text = ANY ((ARRAY['opt_out'::character varying, 'bounce'::character varying, 'complaint'::character varying, 'manual'::character varying, 'lifted'::character varying])::text[])))
);


--
-- Name: suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppressions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppressions_id_seq OWNED BY public.suppressions.id;


--
-- Name: template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_versions (
    id integer NOT NULL,
    niche character varying(32) NOT NULL,
    template character varying(64) NOT NULL,
    version character varying(12) NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: template_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.template_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: template_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.template_versions_id_seq OWNED BY public.template_versions.id;


--
-- Name: thread_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.thread_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: thread_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.thread_events_id_seq OWNED BY public.thread_events.id;


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id integer NOT NULL,
    lead_id integer,
    verifier character varying(64) NOT NULL,
    result character varying(32) NOT NULL,
    raw jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    email character varying(320),
    contact_candidate_id integer,
    CONSTRAINT ck_verifications_attributed CHECK (((lead_id IS NOT NULL) OR (contact_candidate_id IS NOT NULL))),
    CONSTRAINT ck_verifications_verificationresult CHECK (((result)::text = ANY ((ARRAY['valid'::character varying, 'invalid'::character varying, 'risky'::character varying, 'catch_all'::character varying])::text[])))
);


--
-- Name: verification_yield; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.verification_yield AS
 WITH newest AS (
         SELECT DISTINCT ON (cc_1.id) cc_1.id AS candidate_id,
            v.result
           FROM (public.contact_candidates cc_1
             JOIN public.verifications v ON (((v.contact_candidate_id = cc_1.id) OR ((cc_1.lead_id IS NOT NULL) AND (v.lead_id = cc_1.lead_id)))))
          ORDER BY cc_1.id, v.checked_at DESC, v.id DESC
        )
 SELECT c.niche,
    cc.evidence,
    count(*) AS candidates,
    count(n.candidate_id) AS verified,
    count(*) FILTER (WHERE ((n.result)::text = 'valid'::text)) AS valid,
    count(*) FILTER (WHERE ((n.result)::text = 'invalid'::text)) AS invalid,
    count(*) FILTER (WHERE ((n.result)::text = 'risky'::text)) AS risky,
    count(*) FILTER (WHERE ((n.result)::text = 'catch_all'::text)) AS catch_all,
    round(((100.0 * (count(*) FILTER (WHERE ((n.result)::text = 'valid'::text)))::numeric) / (NULLIF(count(n.candidate_id), 0))::numeric), 2) AS valid_rate_pct
   FROM (((public.contact_candidates cc
     JOIN public.people p ON ((p.id = cc.person_id)))
     JOIN public.companies c ON ((c.id = p.company_id)))
     LEFT JOIN newest n ON ((n.candidate_id = cc.id)))
  GROUP BY c.niche, cc.evidence;


--
-- Name: VIEW verification_yield; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.verification_yield IS 'verification_yield is the free cascade''s hit rate (initial spec section 14, U-D8): per niche x evidence tier, how many candidates were minted, how many bought a verdict (newest per candidate), and how many came back valid. The number to read before the next credit is bought: a tier whose valid rate sits under the bounce budget is not worth a credit.';


--
-- Name: verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verifications_id_seq OWNED BY public.verifications.id;


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: contact_candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_candidates ALTER COLUMN id SET DEFAULT nextval('public.contact_candidates_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: enrichments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments ALTER COLUMN id SET DEFAULT nextval('public.enrichments_id_seq'::regclass);


--
-- Name: enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments ALTER COLUMN id SET DEFAULT nextval('public.enrollments_id_seq'::regclass);


--
-- Name: import_errors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors ALTER COLUMN id SET DEFAULT nextval('public.import_errors_id_seq'::regclass);


--
-- Name: imports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imports ALTER COLUMN id SET DEFAULT nextval('public.imports_id_seq'::regclass);


--
-- Name: leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads ALTER COLUMN id SET DEFAULT nextval('public.leads_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: open_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_events ALTER COLUMN id SET DEFAULT nextval('public.open_events_id_seq'::regclass);


--
-- Name: people id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people ALTER COLUMN id SET DEFAULT nextval('public.people_id_seq'::regclass);


--
-- Name: sender_pauses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_pauses ALTER COLUMN id SET DEFAULT nextval('public.sender_pauses_id_seq'::regclass);


--
-- Name: sightings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings ALTER COLUMN id SET DEFAULT nextval('public.sightings_id_seq'::regclass);


--
-- Name: suppression_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_events ALTER COLUMN id SET DEFAULT nextval('public.suppression_events_id_seq'::regclass);


--
-- Name: suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions ALTER COLUMN id SET DEFAULT nextval('public.suppressions_id_seq'::regclass);


--
-- Name: template_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions ALTER COLUMN id SET DEFAULT nextval('public.template_versions_id_seq'::regclass);


--
-- Name: thread_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_events ALTER COLUMN id SET DEFAULT nextval('public.thread_events_id_seq'::regclass);


--
-- Name: verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications ALTER COLUMN id SET DEFAULT nextval('public.verifications_id_seq'::regclass);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: companies pk_companies; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT pk_companies PRIMARY KEY (id);


--
-- Name: contact_candidates pk_contact_candidates; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_candidates
    ADD CONSTRAINT pk_contact_candidates PRIMARY KEY (id);


--
-- Name: documents pk_documents; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT pk_documents PRIMARY KEY (id);


--
-- Name: enrichments pk_enrichments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT pk_enrichments PRIMARY KEY (id);


--
-- Name: enrollments pk_enrollments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT pk_enrollments PRIMARY KEY (id);


--
-- Name: import_errors pk_import_errors; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT pk_import_errors PRIMARY KEY (id);


--
-- Name: imports pk_imports; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imports
    ADD CONSTRAINT pk_imports PRIMARY KEY (id);


--
-- Name: inbox_syncs pk_inbox_syncs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_syncs
    ADD CONSTRAINT pk_inbox_syncs PRIMARY KEY (sender);


--
-- Name: leads pk_leads; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT pk_leads PRIMARY KEY (id);


--
-- Name: messages pk_messages; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT pk_messages PRIMARY KEY (id);


--
-- Name: open_events pk_open_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_events
    ADD CONSTRAINT pk_open_events PRIMARY KEY (id);


--
-- Name: open_syncs pk_open_syncs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_syncs
    ADD CONSTRAINT pk_open_syncs PRIMARY KEY (base_url);


--
-- Name: people pk_people; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT pk_people PRIMARY KEY (id);


--
-- Name: postmaster_days pk_postmaster_days; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postmaster_days
    ADD CONSTRAINT pk_postmaster_days PRIMARY KEY (domain, day);


--
-- Name: runs pk_runs; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT pk_runs PRIMARY KEY (id);


--
-- Name: sender_pauses pk_sender_pauses; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_pauses
    ADD CONSTRAINT pk_sender_pauses PRIMARY KEY (id);


--
-- Name: sightings pk_sightings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings
    ADD CONSTRAINT pk_sightings PRIMARY KEY (id);


--
-- Name: suppression_events pk_suppression_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_events
    ADD CONSTRAINT pk_suppression_events PRIMARY KEY (id);


--
-- Name: suppressions pk_suppressions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions
    ADD CONSTRAINT pk_suppressions PRIMARY KEY (id);


--
-- Name: template_versions pk_template_versions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT pk_template_versions PRIMARY KEY (id);


--
-- Name: thread_events pk_thread_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_events
    ADD CONSTRAINT pk_thread_events PRIMARY KEY (id);


--
-- Name: verifications pk_verifications; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT pk_verifications PRIMARY KEY (id);


--
-- Name: companies uq_companies_domain; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT uq_companies_domain UNIQUE (domain);


--
-- Name: companies uq_companies_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT uq_companies_source_key UNIQUE (source_key);


--
-- Name: contact_candidates uq_contact_candidates_person_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_candidates
    ADD CONSTRAINT uq_contact_candidates_person_id UNIQUE (person_id, email);


--
-- Name: documents uq_documents_url; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT uq_documents_url UNIQUE (url, content_hash);


--
-- Name: enrichments uq_enrichments_company_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT uq_enrichments_company_id UNIQUE (company_id, kind, model, prompt_version);


--
-- Name: enrichments uq_enrichments_document_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT uq_enrichments_document_id UNIQUE (document_id, kind, model, prompt_version);


--
-- Name: leads uq_leads_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT uq_leads_email UNIQUE (email);


--
-- Name: messages uq_messages_enrollment_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT uq_messages_enrollment_id UNIQUE (enrollment_id, step);


--
-- Name: messages uq_messages_open_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT uq_messages_open_token UNIQUE (open_token);


--
-- Name: open_events uq_open_events_remote_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_events
    ADD CONSTRAINT uq_open_events_remote_id UNIQUE (remote_id);


--
-- Name: people uq_people_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT uq_people_source_key UNIQUE (source_key);


--
-- Name: suppressions uq_suppressions_kind; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions
    ADD CONSTRAINT uq_suppressions_kind UNIQUE (kind, value);


--
-- Name: template_versions uq_template_versions_niche; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT uq_template_versions_niche UNIQUE (niche, template, version);


--
-- Name: ix_contact_candidates_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contact_candidates_domain ON public.contact_candidates USING btree (domain);


--
-- Name: ix_contact_candidates_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contact_candidates_person_id ON public.contact_candidates USING btree (person_id);


--
-- Name: ix_documents_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_documents_company_id ON public.documents USING btree (company_id);


--
-- Name: ix_enrichments_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrichments_company_id ON public.enrichments USING btree (company_id);


--
-- Name: ix_enrichments_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrichments_document_id ON public.enrichments USING btree (document_id);


--
-- Name: ix_enrichments_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrichments_run_id ON public.enrichments USING btree (run_id);


--
-- Name: ix_enrollments_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrollments_company_id ON public.enrollments USING btree (company_id);


--
-- Name: ix_enrollments_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrollments_person_id ON public.enrollments USING btree (person_id);


--
-- Name: ix_enrollments_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_enrollments_run_id ON public.enrollments USING btree (run_id);


--
-- Name: ix_import_errors_import_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_import_errors_import_id ON public.import_errors USING btree (import_id);


--
-- Name: ix_messages_enrollment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_messages_enrollment_id ON public.messages USING btree (enrollment_id);


--
-- Name: ix_messages_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_messages_run_id ON public.messages USING btree (run_id);


--
-- Name: ix_messages_sent_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_messages_sent_run_id ON public.messages USING btree (sent_run_id);


--
-- Name: ix_open_events_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_open_events_message_id ON public.open_events USING btree (message_id);


--
-- Name: ix_open_events_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_open_events_run_id ON public.open_events USING btree (run_id);


--
-- Name: ix_open_events_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_open_events_seen_at ON public.open_events USING btree (seen_at);


--
-- Name: ix_people_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_people_company_id ON public.people USING btree (company_id);


--
-- Name: ix_postmaster_days_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_postmaster_days_run_id ON public.postmaster_days USING btree (run_id);


--
-- Name: ix_sender_pauses_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sender_pauses_sender ON public.sender_pauses USING btree (sender);


--
-- Name: ix_sightings_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sightings_company_id ON public.sightings USING btree (company_id);


--
-- Name: ix_sightings_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sightings_lead_id ON public.sightings USING btree (lead_id);


--
-- Name: ix_sightings_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sightings_person_id ON public.sightings USING btree (person_id);


--
-- Name: ix_suppression_events_suppression_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_suppression_events_suppression_id ON public.suppression_events USING btree (suppression_id);


--
-- Name: ix_thread_events_enrollment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_thread_events_enrollment_id ON public.thread_events USING btree (enrollment_id);


--
-- Name: ix_thread_events_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_thread_events_run_id ON public.thread_events USING btree (run_id);


--
-- Name: ix_verifications_contact_candidate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_verifications_contact_candidate_id ON public.verifications USING btree (contact_candidate_id);


--
-- Name: ix_verifications_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_verifications_lead_id ON public.verifications USING btree (lead_id);


--
-- Name: uq_enrollments_active_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrollments_active_address ON public.enrollments USING btree (lower((to_email)::text)) WHERE ((state)::text = 'active'::text);


--
-- Name: uq_enrollments_active_company; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrollments_active_company ON public.enrollments USING btree (company_id) WHERE ((state)::text = 'active'::text);


--
-- Name: uq_enrollments_active_person; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrollments_active_person ON public.enrollments USING btree (person_id) WHERE ((state)::text = 'active'::text);


--
-- Name: uq_sender_pauses_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sender_pauses_active ON public.sender_pauses USING btree (sender) WHERE (lifted_at IS NULL);


--
-- Name: uq_thread_events_gmail_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_thread_events_gmail_id ON public.thread_events USING btree (gmail_id) WHERE (gmail_id IS NOT NULL);


--
-- Name: companies fk_companies_import_id_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT fk_companies_import_id_imports FOREIGN KEY (import_id) REFERENCES public.imports(id);


--
-- Name: contact_candidates fk_contact_candidates_lead_id_leads; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_candidates
    ADD CONSTRAINT fk_contact_candidates_lead_id_leads FOREIGN KEY (lead_id) REFERENCES public.leads(id);


--
-- Name: contact_candidates fk_contact_candidates_person_id_people; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_candidates
    ADD CONSTRAINT fk_contact_candidates_person_id_people FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: documents fk_documents_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT fk_documents_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: enrichments fk_enrichments_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT fk_enrichments_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: enrichments fk_enrichments_document_id_documents; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT fk_enrichments_document_id_documents FOREIGN KEY (document_id) REFERENCES public.documents(id);


--
-- Name: enrichments fk_enrichments_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichments
    ADD CONSTRAINT fk_enrichments_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: enrollments fk_enrollments_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT fk_enrollments_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: enrollments fk_enrollments_person_id_people; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT fk_enrollments_person_id_people FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: enrollments fk_enrollments_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT fk_enrollments_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: import_errors fk_import_errors_claimant_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT fk_import_errors_claimant_company_id_companies FOREIGN KEY (claimant_company_id) REFERENCES public.companies(id);


--
-- Name: import_errors fk_import_errors_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT fk_import_errors_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: import_errors fk_import_errors_import_id_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT fk_import_errors_import_id_imports FOREIGN KEY (import_id) REFERENCES public.imports(id);


--
-- Name: imports fk_imports_superseded_by_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.imports
    ADD CONSTRAINT fk_imports_superseded_by_imports FOREIGN KEY (superseded_by) REFERENCES public.imports(id);


--
-- Name: leads fk_leads_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT fk_leads_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: leads fk_leads_import_id_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT fk_leads_import_id_imports FOREIGN KEY (import_id) REFERENCES public.imports(id);


--
-- Name: leads fk_leads_suppression_id_suppressions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT fk_leads_suppression_id_suppressions FOREIGN KEY (suppression_id) REFERENCES public.suppressions(id);


--
-- Name: messages fk_messages_enrollment_id_enrollments; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_enrollment_id_enrollments FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);


--
-- Name: messages fk_messages_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: messages fk_messages_sent_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_sent_run_id_runs FOREIGN KEY (sent_run_id) REFERENCES public.runs(id);


--
-- Name: open_events fk_open_events_message_id_messages; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_events
    ADD CONSTRAINT fk_open_events_message_id_messages FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: open_events fk_open_events_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_events
    ADD CONSTRAINT fk_open_events_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: people fk_people_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT fk_people_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: people fk_people_import_id_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT fk_people_import_id_imports FOREIGN KEY (import_id) REFERENCES public.imports(id);


--
-- Name: postmaster_days fk_postmaster_days_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postmaster_days
    ADD CONSTRAINT fk_postmaster_days_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: sightings fk_sightings_company_id_companies; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings
    ADD CONSTRAINT fk_sightings_company_id_companies FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: sightings fk_sightings_import_id_imports; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings
    ADD CONSTRAINT fk_sightings_import_id_imports FOREIGN KEY (import_id) REFERENCES public.imports(id);


--
-- Name: sightings fk_sightings_lead_id_leads; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings
    ADD CONSTRAINT fk_sightings_lead_id_leads FOREIGN KEY (lead_id) REFERENCES public.leads(id);


--
-- Name: sightings fk_sightings_person_id_people; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sightings
    ADD CONSTRAINT fk_sightings_person_id_people FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: suppression_events fk_suppression_events_suppression_id_suppressions; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_events
    ADD CONSTRAINT fk_suppression_events_suppression_id_suppressions FOREIGN KEY (suppression_id) REFERENCES public.suppressions(id);


--
-- Name: thread_events fk_thread_events_enrollment_id_enrollments; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_events
    ADD CONSTRAINT fk_thread_events_enrollment_id_enrollments FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);


--
-- Name: thread_events fk_thread_events_in_reply_to_message_id_messages; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_events
    ADD CONSTRAINT fk_thread_events_in_reply_to_message_id_messages FOREIGN KEY (in_reply_to_message_id) REFERENCES public.messages(id);


--
-- Name: thread_events fk_thread_events_run_id_runs; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_events
    ADD CONSTRAINT fk_thread_events_run_id_runs FOREIGN KEY (run_id) REFERENCES public.runs(id);


--
-- Name: verifications fk_verifications_contact_candidate_id_contact_candidates; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT fk_verifications_contact_candidate_id_contact_candidates FOREIGN KEY (contact_candidate_id) REFERENCES public.contact_candidates(id);


--
-- Name: verifications fk_verifications_lead_id_leads; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT fk_verifications_lead_id_leads FOREIGN KEY (lead_id) REFERENCES public.leads(id);


--
-- PostgreSQL database dump complete
--



/**
 * Profiles (designs/2026-10-14-customerio-audit.md, B1): one person in a workspace, by every
 * address they go by. `profile_keys` is one address (an email, a phone, a handle on a platform,
 * the site's visitor cookie, a CRM id, a `people` row); one key is one profile's, at most.
 * `profile_traits` is what we know about them, one row per key, each change kept in
 * `profile_trait_events`. Two profiles found to be one merge into the older: its keys and traits
 * move, the younger keeps its row with `merged_into` set, and `profile_merges` says what moved.
 * Nothing here is ever deleted. Only `./profiles.ts` writes these.
 *
 * The timeline (`profile_timeline`) reads the source tables through the keys. The one copy is
 * `profile_events`: lines whose rows live in another database (B7).
 *
 * Research (designs/2026-10-17-people-depth.md): `profile_lookups` is one "Research this person"
 * run, `profile_findings` what it found, each kept or dropped by a person. The research service
 * writes these; a kept handle becomes a key through `./profiles.ts`.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { BROKEN_IG_URL } from "./touches-schema.js";

/** Key kinds past the platform handles (`handle:<platform>`) and CRM ids (`crm:<source>`). */
export const PROFILE_KEY_KINDS = ["email", "phone", "visitor", "person"] as const;

/** What a timeline line is, as its kind filter lists them. */
export const TIMELINE_KINDS = [
  "email_sent",
  "email_received",
  "text_sent",
  "text_received",
  "call_in",
  "voice_call",
  "call",
  "touch",
  "consent",
  "form",
  "chat",
  "booking",
  "payment",
  "workflow",
  "trait",
  "merge",
  "journey",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
export const TIMELINE_KIND_NAMES: Readonly<Record<TimelineKind, string>> = {
  email_sent: "Email sent",
  email_received: "Email received",
  text_sent: "Text sent",
  text_received: "Text received",
  call_in: "Called in",
  voice_call: "Voice agent call",
  call: "Called",
  touch: "Social touch",
  consent: "Consent",
  form: "Form sent",
  chat: "Site chat",
  booking: "Booking",
  payment: "Payment",
  workflow: "Workflow",
  trait: "Trait changed",
  merge: "Merged",
  journey: "Journey",
};

export const profiles = pgTable(
  "profiles",
  {
    id: serial("id").notNull(),
    /** The best name any source gave; the first one stands until a person changes it. */
    name: text("name"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
    /** Set when this profile turned out to be another's: that one holds its keys now. */
    mergedInto: integer("merged_into"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profiles" }),
    index("ix_profiles_merged_into").on(t.mergedInto),
    index("ix_profiles_last_seen").on(t.lastSeen),
    foreignKey({
      columns: [t.mergedInto],
      foreignColumns: [t.id],
      name: "fk_profiles_merged_into_profiles",
    }),
  ],
);

export const profileKeys = pgTable(
  "profile_keys",
  {
    id: serial("id").notNull(),
    profileId: integer("profile_id").notNull(),
    /** `email`, `phone`, `visitor`, `person`, `handle:<platform>` or `crm:<source>`. */
    kind: varchar("kind", { length: 48 }).notNull(),
    /** Normalized (`keyOf`): a lowercased email, an E.164 phone, a bare handle. */
    value: varchar("value", { length: 320 }).notNull(),
    /** The writer that first saw it: `lead_import`, `sms_contact`, `site_form`, ... */
    source: varchar("source", { length: 32 }).notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_keys" }),
    unique("uq_profile_keys_kind_value").on(t.kind, t.value),
    index("ix_profile_keys_profile_id").on(t.profileId, t.kind),
    // A record's page reads its lines by id as text (`records-serve`): this serves the timeline.
    index("ix_profile_keys_profile_text").on(sql`(${t.profileId}::text)`),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_keys_profile_id_profiles",
    }),
  ],
);

export const profileTraits = pgTable(
  "profile_traits",
  {
    profileId: integer("profile_id").notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    value: jsonb("value").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.key], name: "pk_profile_traits" }),
    index("ix_profile_traits_key").on(t.key),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_traits_profile_id_profiles",
    }),
  ],
);

/** Append only: every change to a trait, old and new. What B5's "trait changed" reads. */
export const profileTraitEvents = pgTable(
  "profile_trait_events",
  {
    id: serial("id").notNull(),
    profileId: integer("profile_id").notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    old: jsonb("old"),
    new: jsonb("new").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_trait_events" }),
    index("ix_profile_trait_events_profile_id").on(t.profileId, t.at),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_trait_events_profile_id_profiles",
    }),
  ],
);

/** One merge: `from_id` turned out to be `into_id`; what moved, and which key showed it. */
export const profileMerges = pgTable(
  "profile_merges",
  {
    id: serial("id").notNull(),
    intoId: integer("into_id").notNull(),
    fromId: integer("from_id").notNull(),
    /** The key both were found by: `email:a@b.co`. */
    by: varchar("by", { length: 400 }).notNull(),
    keys: integer("keys").notNull(),
    traits: integer("traits").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_merges" }),
    index("ix_profile_merges_into_id").on(t.intoId),
    index("ix_profile_merges_from_id").on(t.fromId),
    foreignKey({
      columns: [t.intoId],
      foreignColumns: [profiles.id],
      name: "fk_profile_merges_into_id_profiles",
    }),
    foreignKey({
      columns: [t.fromId],
      foreignColumns: [profiles.id],
      name: "fk_profile_merges_from_id_profiles",
    }),
  ],
);

/**
 * One timeline line whose row lives in another database (B7): a client's form entries and pay
 * links are kept in Wren's main database, and a workspace view can't read that. The only copy the
 * timeline keeps, one line per source row, rewritten when the row changes (a pay link paid).
 */
export const profileEvents = pgTable(
  "profile_events",
  {
    id: serial("id").notNull(),
    profileId: integer("profile_id").notNull(),
    /** A `TIMELINE_KINDS` kind: `form`, `payment`. */
    kind: varchar("kind", { length: 24 }).notNull(),
    channel: varchar("channel", { length: 24 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    body: text("body"),
    /** Its page in the portal: `/payments/links/<id>`. */
    link: text("link"),
    /** The table and row it stands for, in main: `pay_links`, its id. */
    source: varchar("source", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_events" }),
    unique("uq_profile_events_source").on(t.source, t.sourceId),
    index("ix_profile_events_profile_id").on(t.profileId, t.at),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_events_profile_id_profiles",
    }),
  ],
);

/** A timeline line's columns, every branch the same. */
const LINE = sql.raw(`lines.id, lines.profile_id, lines.at, lines.kind, lines.channel,
  lines.summary, lines.body, lines.link, lines.source,
  coalesce(p.name, '#' || p.id) who, '/people/people/' || p.id profile_link, lines.context,
  case when lines.source = 'touches' and lines.link is null then 'No link for this one' end note`);

/**
 * Every line about one profile, over the source tables by its keys (never copied). Each line:
 * its time, kind, channel, one line, the whole thing (`body`), where its row shows in the
 * portal (`link`, when it has a page) and the table it came from. A client's rows kept on main
 * (its forms, pay links) come in through `profile_events`; the `site_forms` branch is Wren's own.
 */
export const profileTimeline = pgView("profile_timeline", {
  id: text("id"),
  profileId: integer("profile_id"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  channel: text("channel"),
  summary: text("summary"),
  body: text("body"),
  link: text("link"),
  source: text("source"),
  who: text("who"),
  profileLink: text("profile_link"),
  context: text("context"),
  note: text("note"),
}).as(sql`
  select ${LINE} from (
  select 'message:' || m.id id, k.profile_id, coalesce(m.sent_at, m.created_at) at,
    'email_sent' kind, 'email' channel, coalesce(nullif(m.subject, ''), '(no subject)') summary,
    m.body, null::text link, 'messages' source, null::text context
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join messages m on m.enrollment_id = e.id
  where k.kind = 'email' and m.sent_at is not null
  union all
  select 'thread_event:' || t.id, k.profile_id, t.received_at, 'email_received', 'email',
    replace(t.kind, '_', ' ') || ': ' || coalesce(nullif(t.subject, ''), t.snippet, ''),
    coalesce(t.body_text, t.snippet), null, 'thread_events', null
  from profile_keys k
  join enrollments e on lower(e.to_email) = k.value
  join thread_events t on t.enrollment_id = e.id
  where k.kind = 'email' and t.kind <> 'note'
  union all
  select 'sms_message:' || s.id, k.profile_id, coalesce(s.received_at, s.sent_at, s.created_at),
    case when s.direction = 'in' then 'text_received' else 'text_sent' end, 'sms',
    s.body, s.body, '/marketing/texts/' || c.id, 'sms_messages', null
  from profile_keys k
  join sms_contacts c on c.e164 = k.value
  join sms_messages s on s.contact_id = c.id
  where k.kind = 'phone' and (s.direction = 'in' or s.sent_at is not null)
  union all
  select 'sms_call:' || x.id, k.profile_id, x.started_at, 'call_in', 'phone',
    'Called in: ' || coalesce(x.result, 'ringing'), x.text_back_detail,
    case when x.contact_id is not null then '/marketing/texts/' || x.contact_id end, 'sms_calls', null
  from profile_keys k
  join sms_calls x on x.from_e164 = k.value
  where k.kind = 'phone'
  union all
  select 'voice_call:' || v.id, k.profile_id, v.started_at, 'voice_call', 'phone',
    v.direction || ' call: ' || v.outcome, v.message, '/voice/calls/' || v.id, 'voice_calls', null
  from profile_keys k
  join voice_calls v on k.value in (v.from_number, v.to_number)
  where k.kind = 'phone'
  union all
  select 'call:' || c.id, k.profile_id, c.called_at, 'call', 'phone', 'Called by ' || c.called_by,
    null, '/reactivation/people/' || c.person_id, 'calls', null
  from profile_keys k
  join calls c on c.person_id::text = k.value
  where k.kind = 'person'
  union all
  select 'touch:' || t.id, k.profile_id, t.at, 'touch', h.platform,
    case t.direction when 'ours' then 'We ' else 'They ' end || t.kind
      || coalesce(': ' || t.text, ''),
    t.text, t.link, 'touches', nullif(case when t.url ~ '${sql.raw(BROKEN_IG_URL)}' then null else t.url end, '')
  from profile_keys k
  join social_handles h on k.kind = 'handle:' || h.platform and h.handle = k.value
  join touches t on t.handle_id = h.id
  where k.kind like 'handle:%'
  union all
  select 'consent_event:' || ce.id, k.profile_id, ce.created_at, 'consent', c.channel,
    tp.public_name || ': ' || ce.kind || ' (' || ce.by || ')', ce.evidence::text, null,
    'consent_events', null
  from profile_keys k
  join consents c on c.address = k.value
    and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
  join topics tp on tp.id = c.topic_id
  join consent_events ce on ce.consent_id = c.id
  where k.kind in ('email', 'phone')
  union all
  select 'site_form:' || e.id, hit.profile_id, e.at, 'form', 'site',
    coalesce(f.name, p.title, 'A form') || ' sent',
    concat_ws(chr(10) || chr(10),
      (select string_agg(a || ': ' || b, chr(10) order by a) from jsonb_each_text(e.fields) x(a, b)),
      'Pages seen first: '
        || (select string_agg(v ->> 'path', ', ' order by n) from jsonb_array_elements(e.pages)
          with ordinality y(v, n))),
    '/sites/submissions/' || e.id, 'site_forms', null
  from (
    select e.id, k.profile_id from profile_keys k
      join site_forms e on lower(e.fields ->> 'email') = k.value where k.kind = 'email'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on k.value in (e.fields ->> 'phone',
        '+' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'),
        '+1' || regexp_replace(e.fields ->> 'phone', '[^0-9]', '', 'g'))
      where k.kind = 'phone'
    union
    select e.id, k.profile_id from profile_keys k
      join site_forms e on e.visitor = k.value where k.kind = 'visitor'
  ) hit
  join site_forms e on e.id = hit.id
  left join site_form_defs f on f.id = e.form
  left join site_pages p on p.id = e.page
  where coalesce(f.client, p.client) is null
  union all
  select 'chat_message:' || m.id, k.profile_id, m.at, 'chat', 'site',
    case when m.direction = 'in' then 'They wrote: ' else 'We wrote: ' end || m.body,
    m.body, null, 'chat_messages', null
  from (
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on lower(t.email) = k.value where k.kind = 'email'
    union
    select t.id, k.profile_id from profile_keys k
      join chat_threads t on k.value in (t.phone, '+' || t.phone, '+1' || t.phone)
      where k.kind = 'phone'
  ) k
  join chat_messages m on m.thread_id = k.id
  union all
  select 'booking:' || b.id, k.profile_id, b.created_at, 'booking', 'calendar',
    case when b.state = 'cancelled' then 'Cancelled the call on ' else 'Booked a call for ' end
      || to_char(b.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
    b.reason, '/calendar/calls/' || b.id, 'bookings', null
  from profile_keys k
  join calendar.bookings b on lower(b.email) = k.value
  where k.kind = 'email'
  union all
  select 'call_booking:' || cb.id, k.profile_id, coalesce(cb.booked_at, cb.start), 'booking',
    'calendar', 'Booked a call' || coalesce(' for '
      || to_char(cb.start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', ''),
    cb.outcome, '/calls/calls/' || cb.id, 'call_bookings', null
  from profile_keys k
  join call_bookings cb on lower(cb.email) = k.value
  where k.kind = 'email' and cb.uid not like 'wren-%'
  union all
  -- Text like every other branch: a varchar here also stops a kind filter reaching the branches.
  select 'profile_event:' || pe.id, pe.profile_id, pe.at, pe.kind::text, pe.channel::text,
    pe.summary, pe.body, pe.link, pe.source::text, null
  from profile_events pe
  union all
  -- DISTINCT ON sits one level down: at a branch's top it stops Postgres pushing a reader's
  -- kind filter into every branch, and each read built all of them (282k rows, 2026-10-16).
  select 'event:' || x.id, x.profile_id, x.at, 'workflow', 'workflow', 'Entered ' || x.workflow,
    x.subject, null, 'events', null
  from (
    select distinct on (ev.workflow, ev.subject, w.profile_id) ev.id, w.profile_id, ev.at,
      ev.workflow, ev.subject
    from (
      select k.profile_id, 'lead:email:' || e.id subject from profile_keys k
        join enrollments e on lower(e.to_email) = k.value where k.kind = 'email'
      union all
      select k.profile_id, 'lead:sms:' || c.id from profile_keys k
        join sms_contacts c on c.e164 = k.value where k.kind = 'phone'
    ) w
    join events ev on ev.subject = w.subject
  ) x
  union all
  select 'trait_event:' || te.id, te.profile_id, te.at, 'trait', 'profile',
    te.key || ': ' || coalesce(te.old::text, 'none') || ' to ' || te.new::text, null, null,
    'profile_trait_events', null
  from profile_trait_events te
  union all
  select 'merge:' || pm.id, pm.into_id, pm.at, 'merge', 'profile',
    'Profile #' || pm.from_id || ' merged in by ' || pm.by, null, null, 'profile_merges', null
  from profile_merges pm
  ) lines
  join profiles p on p.id = lines.profile_id`);

/** Each trait's changes, for its page's History. */
export const profileTraitActivity = pgView("profile_trait_activity", {
  trait: text("trait"),
  seq: integer("seq"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
  select e.profile_id || ':' || e.key trait, e.id seq, e.at, e.source::text kind,
    coalesce(e.old::text, 'none') || ' to ' || e.new::text what
  from profile_trait_events e`);

/**
 * The People list, one row per live profile: everything `profile_records` shows, kept exact by
 * statement triggers (`profile_list_refresh`, migration 0325) on `profiles`, `profile_rollups`,
 * `profile_keys`, `profile_traits`, `profile_merges`, `consents` and `sms_contacts`. The list
 * reads one table: counting 158k rows through per-row subqueries took 8.6 s. Never write it.
 */
export const profileList = pgTable(
  "profile_list",
  {
    profileId: integer("profile_id").notNull(),
    name: text("name").notNull(),
    emails: text("emails"),
    phones: text("phones"),
    handles: text("handles"),
    channels: text("channels"),
    consent: text("consent"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    keys: integer("keys").notNull(),
    traits: integer("traits").notNull(),
    merged: integer("merged").notNull(),
    stage: text("stage").notNull(),
    warmth: text("warmth").notNull(),
    why: text("why"),
    warmthLine: text("warmth_line"),
    warmSince: timestamp("warm_since", { withTimezone: true }),
    persona: text("persona").notNull(),
    personaRole: text("persona_role").notNull(),
    personaNiche: text("persona_niche").notNull(),
    personaSize: text("persona_size").notNull(),
    subscriptions: text("subscriptions"),
    replies: integer("replies").notNull(),
    repliedLast: timestamp("replied_last", { withTimezone: true }),
    repliedChannel: text("replied_channel"),
    firstChannel: text("first_channel"),
    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
    lastChannel: text("last_channel"),
    cameFrom: text("came_from"),
    lead: text("lead"),
  },
  (t) => [
    primaryKey({ columns: [t.profileId], name: "pk_profile_list" }),
    // The records list finds a row and breaks sort ties by id as text, and opens newest seen first.
    index("ix_profile_list_profile_text").on(sql`(${t.profileId}::text)`),
    index("ix_profile_list_last_seen").on(
      sql`(${t.lastSeen} is null)`,
      sql`${t.lastSeen} desc`,
      sql`(${t.profileId}::text) collate "C"`,
    ),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_list_profile_id_profiles",
    }).onDelete("cascade"),
  ],
);

/**
 * Live profiles as the People list reads them: addresses, channels and consent on the row, and
 * the people map's stage, warmth and persona (`profile_rollups`; defaults before its first pass),
 * and William's lead call (`lead` trait: `lead` or `not_lead`; null before he calls it).
 * Read from `profile_list`.
 */
export const profileRecords = pgView("profile_records", {
  id: integer("id"),
  name: text("name"),
  emails: text("emails"),
  phones: text("phones"),
  handles: text("handles"),
  channels: text("channels"),
  consent: text("consent"),
  firstSeen: timestamp("first_seen", { withTimezone: true }),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  keys: integer("keys"),
  traits: integer("traits"),
  merged: integer("merged"),
  stage: text("stage"),
  warmth: text("warmth"),
  why: text("why"),
  warmthLine: text("warmth_line"),
  warmSince: timestamp("warm_since", { withTimezone: true }),
  persona: text("persona"),
  personaRole: text("persona_role"),
  personaNiche: text("persona_niche"),
  personaSize: text("persona_size"),
  subscriptions: text("subscriptions"),
  replies: integer("replies"),
  repliedLast: timestamp("replied_last", { withTimezone: true }),
  repliedChannel: text("replied_channel"),
  firstChannel: text("first_channel"),
  lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
  lastChannel: text("last_channel"),
  cameFrom: text("came_from"),
  lead: text("lead"),
}).as(sql`
  select l.profile_id id, l.name, l.emails, l.phones, l.handles, l.channels, l.consent,
    l.first_seen, l.last_seen, l.keys, l.traits, l.merged, l.stage, l.warmth, l.why,
    l.warmth_line, l.warm_since, l.persona, l.persona_role, l.persona_niche, l.persona_size,
    l.subscriptions, l.replies, l.replied_last, l.replied_channel, l.first_channel,
    l.last_touch_at, l.last_channel, l.came_from, l.lead
  from profile_list l`);

/** Each trait as a row: its value as text for the list, the whole JSON for the page. */
export const profileTraitRecords = pgView("profile_trait_records", {
  id: text("id"),
  profileId: integer("profile_id"),
  key: text("key"),
  value: text("value"),
  source: text("source"),
  at: timestamp("at", { withTimezone: true }),
  changes: integer("changes"),
  profileLink: text("profile_link"),
}).as(sql`
  select t.profile_id || ':' || t.key id, t.profile_id, t.key::text,
    case jsonb_typeof(t.value) when 'string' then t.value #>> '{}' else t.value::text end "value",
    t.source::text, t.at,
    (select count(*)::int from profile_trait_events e
      where e.profile_id = t.profile_id and e.key = t.key) changes,
    '/people/people/' || t.profile_id profile_link
  from profile_traits t`);

/** Each address with the link to its profile. */
export const profileKeyRecords = pgView("profile_key_records", {
  id: integer("id"),
  profileId: integer("profile_id"),
  kind: text("kind"),
  value: text("value"),
  source: text("source"),
  firstSeen: timestamp("first_seen", { withTimezone: true }),
  profileLink: text("profile_link"),
}).as(sql`
  select k.id, k.profile_id, k.kind::text, k.value::text, k.source::text, k.first_seen,
    '/people/people/' || k.profile_id profile_link
  from profile_keys k`);

/** Each merge with both names, under the profile that took it in. */
export const profileMergeRecords = pgView("profile_merge_records", {
  id: integer("id"),
  intoId: integer("into_id"),
  fromId: integer("from_id"),
  fromName: text("from_name"),
  by: text("by"),
  keys: integer("keys"),
  traits: integer("traits"),
  source: text("source"),
  at: timestamp("at", { withTimezone: true }),
  intoLink: text("into_link"),
}).as(sql`
  select m.id, m.into_id, m.from_id, coalesce(p.name, '#' || m.from_id) from_name, m.by::text,
    m.keys, m.traits, m.source::text, m.at, '/people/people/' || m.into_id into_link
  from profile_merges m
  join profiles p on p.id = m.from_id`);

/** A lookup run's state: queued by the profile's action, running in Restate, then done or failed. */
export const PROFILE_LOOKUP_STATES = ["queued", "running", "done", "failed"] as const;
export type ProfileLookupState = (typeof PROFILE_LOOKUP_STATES)[number];

/** One "Research this person" run on a profile: who asked, how far it got, the trail it read. */
export const profileLookups = pgTable(
  "profile_lookups",
  {
    id: serial("id").notNull(),
    profileId: integer("profile_id").notNull(),
    state: varchar("state", { length: 12, enum: PROFILE_LOOKUP_STATES }).notNull(),
    /** His email, `cli`. */
    by: varchar("by", { length: 320 }),
    /** What it searched with: names, emails, handles, firm (`LookupSubject` plus handles). */
    subject: jsonb("subject"),
    /** Each step tried and what it said (`Tried[]`), so the page shows progress. */
    tried: jsonb("tried"),
    /** The lookup's own outcome (`matched`, `unresolved`, `capped`). */
    outcome: varchar("outcome", { length: 24 }),
    error: text("error"),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_lookups" }),
    index("ix_profile_lookups_profile_id").on(t.profileId, t.createdAt),
    oneOf("ck_profile_lookups_state", t.state, PROFILE_LOOKUP_STATES),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_lookups_profile_id_profiles",
    }),
  ],
);

/** What a finding is: a handle on a platform, any other page about them, a job. */
export const PROFILE_FINDING_KINDS = ["handle", "link", "employer"] as const;
export type ProfileFindingKind = (typeof PROFILE_FINDING_KINDS)[number];
/** `found` waits for a person; `kept` is theirs (a handle becomes a key); `dropped` is not. */
export const PROFILE_FINDING_STATES = ["found", "kept", "dropped"] as const;
export type ProfileFindingState = (typeof PROFILE_FINDING_STATES)[number];

/**
 * One thing a lookup found about a profile, with where it came from and how sure. Found again on
 * a later run, the same `ref` keeps its state: a dropped finding stays dropped.
 */
export const profileFindings = pgTable(
  "profile_findings",
  {
    id: serial("id").notNull(),
    profileId: integer("profile_id").notNull(),
    /** The run that found it last. */
    lookupId: integer("lookup_id"),
    kind: varchar("kind", { length: 16, enum: PROFILE_FINDING_KINDS }).notNull(),
    /** `linkedin`, `x`, `instagram`, `github`, `site`, ...; null for an employer. */
    platform: varchar("platform", { length: 24 }),
    /** The handle (normalized), the page's title, or "Title at Firm". */
    value: text("value").notNull(),
    url: text("url"),
    /** The lookup step that found it: `cache`, `google`, `search`, `linkedin`, `elsewhere`. */
    source: varchar("source", { length: 24 }).notNull(),
    /** 0..1: how sure it is theirs. */
    confidence: doublePrecision("confidence").notNull(),
    /** The finding whole, as the lookup gave it. */
    detail: jsonb("detail"),
    state: varchar("state", { length: 8, enum: PROFILE_FINDING_STATES }).notNull().default("found"),
    decidedBy: varchar("decided_by", { length: 320 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** `<kind>:<platform>:<value>`, unique per profile. */
    ref: varchar("ref", { length: 400 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_profile_findings" }),
    unique("uq_profile_findings_profile_ref").on(t.profileId, t.ref),
    index("ix_profile_findings_lookup_id").on(t.lookupId),
    oneOf("ck_profile_findings_kind", t.kind, PROFILE_FINDING_KINDS),
    oneOf("ck_profile_findings_state", t.state, PROFILE_FINDING_STATES),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_findings_profile_id_profiles",
    }),
    foreignKey({
      columns: [t.lookupId],
      foreignColumns: [profileLookups.id],
      name: "fk_profile_findings_lookup_id_profile_lookups",
    }).onDelete("set null"),
  ],
);
export type ProfileFinding = typeof profileFindings.$inferSelect;

/**
 * Broadcasts (designs/2026-10-14-customerio-audit.md, B6): one send to a segment, by email or
 * text, in a workspace. A broadcast waits in To approve before anything goes; on its time it
 * reads the segment once into `broadcast_recipients`, one row per person, and sends each one
 * past consent, suppressions and the frequency cap. Only `./broadcasts.ts` writes these.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles-schema.js";
import { topics } from "./schema.js";
import { segments } from "./segments-schema.js";

export const BROADCAST_CHANNELS = ["email", "sms"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

/**
 * `draft` until asked; `waiting` in To approve; `scheduled` after the yes; `sending` once its
 * segment is read; `sent` when nobody is left due; `declined` by the approver; `canceled`.
 */
export const BROADCAST_STATES = [
  "draft",
  "waiting",
  "scheduled",
  "sending",
  "sent",
  "declined",
  "canceled",
] as const;
export type BroadcastState = (typeof BROADCAST_STATES)[number];

/**
 * One person's send. `due` waits for its time; `held` waits for room under the cap; `sending`
 * is an email mid-send; `queued` a text handed to the texts sender (its own row from then on);
 * `sent`; `skipped` (never left: no consent, suppressed, no address, canceled); `failed`.
 */
export const RECIPIENT_STATES = [
  "due",
  "held",
  "sending",
  "queued",
  "sent",
  "skipped",
  "failed",
] as const;
export type RecipientState = (typeof RECIPIENT_STATES)[number];

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: serial("id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 8 }).$type<BroadcastChannel>().notNull(),
    segmentId: integer("segment_id").notNull(),
    /** The consent topic it goes out under: only people who said yes to it get it. */
    topicId: integer("topic_id").notNull(),
    /** Email only. */
    subject: varchar("subject", { length: 200 }),
    /** Plain text with merge fields (`{first_name|there}`). */
    body: text("body").notNull(),
    /** When it goes; null is as soon as it's approved. */
    sendAt: timestamp("send_at", { withTimezone: true }),
    /** Each person gets it at `send_at`'s wall clock in their own zone. */
    local: boolean("local").default(false).notNull(),
    /** The zone `send_at` was picked in; with `local`, the zone of anyone whose own is unknown. */
    zone: varchar("zone", { length: 64 }).default("America/New_York").notNull(),
    state: varchar("state", { length: 16 }).$type<BroadcastState>().default("draft").notNull(),
    askedBy: varchar("asked_by", { length: 320 }),
    askedAt: timestamp("asked_at", { withTimezone: true }),
    decidedBy: varchar("decided_by", { length: 320 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Why it was declined or canceled. */
    note: text("note"),
    testedTo: varchar("tested_to", { length: 320 }),
    testedAt: timestamp("tested_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_broadcasts" }),
    index("ix_broadcasts_segment_id").on(t.segmentId),
    index("ix_broadcasts_topic_id").on(t.topicId),
    index("ix_broadcasts_state").on(t.state, t.sendAt),
    foreignKey({
      columns: [t.segmentId],
      foreignColumns: [segments.id],
      name: "fk_broadcasts_segment_id_segments",
    }),
    foreignKey({
      columns: [t.topicId],
      foreignColumns: [topics.id],
      name: "fk_broadcasts_topic_id_topics",
    }),
  ],
);

/** Who a broadcast went to: its segment as read when it started, one row per person. */
export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: serial("id").notNull(),
    broadcastId: integer("broadcast_id").notNull(),
    profileId: integer("profile_id").notNull(),
    /** The email or phone it goes to; null when the person has none on the channel. */
    address: varchar("address", { length: 320 }),
    /** The zone its time was read in, with local time on. */
    zone: varchar("zone", { length: 64 }),
    state: varchar("state", { length: 8 }).$type<RecipientState>().default("due").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Why it was skipped, held or failed, in words. */
    why: text("why"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** An email's Message-ID (`<uuid@domain>`), set as it starts sending: a bounce finds it by it. */
    messageId: varchar("message_id", { length: 998 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_broadcast_recipients" }),
    index("ix_broadcast_recipients_message_id").on(t.messageId),
    unique("uq_broadcast_recipients_broadcast_profile").on(t.broadcastId, t.profileId),
    index("ix_broadcast_recipients_due").on(t.broadcastId, t.state, t.dueAt),
    index("ix_broadcast_recipients_profile_id").on(t.profileId),
    foreignKey({
      columns: [t.broadcastId],
      foreignColumns: [broadcasts.id],
      name: "fk_broadcast_recipients_broadcast_id_broadcasts",
    }),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_broadcast_recipients_profile_id_profiles",
    }),
  ],
);

/** Each broadcast as People → Broadcasts lists it: its segment, topic and how far it got. */
export const broadcastRecords = pgView("broadcast_records", {
  id: integer("id"),
  name: text("name"),
  channel: text("channel"),
  state: text("state"),
  segmentId: integer("segment_id"),
  segment: text("segment"),
  size: integer("size"),
  topic: text("topic"),
  subject: text("subject"),
  body: text("body"),
  sendAt: timestamp("send_at", { withTimezone: true }),
  local: boolean("local"),
  zone: text("zone"),
  when: timestamp("when", { withTimezone: true }),
  people: integer("people"),
  sent: integer("sent"),
  waiting: integer("waiting"),
  skipped: integer("skipped"),
  failed: integer("failed"),
  by: text("by"),
  askedAt: timestamp("asked_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
  testedTo: text("tested_to"),
  testedAt: timestamp("tested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  sentLog: text("sent_log"),
  recipients: text("recipients"),
}).as(sql`
  select b.id, b.name::text, b.channel::text, b.state::text, b.segment_id, s.name::text segment,
    s.size, t.public_name::text topic, b.subject::text, b.body, b.send_at, b.local, b.zone::text,
    coalesce(b.started_at, b.send_at, b.decided_at, b.asked_at, b.created_at) "when",
    r.people, r.sent, r.waiting, r.skipped, r.failed,
    b.by::text, b.asked_at, b.decided_by::text, b.decided_at, b.note, b.tested_to::text,
    b.tested_at, b.started_at, b.finished_at, b.created_at,
    case when b.started_at is not null then '/people/sent?broadcast=' || b.id || '..' || b.id end sent_log,
    case when b.started_at is not null then '/people/recipients?broadcastId=' || b.id || '..' || b.id end recipients
  from broadcasts b
  join segments s on s.id = b.segment_id
  join topics t on t.id = b.topic_id
  left join lateral (
    select count(*)::int people,
      count(*) filter (where x.state in ('sent', 'queued'))::int sent,
      count(*) filter (where x.state in ('due', 'held', 'sending'))::int waiting,
      count(*) filter (where x.state = 'skipped')::int skipped,
      count(*) filter (where x.state = 'failed')::int failed
    from broadcast_recipients x where x.broadcast_id = b.id) r on true`);

/** Each person a broadcast went to, with where it stands and why. */
export const broadcastRecipientRecords = pgView("broadcast_recipient_records", {
  id: integer("id"),
  broadcastId: integer("broadcast_id"),
  broadcast: text("broadcast"),
  channel: text("channel"),
  profileId: integer("profile_id"),
  name: text("name"),
  address: text("address"),
  state: text("state"),
  why: text("why"),
  zone: text("zone"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  profileLink: text("profile_link"),
}).as(sql`
  select r.id, r.broadcast_id, b.name::text broadcast, b.channel::text, r.profile_id,
    coalesce(p.name, '#' || p.id) "name", r.address::text, r.state::text, r.why, r.zone::text,
    r.due_at, r.sent_at, '/people/people/' || r.profile_id profile_link
  from broadcast_recipients r
  join broadcasts b on b.id = r.broadcast_id
  join profiles p on p.id = r.profile_id`);

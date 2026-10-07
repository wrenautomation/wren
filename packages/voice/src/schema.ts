/**
 * The voice agent's tables (designs/2026-10-06-voice-agent.md).
 *
 * - `voice_calls`: one row per call (inbound, outbound or a portal test): who, the pipeline it ran
 *   on, the transcript, the outcome, a booking or message it left.
 * - `voice_turns`: one row per turn, with each stage's time in ms after the caller stopped
 *   talking, so pipelines are compared on numbers. Not audited: it's a measurement, written once.
 * - `phone_consents`: prior express written consent to be called. An outbound AI call needs one
 *   with `ai_voice` (the TCPA counts an AI voice as artificial), checked in code before any dial.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { DIRECTIONS, type Line, OUTCOMES } from "./types.js";

export const voiceCalls = pgTable(
  "voice_calls",
  {
    id: serial("id"),
    /** Whose agent: "wren", or a client's slug. */
    whose: varchar("whose", { length: 64 }).notNull().default("wren"),
    direction: varchar("direction", { length: 16, enum: DIRECTIONS }).notNull(),
    /** "text · scripted", "telnyx · …": what latency is grouped by. */
    pipeline: varchar("pipeline", { length: 200 }).notNull(),
    /** The transport's own id (Telnyx's call control id, a test's uuid). */
    ref: varchar("ref", { length: 200 }).notNull(),
    fromNumber: varchar("from_number", { length: 32 }).notNull().default(""),
    toNumber: varchar("to_number", { length: 32 }).notNull().default(""),
    /** The lead the number belongs to, when we know it. */
    smsContactId: integer("sms_contact_id"),
    leadName: text("lead_name"),
    outcome: varchar("outcome", { length: 16, enum: OUTCOMES }).notNull(),
    transcript: jsonb("transcript").$type<Line[]>().notNull().default([]),
    /** calendar.bookings.id, when it booked. */
    bookingId: integer("booking_id"),
    message: text("message"),
    /** The recording's S3 key, once recording is on. */
    recordingKey: text("recording_key"),
    /** Who ran a test call; null on a real one. */
    by: varchar("by", { length: 320 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_voice_calls" }),
    index("ix_voice_calls_started_at").on(t.startedAt),
    index("ix_voice_calls_sms_contact_id").on(t.smsContactId),
    index("ix_voice_calls_booking_id").on(t.bookingId),
    oneOf("ck_voice_calls_direction", t.direction, DIRECTIONS),
    oneOf("ck_voice_calls_outcome", t.outcome, OUTCOMES),
    foreignKey({
      columns: [t.smsContactId],
      foreignColumns: [smsContacts.id],
      name: "fk_voice_calls_sms_contact_id_sms_contacts",
    }).onDelete("set null"),
  ],
);

export const voiceTurns = pgTable(
  "voice_turns",
  {
    id: serial("id"),
    callId: integer("call_id").notNull(),
    n: integer("n").notNull(),
    /** The call's, copied so latency groups without a join. */
    pipeline: varchar("pipeline", { length: 200 }).notNull(),
    caller: text("caller").notNull().default(""),
    agent: text("agent").notNull().default(""),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    speculative: boolean("speculative").notNull().default(false),
    barged: boolean("barged").notNull().default(false),
    /** Each stage in ms after the caller stopped talking; null when it never came. */
    finalMs: integer("final_ms"),
    endMs: integer("end_ms"),
    tokenMs: integer("token_ms"),
    audioMs: integer("audio_ms"),
    heardMs: integer("heard_ms"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_voice_turns" }),
    uniqueIndex("uq_voice_turns_call_id_n").on(t.callId, t.n),
    index("ix_voice_turns_at").on(t.at),
    foreignKey({
      columns: [t.callId],
      foreignColumns: [voiceCalls.id],
      name: "fk_voice_turns_call_id_voice_calls",
    }).onDelete("cascade"),
  ],
);

export const CONSENT_SOURCES = ["form", "manual", "import"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const phoneConsents = pgTable(
  "phone_consents",
  {
    id: serial("id"),
    e164: varchar("e164", { length: 16 }).notNull(),
    /** Who may call: "wren", or a client's slug. */
    whose: varchar("whose", { length: 64 }).notNull().default("wren"),
    source: varchar("source", { length: 16, enum: CONSENT_SOURCES }).notNull(),
    /** The words they agreed to, as shown, and that wording's version. */
    text: text("text").notNull(),
    textVersion: varchar("text_version", { length: 64 }).notNull(),
    /** The words said calls may use an AI or prerecorded voice. */
    aiVoice: boolean("ai_voice").notNull().default(false),
    /** The form submission, page and IP: what proves it. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    givenAt: timestamp("given_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_phone_consents" }),
    index("ix_phone_consents_e164").on(t.e164),
    oneOf("ck_phone_consents_source", t.source, CONSENT_SOURCES),
  ],
);

export type VoiceCall = typeof voiceCalls.$inferSelect;
export type PhoneConsent = typeof phoneConsents.$inferSelect;

/** `voice_calls` as console records (`./records.ts`). */
export const voiceCallRecords = pgView("voice_call_records", {
  id: integer("id"),
  whose: text("whose"),
  direction: text("direction"),
  pipeline: text("pipeline"),
  who: text("who"),
  number: text("number"),
  outcome: text("outcome"),
  turns: integer("turns"),
  heard: integer("heard"),
  started: timestamp("started", { withTimezone: true }),
  seconds: integer("seconds"),
  message: text("message"),
  by: text("by"),
}).as(sql`
  select c.id, c.whose::text whose, c.direction::text direction, c.pipeline::text pipeline,
    coalesce(c.lead_name, nullif(case when c.direction = 'outbound' then c.to_number
      else c.from_number end, ''), 'Test caller') who,
    (case when c.direction = 'outbound' then c.to_number else c.from_number end)::text number,
    c.outcome::text outcome,
    (select count(*)::int from voice_turns t where t.call_id = c.id and t.n > 0) turns,
    (select percentile_cont(0.5) within group (order by t.heard_ms)::int
       from voice_turns t where t.call_id = c.id and t.n > 0) heard,
    c.started_at started,
    extract(epoch from c.ended_at - c.started_at)::int seconds,
    c.message, c.by::text by
  from voice_calls c`);

/**
 * p50 and p95 per stage per pipeline over the last 30 days, one row each. The opener (turn 0)
 * isn't a reply to anyone, so it's left out.
 */
export const voiceLatency = pgView("voice_latency", {
  id: text("id"),
  pipeline: text("pipeline"),
  stage: text("stage"),
  rank: integer("rank"),
  p50: numeric("p50", { mode: "number" }),
  p95: numeric("p95", { mode: "number" }),
  turns: integer("turns"),
  last: timestamp("last", { withTimezone: true }),
}).as(sql`
  select s.pipeline || ':' || s.stage id, s.pipeline::text pipeline, s.stage, s.rank,
    round(percentile_cont(0.5) within group (order by s.ms)::numeric)::int p50,
    round(percentile_cont(0.95) within group (order by s.ms)::numeric)::int p95,
    count(*)::int turns, max(s.at) last
  from (
    select t.pipeline, t.at, x.stage, x.rank, x.ms
    from voice_turns t
    cross join lateral (values ('final', 1, t.final_ms), ('end', 2, t.end_ms),
      ('token', 3, t.token_ms), ('audio', 4, t.audio_ms), ('heard', 5, t.heard_ms))
      as x(stage, rank, ms)
    where t.n > 0 and x.ms is not null and t.at > now() - interval '30 days'
  ) s
  group by s.pipeline, s.stage, s.rank`);

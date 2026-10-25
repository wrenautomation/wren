/**
 * Segments (designs/2026-10-14-customerio-audit.md, B5): a named set of profiles in a workspace.
 * `live` is its rule, kept true as profiles change; `manual` is a list kept by hand; `snapshot` is
 * a rule's answer frozen when taken. `segment_members` is who is in now, and
 * `segment_member_events` every entry and exit, which the executor's Segment trigger hears. Only
 * `./segments.ts` writes these.
 */
import { sql } from "drizzle-orm";
import {
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
import { profiles } from "./profiles-schema.js";

export const SEGMENT_KINDS = ["live", "manual", "snapshot"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];
export const SEGMENT_STATES = ["active", "archived"] as const;
export type SegmentState = (typeof SEGMENT_STATES)[number];

/** What uses a segment: a workflow's trigger, another segment's rule, later a broadcast (B6). */
export interface SegmentUse {
  kind: "workflow" | "segment" | "broadcast";
  /** The workflow's id, the segment's id. */
  id: string;
  name: string;
}

export const segments = pgTable(
  "segments",
  {
    id: serial("id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 16 }).$type<SegmentKind>().notNull(),
    /** The rule (`Rule` in `./segments.ts`): a live one's, or what a snapshot was taken by. */
    rule: jsonb("rule"),
    /** The plain words it was described in, when it was. */
    words: text("words"),
    state: varchar("state", { length: 16 }).$type<SegmentState>().default("active").notNull(),
    /** Saves so far: each one keeps a `segment_versions` row. */
    version: integer("version").default(1).notNull(),
    /** Members at the last count. */
    size: integer("size").default(0).notNull(),
    /** When its members were last worked out (a snapshot: when it was taken). */
    computedAt: timestamp("computed_at", { withTimezone: true }),
    /** What uses it, as the segments pass last read it. */
    uses: jsonb("uses").$type<SegmentUse[]>().default([]).notNull(),
    /** The last time something used it: a save, a trigger heard, its members read. */
    usedAt: timestamp("used_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_segments" }),
    unique("uq_segments_name").on(t.name),
    index("ix_segments_state").on(t.state, t.kind),
  ],
);

/** Each save of a segment, as it was saved: its name, rule and words then. Append only. */
export const segmentVersions = pgTable(
  "segment_versions",
  {
    segmentId: integer("segment_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 16 }).$type<SegmentKind>().notNull(),
    rule: jsonb("rule"),
    words: text("words"),
    by: varchar("by", { length: 320 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.version], name: "pk_segment_versions" }),
    foreignKey({
      columns: [t.segmentId],
      foreignColumns: [segments.id],
      name: "fk_segment_versions_segment_id_segments",
    }),
  ],
);

/** Who is in a segment now. A live one's rows are the rule's; a manual one's are by hand. */
export const segmentMembers = pgTable(
  "segment_members",
  {
    segmentId: integer("segment_id").notNull(),
    profileId: integer("profile_id").notNull(),
    since: timestamp("since", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.profileId], name: "pk_segment_members" }),
    index("ix_segment_members_profile_id").on(t.profileId),
    foreignKey({
      columns: [t.segmentId],
      foreignColumns: [segments.id],
      name: "fk_segment_members_segment_id_segments",
    }),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_segment_members_profile_id_profiles",
    }),
  ],
);

/** Append only: each entry and exit. The Segment trigger fires from these. */
export const segmentMemberEvents = pgTable(
  "segment_member_events",
  {
    id: serial("id").notNull(),
    segmentId: integer("segment_id").notNull(),
    profileId: integer("profile_id").notNull(),
    change: varchar("change", { length: 8 }).$type<"entered" | "left">().notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_segment_member_events" }),
    index("ix_segment_member_events_segment_id").on(t.segmentId, t.at),
    index("ix_segment_member_events_profile_id").on(t.profileId, t.at),
    foreignKey({
      columns: [t.segmentId],
      foreignColumns: [segments.id],
      name: "fk_segment_member_events_segment_id_segments",
    }),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_segment_member_events_profile_id_profiles",
    }),
  ],
);

/** Each segment as the Segments page lists it: what uses it in words. */
export const segmentRecords = pgView("segment_records", {
  id: integer("id"),
  name: text("name"),
  kind: text("kind"),
  state: text("state"),
  size: integer("size"),
  words: text("words"),
  usedBy: text("used_by"),
  uses: integer("uses"),
  computedAt: timestamp("computed_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  by: text("by"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  members: text("members"),
}).as(sql`
  select s.id, s.name::text, s.kind::text, s.state::text, s.size, s.words,
    (select string_agg(u ->> 'name', ', ') from jsonb_array_elements(s.uses) u) used_by,
    jsonb_array_length(s.uses) uses,
    s.computed_at, s.used_at, s.archived_at, s.by::text, s.created_at,
    '/people/members?segmentId=' || s.id || '..' || s.id members
  from segments s`);

/** Each member with their profile's name and addresses, under the segment. */
export const segmentMemberRecords = pgView("segment_member_records", {
  id: text("id"),
  segmentId: integer("segment_id"),
  segment: text("segment"),
  segmentKind: text("segment_kind"),
  profileId: integer("profile_id"),
  name: text("name"),
  emails: text("emails"),
  phones: text("phones"),
  since: timestamp("since", { withTimezone: true }),
  profileLink: text("profile_link"),
}).as(sql`
  select m.segment_id || ':' || m.profile_id id, m.segment_id, s.name::text segment,
    s.kind::text segment_kind, m.profile_id,
    coalesce(p.name, '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    m.since, '/people/people/' || m.profile_id profile_link
  from segment_members m
  join segments s on s.id = m.segment_id
  join profiles p on p.id = m.profile_id`);

/**
 * The people map (designs/2026-10-15-people-map.md): one row per live profile with where they
 * stand (stage), whether they ever came toward us (warmth, with each reason counted), what they
 * signed up for, their replies, their first and last touch, and who they are (persona). Rebuilt
 * from the source tables by `./people-map.ts`; nothing here is a source of truth. Plain columns
 * so segments, lists and the CLI read them without joins.
 *
 * `profile_site_reads`: page and watch-page views counted from the lander's log per profile with
 * a `visitor` key. Counts and times only; the visit lines stay live reads (B7).
 */
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { profiles } from "./profiles-schema.js";

/** Where a person stands, furthest last. `past_client` is a mark, outranking `client`. */
export const STAGES = ["stranger", "lead", "replied", "booked", "client", "past_client"] as const;
export type Stage = (typeof STAGES)[number];

/** Why someone is warm: each is a thing they did toward us. */
export const WARM_REASONS = [
  "subscribed",
  "replied",
  "booked",
  "form",
  "visited",
  "watched",
  "opened",
  "clicked",
  "engaged",
] as const;
export type WarmReason = (typeof WARM_REASONS)[number];

/** Counted per profile: the warm reasons, and what we sent them (`contacted`). */
export const ROLLUP_COUNTS = [...WARM_REASONS, "contacted"] as const;
export type RollupCount = (typeof ROLLUP_COUNTS)[number];

export const PERSONA_ROLES = ["owner", "executive", "manager", "staff", "unknown"] as const;
export type PersonaRole = (typeof PERSONA_ROLES)[number];
/** Headcount: solo 1, small 2-9, mid 10-49, large 50 and up. */
export const PERSONA_SIZES = ["solo", "small", "mid", "large", "unknown"] as const;
export type PersonaSize = (typeof PERSONA_SIZES)[number];

const at = (name: string) => timestamp(name, { withTimezone: true });
export const profileRollups = pgTable(
  "profile_rollups",
  {
    profileId: integer("profile_id").notNull(),
    stage: varchar("stage", { length: 16 }).notNull(),
    warmth: varchar("warmth", { length: 8 }).notNull(),
    /** The warm reasons that hold, comma separated in `WARM_REASONS` order; empty when cold. */
    why: text("why").notNull().default(""),
    /** One line for a person: "replied 2x, last Oct 3; opened 4x, last Oct 1". */
    warmthLine: text("warmth_line"),
    warmSince: at("warm_since"),
    subscribedN: integer("subscribed_n").notNull().default(0),
    subscribedFirst: at("subscribed_first"),
    subscribedLast: at("subscribed_last"),
    repliedN: integer("replied_n").notNull().default(0),
    repliedFirst: at("replied_first"),
    repliedLast: at("replied_last"),
    bookedN: integer("booked_n").notNull().default(0),
    bookedFirst: at("booked_first"),
    bookedLast: at("booked_last"),
    formN: integer("form_n").notNull().default(0),
    formFirst: at("form_first"),
    formLast: at("form_last"),
    visitedN: integer("visited_n").notNull().default(0),
    visitedFirst: at("visited_first"),
    visitedLast: at("visited_last"),
    watchedN: integer("watched_n").notNull().default(0),
    watchedFirst: at("watched_first"),
    watchedLast: at("watched_last"),
    openedN: integer("opened_n").notNull().default(0),
    openedFirst: at("opened_first"),
    openedLast: at("opened_last"),
    clickedN: integer("clicked_n").notNull().default(0),
    clickedFirst: at("clicked_first"),
    clickedLast: at("clicked_last"),
    engagedN: integer("engaged_n").notNull().default(0),
    engagedFirst: at("engaged_first"),
    engagedLast: at("engaged_last"),
    contactedN: integer("contacted_n").notNull().default(0),
    contactedFirst: at("contacted_first"),
    contactedLast: at("contacted_last"),
    /** Every consent: "Newsletter (email, confirmed), Tips (sms, withdrawn)". */
    subscriptions: text("subscriptions"),
    repliedChannels: text("replied_channels"),
    repliedLastChannel: varchar("replied_last_channel", { length: 24 }),
    firstTouchAt: at("first_touch_at"),
    firstChannel: varchar("first_channel", { length: 24 }),
    firstTouch: text("first_touch"),
    lastTouchAt: at("last_touch_at"),
    lastChannel: varchar("last_channel", { length: 24 }),
    lastTouch: text("last_touch"),
    /** The writer of their oldest address: `lead_import`, `site_form`, `social_handle`, ... */
    cameFrom: varchar("came_from", { length: 32 }),
    /** `<niche> <role>`: "recruiting owner"; "unknown" when neither is known. */
    persona: varchar("persona", { length: 64 }).notNull(),
    personaRole: varchar("persona_role", { length: 16 }).notNull(),
    personaNiche: varchar("persona_niche", { length: 32 }).notNull(),
    personaSize: varchar("persona_size", { length: 16 }).notNull(),
    refreshedAt: at("refreshed_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId], name: "pk_profile_rollups" }),
    index("ix_profile_rollups_stage").on(t.stage),
    index("ix_profile_rollups_warmth").on(t.warmth, t.warmSince),
    index("ix_profile_rollups_persona").on(t.persona),
    index("ix_profile_rollups_replied_last").on(t.repliedLast),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_rollups_profile_id_profiles",
    }),
  ],
);

export const profileSiteReads = pgTable(
  "profile_site_reads",
  {
    profileId: integer("profile_id").notNull(),
    /** Pages seen. */
    visits: integer("visits").notNull(),
    visitFirst: at("visit_first"),
    visitLast: at("visit_last"),
    /** Watch pages seen (`/watch/`, `/v/`). */
    watches: integer("watches").notNull(),
    watchFirst: at("watch_first"),
    watchLast: at("watch_last"),
    readAt: at("read_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId], name: "pk_profile_site_reads" }),
    index("ix_profile_site_reads_read_at").on(t.readAt),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_profile_site_reads_profile_id_profiles",
    }),
  ],
);

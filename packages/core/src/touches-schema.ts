/**
 * Touches (designs/2026-10-07-touches.md): every social touch, ours and theirs, on one person's
 * timeline. `social_handles` is one person on one platform (a normalized handle), linked to a
 * `people` row and a `leads` row when we hold them; `touches` is one follow, connect, comment,
 * reply, DM, like or mention, with what they did back. The source tables keep the whole thing;
 * a touch is the per-person line, keyed by its source row so a writer and the backfill agree.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
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
import { leads, people } from "./schema.js";

/** The content platforms (`@wren/core/content` PLATFORMS), kept here so drizzle-kit reads no adapter code. */
export const TOUCH_PLATFORMS = [
  "linkedin",
  "reddit",
  "youtube",
  "x",
  "instagram",
  "facebook",
  "tiktok",
  "google_business",
] as const;
export const TOUCH_KINDS = [
  "follow",
  "connect",
  "comment",
  "reply",
  "dm",
  "like",
  "mention",
] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const TOUCH_DIRECTIONS = ["ours", "theirs"] as const;
export type TouchDirection = (typeof TOUCH_DIRECTIONS)[number];
/** What they did with ours. `ignored` is kept only when known (an invite withdrawn or gone). */
export const TOUCH_RESPONSES = ["accepted", "replied", "liked", "ignored"] as const;
export type TouchResponse = (typeof TOUCH_RESPONSES)[number];
/** How a handle got its person or lead. */
export const HANDLE_LINKS = [
  "reach_contact",
  "linkedin_url",
  "contact_point",
  "lead_person",
  "lead_social",
  "given",
] as const;
export type HandleLink = (typeof HANDLE_LINKS)[number];

export const socialHandles = pgTable(
  "social_handles",
  {
    id: serial("id").notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    /** Normalized: lowercase, no `@`, `u/` or URL (`normalizeHandle`). A LinkedIn URN stays a URN. */
    handle: varchar("handle", { length: 200 }).notNull(),
    /** Their profile page, when we can say it. */
    url: text("url"),
    name: text("name"),
    personId: integer("person_id"),
    leadId: integer("lead_id"),
    linkedBy: varchar("linked_by", { length: 16, enum: HANDLE_LINKS }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_handles" }),
    unique("uq_social_handles_platform_handle").on(t.platform, t.handle),
    index("ix_social_handles_person_id").on(t.personId),
    index("ix_social_handles_lead_id").on(t.leadId),
    oneOf("ck_social_handles_platform", t.platform, TOUCH_PLATFORMS),
    oneOf("ck_social_handles_linked_by", t.linkedBy, HANDLE_LINKS),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_social_handles_person_id_people",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.leadId],
      foreignColumns: [leads.id],
      name: "fk_social_handles_lead_id_leads",
    }).onDelete("set null"),
  ],
);

export const touches = pgTable(
  "touches",
  {
    id: serial("id").notNull(),
    handleId: integer("handle_id").notNull(),
    kind: varchar("kind", { length: 16, enum: TOUCH_KINDS }).notNull(),
    direction: varchar("direction", { length: 8, enum: TOUCH_DIRECTIONS }).notNull(),
    /** Our account: the reach credential (`linkedin@wren`), or `wren` for our own pages. */
    account: varchar("account", { length: 120 }),
    /** The post or thread it sits on, else their profile or the DM thread. */
    url: text("url"),
    text: text("text"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    response: varchar("response", { length: 16, enum: TOUCH_RESPONSES }),
    responseAt: timestamp("response_at", { withTimezone: true }),
    /** Theirs: the touch of ours it answers. */
    answers: integer("answers"),
    /** The platform's id for it (a comment's or message's), what their reply's parent names. */
    externalId: varchar("external_id", { length: 200 }),
    /** The source table it came from: `reach_messages`, `comments`, `reach_posts`, ... */
    source: varchar("source", { length: 32 }).notNull(),
    /** Unique key from the source row (`rm:12`, `ca:7`): a writer and the backfill agree. */
    ref: varchar("ref", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_touches" }),
    unique("uq_touches_ref").on(t.ref),
    index("ix_touches_handle_id_at").on(t.handleId, t.at),
    index("ix_touches_answers").on(t.answers),
    index("ix_touches_external_id").on(t.externalId).where(sql`external_id IS NOT NULL`),
    oneOf("ck_touches_kind", t.kind, TOUCH_KINDS),
    oneOf("ck_touches_direction", t.direction, TOUCH_DIRECTIONS),
    oneOf("ck_touches_response", t.response, TOUCH_RESPONSES),
    foreignKey({
      columns: [t.handleId],
      foreignColumns: [socialHandles.id],
      name: "fk_touches_handle_id_social_handles",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.answers],
      foreignColumns: [t.id],
      name: "fk_touches_answers_touches",
    }).onDelete("set null"),
  ],
);

export type SocialHandle = typeof socialHandles.$inferSelect;
export type Touch = typeof touches.$inferSelect;

/**
 * Touches as Marketing → People's Touches tab reads them: each line twice, under the person's
 * record id (`li:<people.id>`) when the handle is linked, and under `<platform>:<handle>`. An
 * ours touch with no answer after 14 days reads "no answer".
 */
export const personTouchLines = pgView("person_touch_lines", {
  person: text("person"),
  at: timestamp("at", { withTimezone: true }),
  kind: text("kind"),
  what: text("what"),
  seq: integer("seq"),
}).as(sql`
  with lines as (
    select t.id, t.at, h.person_id, h.platform, h.handle,
      case h.platform when 'linkedin' then 'LinkedIn' when 'x' then 'X'
        when 'instagram' then 'Instagram' when 'reddit' then 'Reddit' when 'youtube' then 'YouTube'
        when 'facebook' then 'Facebook' when 'tiktok' then 'TikTok'
        when 'google_business' then 'Business Profile' else h.platform end
        || ' ' || t.kind kind,
      case when t.direction = 'ours' then
        case t.kind when 'follow' then 'We followed them'
          when 'connect' then 'We sent an invite'
          when 'comment' then 'We commented on their post'
          when 'reply' then 'We replied to their comment'
          when 'dm' then 'We wrote to them'
          when 'like' then 'We liked their post'
          else 'We mentioned them' end
        || coalesce(' as ' || t.account, '')
      else
        case t.kind when 'follow' then 'They followed us'
          when 'connect' then 'They invited us'
          when 'comment' then 'They commented on our post'
          when 'reply' then 'They replied to us'
          when 'dm' then 'They wrote to us'
          when 'like' then 'They liked our post'
          else 'They mentioned us' end
      end
      || coalesce(': ' || nullif(left(regexp_replace(t.text, '\\s+', ' ', 'g'), 200), ''), '')
      || case when t.direction <> 'ours' then ''
        when t.response is not null then ' · ' || initcap(t.response)
          || coalesce(' ' || to_char(t.response_at, 'YYYY-MM-DD'), '')
        when t.kind in ('comment', 'reply', 'dm', 'connect')
          and t.at < now() - interval '14 days' then ' · No answer'
        else '' end
      || coalesce(' · ' || t.url, '') what
    from touches t join social_handles h on h.id = t.handle_id
  )
  select 'li:' || person_id person, at, kind, what, id seq from lines where person_id is not null
  union all
  select platform || ':' || handle, at, kind, what, id from lines`);

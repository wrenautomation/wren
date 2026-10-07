/**
 * The content loop's tables. An idea is William's raw input (a few lines,
 * maybe a file); a draft is one platform's version of it, written by the LLM,
 * reviewed by a person, published by the scheduler. Everything the model wrote
 * stays on the draft row beside the audit envelope.
 * Design: designs/2026-09-22-content-loop.md.
 */
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type Media,
  PLATFORMS,
  type Platform,
} from "@wren/core/content";
import { baseColumns, nonNegative, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const IDEA_STATUSES = ["open", "drafted", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Who wrote it: a person, the API, `AdsWatch`, or the planner (a day's commits, a reader's question). */
export const IDEA_SOURCES = ["cli", "api", "ads", "build_log", "question"] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

export const DRAFT_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const contentIdeas = pgTable(
  "content_ideas",
  {
    ...baseColumns,
    text: text("text").notNull(),
    /** A file or URL to publish with it (a short, a screenshot); the drafts inherit it. */
    media: jsonb("media").$type<Media>(),
    source: varchar("source", { length: 16, enum: IDEA_SOURCES }).notNull(),
    status: varchar("status", { length: 16, enum: IDEA_STATUSES }).notNull().default("open"),
    /** What the planner made it from (`build_log:<day>`, `comment:<id>`), so it is made once; null for a person's. */
    ref: varchar("ref", { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_content_ideas" }),
    index("ix_content_ideas_status_created_at").on(t.status, t.createdAt),
    unique("uq_content_ideas_ref").on(t.ref),
    oneOf("ck_content_ideas_source", t.source, IDEA_SOURCES),
    oneOf("ck_content_ideas_status", t.status, IDEA_STATUSES),
  ],
);

/**
 * A platform's playbook: an SOP from the private sops folder, pushed with
 * `wren sop push <name> --platform <p>` and read into every draft prompt for
 * that platform. Insert-only: the newest row per platform is the live one,
 * older rows say what earlier drafts were written against.
 */
export const contentPlaybooks = pgTable(
  "content_playbooks",
  {
    ...baseColumns,
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    /** The SOP's folder name, as in `wren sop ls`. */
    sop: varchar("sop", { length: 64 }).notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_content_playbooks" }),
    index("ix_content_playbooks_platform_created_at").on(t.platform, t.createdAt),
    oneOf("ck_content_playbooks_platform", t.platform, PLATFORMS),
  ],
);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    ...baseColumns,
    ideaId: uuid("idea_id").notNull(),
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    /** The body: a post, a caption, a video description. */
    text: text("text").notNull(),
    /** YouTube's title, TikTok's; null where the platform has none. */
    title: varchar("title", { length: 200 }),
    media: jsonb("media").$type<Media>(),
    /** The platform's post shape past text and file (`@wren/core/content/shapes`): checked on save and publish. */
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 16, enum: DRAFT_STATUSES }).notNull().default("draft"),
    /** A person changed the text after the model wrote it. */
    edited: boolean("edited").notNull().default(false),
    /** Publish at or after this; null = as soon as approved. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedId: varchar("published_id", { length: 255 }),
    url: varchar("url", { length: 2048 }),
    /** The last publish error; cleared when re-approved. */
    error: text("error"),
    /** The draft this one rewrote, and the person's note that asked for it ("shorter, keep the discord line"). */
    redraftOf: uuid("redraft_of"),
    note: text("note"),
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    /** The playbook the prompt carried; null when the platform had none. */
    playbookId: uuid("playbook_id"),
    /** The LLM stage's audit envelope (raw text, usage, model), or null for a hand-written draft. */
    llm: jsonb("llm").$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_content_drafts" }),
    foreignKey({
      columns: [t.ideaId],
      foreignColumns: [contentIdeas.id],
      name: "fk_content_drafts_idea_id_content_ideas",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.redraftOf],
      foreignColumns: [t.id],
      name: "fk_content_drafts_redraft_of_content_drafts",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.playbookId],
      foreignColumns: [contentPlaybooks.id],
      name: "fk_content_drafts_playbook_id_content_playbooks",
    }).onDelete("set null"),
    index("ix_content_drafts_idea_id").on(t.ideaId),
    index("ix_content_drafts_status_scheduled_for").on(t.status, t.scheduledFor),
    index("ix_content_drafts_platform_created_at").on(t.platform, t.createdAt),
    index("ix_content_drafts_redraft_of").on(t.redraftOf),
    index("ix_content_drafts_playbook_id").on(t.playbookId),
    oneOf("ck_content_drafts_platform", t.platform, PLATFORMS),
    oneOf("ck_content_drafts_status", t.status, DRAFT_STATUSES),
  ],
);

/**
 * A metrics snapshot of a published draft: one row per look, so a post's
 * curve is readable and a week's "what worked" is a query, not a guess.
 */
export const contentMetrics = pgTable(
  "content_metrics",
  {
    ...baseColumns,
    draftId: uuid("draft_id").notNull(),
    /** The platform's own clock for the numbers. */
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    views: integer("views").notNull(),
    reactions: integer("reactions").notNull(),
    comments: integer("comments").notNull(),
    shares: integer("shares").notNull(),
    /** Follows the post brought, where the platform says (Instagram); null where it can't. */
    follows: integer("follows"),
    fetchedWith: varchar("fetched_with", { length: 16 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_content_metrics" }),
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [contentDrafts.id],
      name: "fk_content_metrics_draft_id_content_drafts",
    }).onDelete("cascade"),
    index("ix_content_metrics_draft_id_created_at").on(t.draftId, t.createdAt),
    ...nonNegative("content_metrics", {
      views: t.views,
      reactions: t.reactions,
      comments: t.comments,
      shares: t.shares,
    }),
  ],
);

/** `new` until William opened or cleared it. */
export const ACTIVITY_STATES = ["new", "seen"] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

/**
 * Follows, subscribes, mentions, reactions and notices on our accounts, as SocialWatch read them
 * (designs/2026-10-06-social-inbox.md). One row per platform id. A row with no time takes the read time.
 */
export const socialActivity = pgTable(
  "social_activity",
  {
    id: serial("id"),
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    kind: varchar("kind", { length: 16 }).$type<ActivityKind>().notNull(),
    ref: varchar("ref", { length: 200 }).notNull(),
    actor: text("actor"),
    actorUrl: text("actor_url"),
    text: text("text").notNull(),
    url: text("url"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").notNull(),
    state: varchar("state", { length: 8, enum: ACTIVITY_STATES }).notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_activity" }),
    unique("uq_social_activity_platform_ref").on(t.platform, t.ref),
    index("ix_social_activity_state").on(t.state),
    index("ix_social_activity_platform_at").on(t.platform, t.at),
    oneOf("ck_social_activity_platform", t.platform, PLATFORMS),
    oneOf("ck_social_activity_kind", t.kind, ACTIVITY_KINDS),
    oneOf("ck_social_activity_state", t.state, ACTIVITY_STATES),
  ],
);

/** Our follower count per platform per day: the first read of the day is kept. */
export const socialDays = pgTable(
  "social_days",
  {
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    day: date("day", { mode: "string" }).notNull(),
    followers: integer("followers").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.day], name: "pk_social_days" }),
    oneOf("ck_social_days_platform", t.platform, PLATFORMS),
    ...nonNegative("social_days", { followers: t.followers }),
  ],
);

export type SocialActivity = typeof socialActivity.$inferSelect;
export type ContentIdea = typeof contentIdeas.$inferSelect;
export type NewContentIdea = typeof contentIdeas.$inferInsert;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type NewContentDraft = typeof contentDrafts.$inferInsert;
export type ContentMetric = typeof contentMetrics.$inferSelect;
export type ContentPlaybook = typeof contentPlaybooks.$inferSelect;

/**
 * Each published post with its newest numbers (`marketing.post`), keyed `<idea>/<platform>/<draft>`
 * so drafting again knows the idea. `engaged` is reactions, comments
 * and shares; `recent` is the last 7 days, as `wren content results` reads them.
 */
export const marketingPostRecords = pgView("marketing_post_records", {
  id: text("id"),
  platform: text("platform"),
  title: text("title"),
  published: timestamp("published", { withTimezone: true }),
  views: integer("views"),
  reactions: integer("reactions"),
  comments: integer("comments"),
  shares: integer("shares"),
  engaged: integer("engaged"),
  measured: timestamp("measured", { withTimezone: true }),
  url: text("url"),
  recent: text("recent"),
}).as(sql`
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged, m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  where d.status = 'published'`);

/**
 * A draft's timeline (designs/2026-10-07-training-record.md, View), each draft page's Activity
 * tab: its `draft_events` steps, then a post's metrics snapshots and the replies under it. One
 * key column per page, null on another kind's lines, so `7` is never both a comment and a DM.
 */
export const draftActivity = pgView("draft_activity", {
  item: text("item"),
  draft: text("draft"),
  post: text("post"),
  comment: text("comment"),
  thread: text("thread"),
  contact: text("contact"),
  video: text("video"),
  at: timestamp("at", { withTimezone: true }),
  /** A step's `draft_events` id, breaking a tie in `at`; null on a metrics or reply line. */
  seq: integer("seq"),
  kind: text("kind"),
  what: text("what"),
}).as(sql`
  with lines as (
    select e.item, e.at, e.id seq, e.event kind,
      case e.event
        when 'generated' then case e.via when 'model' then 'Drafted by ' || coalesce(e.by, 'the model')
          else 'Written by ' || coalesce(e.by, 'Wren') end
        when 'edited' then case e.via when 'claude' then 'Claude rewrote it, asked by ' || coalesce(e.by, 'you')
          || coalesce(': ' || left(e.ask, 200), '')
          else 'Edited by ' || coalesce(e.by, 'a person') end
          || case when e.meta ? 'undo' then ' (undo)' when e.meta ? 'at_send' then ' at send' else '' end
        when 'approved' then 'Approved' || coalesce(' by ' || e.by, '')
          || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'scheduled' then 'Scheduled' || coalesce(' for ' || to_char(e.slot at time zone 'UTC', 'Mon DD HH24:MI "UTC"'), '')
        when 'rejected' then 'Rejected' || coalesce(' by ' || e.by, '')
          || coalesce(': ' || case e.reason when 'voice' then 'Not my voice' when 'facts' then 'Wrong facts'
            when 'length' then 'Too long' when 'salesy' then 'Too salesy' when 'topic' then 'Off topic'
            when 'timing' then 'Bad timing' when 'repeat' then 'Said before' end, '')
          || coalesce(' · ' || e.note, '')
        when 'sent' then 'Sent' || coalesce(' · ' || e.url, '')
        else 'Failed' || coalesce(': ' || left(e.note, 200), '') end what
    from draft_events e
    union all
    select 'draft:' || d.id, m.as_of, null, 'metrics',
      concat_ws(' · ', m.views || ' views', m.reactions || ' reactions', m.comments || ' comments',
        m.shares || ' shares', m.follows || ' follows')
    from content_metrics m join content_drafts d on d.id = m.draft_id
    union all
    select 'draft:' || d.id, c.at, null, 'reply', 'Reply from ' || c.author || ': ' || left(c.body, 200)
    from comments c join content_drafts d on d.published_id = c.post and d.platform::text = c.platform::text
    where c.sort is distinct from 'ours'
  )
  select l.item,
    case when l.item like 'draft:%' then split_part(l.item, ':', 2) end draft,
    case when l.item like 'draft:%' then concat_ws('/', d.idea_id, d.platform, d.id) end post,
    case when l.item like 'comment:%' then split_part(l.item, ':', 2) end comment,
    case when l.item like 'thread:%' then split_part(l.item, ':', 2) end thread,
    case when l.item like 'dm:%' or l.item like 'invite:%' then split_part(l.item, ':', 2) end contact,
    case when l.item like 'video:%' then split_part(l.item, ':', 2) end video,
    l.at, l.seq, l.kind, l.what
  from lines l
  left join content_drafts d on l.item like 'draft:%' and d.id::text = split_part(l.item, ':', 2)`);

/**
 * What each sent draft got (designs/2026-10-07-training-record.md, Outcomes), read by `wren train`:
 * a post's newest metrics snapshot and the replies under it; an answered comment's or thread's
 * replies to our answer; a DM contact's messages back. One row per item.
 */
export const draftOutcomes = pgView("draft_outcomes", {
  item: text("item"),
  measured: timestamp("measured", { withTimezone: true }),
  views: integer("views"),
  reactions: integer("reactions"),
  comments: integer("comments"),
  shares: integer("shares"),
  follows: integer("follows"),
  snapshots: integer("snapshots"),
  replies: jsonb("replies").$type<{ author: string; text: string; at: string }[]>(),
}).as(sql`
  select 'draft:' || d.id item, m.as_of measured, m.views, m.reactions, m.comments, m.shares,
    m.follows, (select count(*)::int from content_metrics x where x.draft_id = d.id) snapshots,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.post = d.published_id
        and c.platform::text = d.platform::text and c.sort is distinct from 'ours'), '[]') replies
  from content_drafts d
  left join lateral (select * from content_metrics c where c.draft_id = d.id
    order by c.created_at desc, c.id desc limit 1) m on true
  where d.published_id is not null
  union all
  select 'comment:' || a.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.parent = a.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from comments a where a.answer_ref is not null
  union all
  select 'thread:' || t.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', c.author, 'text', c.body, 'at', c.at)
      order by c.at, c.id) from comments c where c.parent = t.answer_ref
        and c.sort is distinct from 'ours'), '[]')
  from reddit_threads t where t.answer_ref is not null
  union all
  select k.prefix || r.id, null, null, null, null, null, null, 0,
    coalesce((select jsonb_agg(jsonb_build_object('author', coalesce(r.name, r.handle),
      'text', i.body, 'at', i.created_at) order by i.created_at, i.id) from reach_messages i
      where i.contact_id = r.id and i.direction = 'in'), '[]')
  from reach_contacts r cross join (values ('dm:'), ('invite:')) k(prefix)
  where exists (select 1 from reach_messages o where o.contact_id = r.id and o.direction = 'out'
    and o.state = 'sent')`);

/**
 * The people a draft names (its commenter, thread author or contact), which `wren train` writes
 * as [person] unless asked for them. A post's repliers come with its outcome.
 */
export const draftPeople = pgView("draft_people", {
  item: text("item"),
  name: text("name"),
}).as(sql`
  select 'comment:' || c.id item, c.author name from comments c
  union all
  select 'thread:' || t.id, t.author from reddit_threads t
  union all
  select k.prefix || r.id, n.name from reach_contacts r
  cross join (values ('dm:'), ('invite:')) k(prefix)
  cross join lateral (values (r.name), (r.handle)) n(name)
  where n.name is not null and n.name <> ''`);

/**
 * Every draft not yet out (`marketing.draft`): waiting on a person, scheduled, failed or turned
 * down. `title` reads as a post's does; `written` says whether a person changed the model's words.
 */
export const marketingDraftRecords = pgView("marketing_draft_records", {
  id: text("id"),
  platform: text("platform"),
  title: text("title"),
  text: text("text"),
  state: text("state"),
  chars: integer("chars"),
  written: text("written"),
  note: text("note"),
  error: text("error"),
  scheduled: timestamp("scheduled", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
}).as(sql`
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published'`);

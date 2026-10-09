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
  GAP_STATES,
  type Media,
  PLATFORMS,
  type Platform,
} from "@wren/core/content";
import { baseColumns, nonNegative, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const IDEA_STATUSES = ["open", "drafted", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/**
 * Who wrote it: a person, the API, `AdsWatch`, the planner (a day's commits, a reader's question),
 * or a video's promo (`promo:<youtube draft>`).
 */
export const IDEA_SOURCES = ["cli", "api", "ads", "build_log", "question", "promo"] as const;
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

/** The funnel (designs/2026-10-07-content-funnel.md): which stage a post serves, where it points. */
export const FUNNEL_STAGES = ["reach", "trust", "convert"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_TARGETS = ["video", "site", "booking", "page"] as const;
export type FunnelTarget = (typeof FUNNEL_TARGETS)[number];

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
    /** The funnel stage it serves: reach (top), trust (middle), convert (bottom). */
    stage: varchar("stage", { length: 16, enum: FUNNEL_STAGES }).notNull().default("reach"),
    /** Where it sends people: a video, the site, booking, a Sites page. Its link is derived (`funnel.ts`). */
    pointsTo: varchar("points_to", { length: 16, enum: FUNNEL_TARGETS }).notNull().default("site"),
    /** The YouTube draft it points at, when it points to a video. */
    videoDraft: uuid("video_draft"),
    /** The Sites page it points at, when it points to a page (`site_pages`, Wren's own). */
    sitePage: uuid("site_page"),
    /** He said the post carries its link (true) or not (false); null follows the platform's rule. */
    linked: boolean("linked"),
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
    foreignKey({
      columns: [t.videoDraft],
      foreignColumns: [t.id],
      name: "fk_content_drafts_video_draft_content_drafts",
    }).onDelete("set null"),
    index("ix_content_drafts_video_draft").on(t.videoDraft),
    oneOf("ck_content_drafts_platform", t.platform, PLATFORMS),
    oneOf("ck_content_drafts_stage", t.stage, FUNNEL_STAGES),
    oneOf("ck_content_drafts_points_to", t.pointsTo, FUNNEL_TARGETS),
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

// ---- Analytics (designs/2026-10-07-content-analytics.md) ----

/**
 * A post's numbers per day, long: one row per metric (and `key`: the tenth of the video for
 * `retention`, the source for `traffic_source`, the words for `search_term`). A later look the
 * same day replaces that day's row; past days are never touched.
 */
export const postMetricDays = pgTable(
  "post_metric_days",
  {
    draftId: uuid("draft_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    metric: varchar("metric", { length: 32 }).notNull(),
    key: varchar("key", { length: 200 }).default("").notNull(),
    value: doublePrecision("value").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.day, t.metric, t.key], name: "pk_post_metric_days" }),
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [contentDrafts.id],
      name: "fk_post_metric_days_draft_id_content_drafts",
    }).onDelete("cascade"),
  ],
);

/** An account's numbers per day (reach, profile visits, link clicks, follows), long like a post's. */
export const accountMetricDays = pgTable(
  "account_metric_days",
  {
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    day: date("day", { mode: "string" }).notNull(),
    metric: varchar("metric", { length: 32 }).notNull(),
    key: varchar("key", { length: 200 }).default("").notNull(),
    value: doublePrecision("value").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.platform, t.day, t.metric, t.key],
      name: "pk_account_metric_days",
    }),
    oneOf("ck_account_metric_days_platform", t.platform, PLATFORMS),
  ],
);

/** A metric's state on a platform: read today, or why not. */
export const SOURCE_STATES = ["live", ...GAP_STATES] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/**
 * Whether each metric came back on its last look, per platform, with the platform's words when
 * it didn't. The page says "Needs scope" from this, not from a guess.
 */
export const metricSources = pgTable(
  "metric_sources",
  {
    platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
    metric: varchar("metric", { length: 32 }).notNull(),
    state: varchar("state", { length: 16, enum: SOURCE_STATES }).notNull(),
    why: text("why"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last time it came back; null = never. */
    liveAt: timestamp("live_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.metric], name: "pk_metric_sources" }),
    oneOf("ck_metric_sources_platform", t.platform, PLATFORMS),
    oneOf("ck_metric_sources_state", t.state, SOURCE_STATES),
  ],
);

export const VARIANT_FIELDS = ["title", "thumbnail", "hook"] as const;
export type VariantField = (typeof VARIANT_FIELDS)[number];
export const VARIANT_STATES = ["proposed", "live", "ended", "rejected"] as const;
export type VariantState = (typeof VARIANT_STATES)[number];
/** The one it went out with, or a swap on the live post. */
export const VARIANT_SOURCES = ["publish", "swap"] as const;

/**
 * A post's titles, thumbnails and hooks over time (designs/2026-10-07-content-analytics.md): the
 * one it went out with, then each swap. A swap waits in To approve (`proposed`); his yes puts it
 * on the platform, makes it `live` and ends the one before. Its window is `started_at` to
 * `ended_at`. `value` is the title, the thumbnail's file, or the hook's line.
 */
export const postVariants = pgTable(
  "post_variants",
  {
    id: serial("id").notNull(),
    draftId: uuid("draft_id").notNull(),
    field: varchar("field", { length: 16, enum: VARIANT_FIELDS }).notNull(),
    value: text("value").notNull(),
    state: varchar("state", { length: 16, enum: VARIANT_STATES }).notNull(),
    source: varchar("source", { length: 16, enum: VARIANT_SOURCES }).notNull(),
    /** Why this one: his note on the swap. */
    why: text("why"),
    askedBy: varchar("asked_by", { length: 200 }),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who said yes or no, and when. */
    decidedBy: varchar("decided_by", { length: 200 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_post_variants" }),
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [contentDrafts.id],
      name: "fk_post_variants_draft_id_content_drafts",
    }).onDelete("cascade"),
    index("ix_post_variants_draft_id_field").on(t.draftId, t.field),
    uniqueIndex("uq_post_variants_live").on(t.draftId, t.field).where(sql`state = 'live'`),
    oneOf("ck_post_variants_field", t.field, VARIANT_FIELDS),
    oneOf("ck_post_variants_state", t.state, VARIANT_STATES),
    oneOf("ck_post_variants_source", t.source, VARIANT_SOURCES),
  ],
);
export type PostVariant = typeof postVariants.$inferSelect;

/**
 * The Monday "what worked" note: top and bottom posts, the number that moved, the next post to
 * make. One per week and platform (`all` for every platform); a second run that week replaces it.
 */
export const contentDigests = pgTable(
  "content_digests",
  {
    week: date("week", { mode: "string" }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    lines: jsonb("lines").$type<DigestLine[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.week, t.platform], name: "pk_content_digests" })],
);

/** One line of a digest: what it is, and the post it names (a `marketing.post` id) when it names one. */
export interface DigestLine {
  kind: "top" | "bottom" | "moved" | "next" | "cadence";
  text: string;
  post?: string;
}

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
/** A draft's format (`formatOf` in analytics/catalog.ts) over `content_drafts d`. */
export const formatSql = `case
      when d.platform = 'youtube' then case when d.extra->>'kind' = 'short' then 'short' else 'long' end
      when d.platform = 'tiktok' then 'video'
      when d.platform = 'instagram' and d.extra->>'kind' = 'video' then 'reel'
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      else 'post' end`;

/**
 * Published posts (`marketing.post`) with their latest counts, their insights' latest day
 * (designs/2026-10-07-content-analytics.md), what their own links brought to the site
 * (`link_days`: a post's `/go/` link by its draft's first 8, a long video's footer by its video
 * id), and their comments answered. Revenue is USD, by first and by last touch.
 */
export const marketingPostRecords = pgView("marketing_post_records", {
  id: text("id"),
  platform: text("platform"),
  title: text("title"),
  published: timestamp("published", { withTimezone: true }),
  stage: text("stage"),
  format: text("format"),
  views: integer("views"),
  reactions: integer("reactions"),
  comments: integer("comments"),
  shares: integer("shares"),
  engaged: integer("engaged"),
  score: doublePrecision("score"),
  impressions: doublePrecision("impressions"),
  reach: doublePrecision("reach"),
  ctr: doublePrecision("ctr"),
  avgViewPct: doublePrecision("avg_view_pct"),
  avgViewSecs: doublePrecision("avg_view_secs"),
  hold: doublePrecision("hold"),
  watchMinutes: doublePrecision("watch_minutes"),
  saves: doublePrecision("saves"),
  follows: doublePrecision("follows"),
  linkClicks: doublePrecision("link_clicks"),
  clicks: integer("clicks"),
  forms: integer("forms"),
  calls: integer("calls"),
  won: integer("won"),
  revenueFirst: doublePrecision("revenue_first"),
  revenueLast: doublePrecision("revenue_last"),
  currency: text("currency"),
  theirs: integer("theirs"),
  answered: integer("answered"),
  measured: timestamp("measured", { withTimezone: true }),
  url: text("url"),
  recent: text("recent"),
}).as(sql`
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, d.stage::text stage, ${sql.raw(formatSql)} format,
    m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged,
    case when m.views > 0
      then round((m.reactions + m.comments + m.shares) * 100.0 / m.views, 2)::float8 end score,
    i.impressions, i.reach, i.ctr / 100 ctr, i.avg_view_pct / 100 avg_view_pct, i.avg_view_secs,
    i.hold, i.watch_minutes, i.saves, i.follows, i.link_clicks,
    coalesce(l.clicks, 0) clicks, coalesce(l.forms, 0) forms, coalesce(l.calls, 0) calls,
    coalesce(l.won, 0) won, coalesce(l.revenue_first, 0) / 100.0 revenue_first,
    coalesce(l.revenue_last, 0) / 100.0 revenue_last, 'USD'::text currency,
    coalesce(c.theirs, 0) theirs, coalesce(c.answered, 0) answered,
    m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  join content_ideas idea on idea.id = d.idea_id
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  left join lateral (
    select max(v.value) filter (where v.metric = 'impressions') impressions,
      max(v.value) filter (where v.metric = 'reach') reach,
      max(v.value) filter (where v.metric = 'ctr') ctr,
      max(v.value) filter (where v.metric = 'avg_view_pct') avg_view_pct,
      max(v.value) filter (where v.metric = 'avg_view_secs') avg_view_secs,
      max(v.value) filter (where v.metric = 'hold_30s') hold,
      max(v.value) filter (where v.metric = 'watch_minutes') watch_minutes,
      max(v.value) filter (where v.metric = 'saves') saves,
      max(v.value) filter (where v.metric = 'follows') follows,
      max(v.value) filter (where v.metric = 'link_clicks') link_clicks
    from (select distinct on (p.metric) p.metric, p.value from post_metric_days p
      where p.draft_id = d.id and p.key = '' order by p.metric, p.day desc) v) i on true
  left join lateral (
    select sum(k.clicks)::int clicks, sum(k.forms_first)::int forms, sum(k.calls_first)::int calls,
      sum(k.won_first)::int won, sum(k.revenue_first)::int revenue_first,
      sum(k.revenue_last)::int revenue_last
    from link_days k
    where k.content = left(d.id::text, 8)
      or (d.platform = 'youtube' and k.source = 'youtube' and k.content = ''
        and d.extra->>'kind' is distinct from 'short' and substring(idea.ref from '^video:([0-9]+)(~|$)') is not null
        and (k.campaign = substring(idea.ref from '^video:([0-9]+)(~|$)')
          or k.campaign like substring(idea.ref from '^video:([0-9]+)(~|$)') || '-%'))) l on true
  left join lateral (
    select count(*) filter (where o.sort is distinct from 'ours' and o.state <> 'dropped')::int theirs,
      count(*) filter (where o.sort is distinct from 'ours' and o.state = 'answered')::int answered
    from comments o where o.post = d.published_id and o.platform::text = d.platform::text) c on true
  where d.status = 'published'`);

/**
 * How conversations go (`marketing.conversation`), per platform and for all of them, over the
 * last 7 days, 30 days and all time: their comments answered and how fast, the commenters we
 * DMed, DMs they answered, and DMs that led to a booked call (their email, by the person behind
 * the contact or its linked handle, booked after our first DM). A commenter counts as DMed when
 * the DM came from the comment, or a DM we sent later went to the same handle or platform id
 * (a client's X DMs, our `dm` touches). Comments we dropped are out of the base.
 */
export const marketingConversation = pgView("marketing_conversation", {
  id: text("id"),
  span: text("span"),
  platform: text("platform"),
  since: timestamp("since", { withTimezone: true }),
  comments: integer("comments"),
  answered: integer("answered"),
  replySecs: doublePrecision("reply_secs"),
  dmed: integer("dmed"),
  dms: integer("dms"),
  dmsAnswered: integer("dms_answered"),
  booked: integer("booked"),
}).as(sql`
  with spans(span, since) as (values
    ('7d', now() - interval '7 days'), ('30d', now() - interval '30 days'),
    ('all', '-infinity'::timestamptz)),
  theirs as (
    select c.platform::text platform, c.at, c.state, c.answered_at,
      c.contact_id is not null
        or exists (select 1 from reach_contacts r
          join reach_messages m on m.contact_id = r.id and m.direction = 'out' and m.state = 'sent'
          where r.platform::text = c.platform::text and m.sent_at > c.at
            and (lower(r.handle) = lower(c.author) or r.profile->>'id' = c.author))
        or exists (select 1 from social_handles h
          join touches t on t.handle_id = h.id and t.kind = 'dm' and t.direction = 'ours'
          where h.platform = c.platform::text and lower(h.handle) = lower(c.author)
            and t.at > c.at) dmed
    from comments c
    where c.sort is distinct from 'ours' and c.state <> 'dropped'),
  firsts as (
    select r.id contact, r.platform::text platform, r.handle, r.person_id,
      min(m.sent_at) first_out from reach_contacts r
    join reach_messages m on m.contact_id = r.id and m.direction = 'out' and m.state = 'sent'
    group by r.id),
  threads as (
    select f.platform, f.first_out,
      exists (select 1 from reach_messages i where i.contact_id = f.contact and i.direction = 'in'
        and i.created_at > f.first_out) answered,
      exists (select 1 from leads ld join call_bookings b on lower(b.email) = lower(ld.email)
        where b.booked_at > f.first_out
          and (ld.person_id = f.person_id
            or exists (select 1 from social_handles h
              where h.platform = f.platform and lower(h.handle) = lower(f.handle)
                and (h.lead_id = ld.id or h.person_id = ld.person_id)))) booked
    from firsts f),
  cs as (
    select s.span, case when grouping(t.platform) = 1 then 'all' else t.platform end platform,
      count(t.at)::int comments,
      count(t.answered_at)::int answered,
      (percentile_cont(0.5) within group (order by extract(epoch from t.answered_at - t.at))
        filter (where t.answered_at is not null))::float8 reply_secs,
      count(*) filter (where t.dmed)::int dmed
    from spans s left join theirs t on t.at >= s.since
    group by grouping sets ((s.span, t.platform), (s.span))),
  ds as (
    select s.span, case when grouping(h.platform) = 1 then 'all' else h.platform end platform,
      count(h.first_out)::int dms, count(*) filter (where h.answered)::int dms_answered,
      count(*) filter (where h.booked)::int booked
    from spans s join threads h on h.first_out >= s.since
    group by grouping sets ((s.span, h.platform), (s.span)))
  select k.span || ':' || k.platform id, k.span, k.platform, s.since,
    coalesce(cs.comments, 0) comments, coalesce(cs.answered, 0) answered, cs.reply_secs,
    coalesce(cs.dmed, 0) dmed, coalesce(ds.dms, 0) dms,
    coalesce(ds.dms_answered, 0) dms_answered, coalesce(ds.booked, 0) booked
  from (select span, platform from cs where platform is not null
    union select span, platform from ds where platform is not null) k
  join spans s on s.span = k.span
  left join cs on cs.span = k.span and cs.platform = k.platform
  left join ds on ds.span = k.span and ds.platform = k.platform`);

/**
 * A draft's timeline (designs/2026-10-07-training-record.md, View), each draft page's Activity
 * tab: its `draft_events` steps, then a post's metrics snapshots, swaps and the replies under it. One
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
    select 'draft:' || v.draft_id, v.started_at, null, 'variant',
      initcap(v.field) || ' swapped to: ' || left(v.value, 200)
    from post_variants v where v.source = 'swap' and v.started_at is not null
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
    case when l.item like 'dm:%' or l.item like 'invite:%' or l.item like 'note:%'
      then split_part(l.item, ':', 2) end contact,
    case when l.item like 'video:%' then split_part(l.item, ':', 2) end video,
    l.at, l.seq, l.kind, l.what
  from lines l
  left join content_drafts d on l.item like 'draft:%' and d.id::text = split_part(l.item, ':', 2)`);

/**
 * What each sent draft got (designs/2026-10-07-training-record.md, Outcomes), read by `wren train`:
 * a post's newest metrics snapshot and the replies under it (follows from its insights days when
 * the snapshot has none: YouTube's subscribers gained); an answered comment's or thread's replies
 * to our answer; a DM or invite contact's messages back. One row per item.
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
    coalesce(m.follows, (select f.value::int from post_metric_days f where f.draft_id = d.id
      and f.metric = 'follows' and f.key = '' order by f.day desc limit 1)) follows,
    (select count(*)::int from content_metrics x where x.draft_id = d.id) snapshots,
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
  from reach_contacts r cross join (values ('dm:'), ('invite:'), ('note:')) k(prefix)
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
  cross join (values ('dm:'), ('invite:'), ('note:')) k(prefix)
  cross join lateral (values (r.name), (r.handle)) n(name)
  where n.name is not null and n.name <> ''`);

/**
 * Every draft not yet out (`marketing.draft`): waiting on a person, scheduled, failed or turned
 * down. `title` reads as a post's does; `written` says whether a person changed the model's words.
 * `missing` is what a person must still pick before the yes (TikTok's privacy or disclosure).
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
  stage: text("stage"),
  to: text("to"),
  format: text("format"),
  missing: text("missing"),
  scheduled: timestamp("scheduled", { withTimezone: true }),
  created: timestamp("created", { withTimezone: true }),
}).as(sql`
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.stage::text stage, d.points_to::text "to",
    case
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      else 'post' end format,
    case
      when d.platform = 'tiktok' and coalesce(d.extra->>'privacy', '') = '' then 'privacy'
      when d.platform = 'tiktok' and d.extra->>'disclose' = 'true'
        and coalesce(d.extra->>'yourBrand', '') <> 'true'
        and coalesce(d.extra->>'brandedContent', '') <> 'true' then 'disclosure'
      end missing,
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published'`);

// ---- Inbox: who has a thread, its status, replies that wait on a yes (2026-10-07-inbox-reply.md) ----

export const INBOX_STATUSES = ["open", "waiting", "closed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/**
 * One Inbox thread's team state, by its typed id (`dm:5`, `text:8`). No row or no `status`: its
 * status follows the channel's own state. A message in after `status_at` opens it again.
 */
export const inboxThreads = pgTable(
  "inbox_threads",
  {
    thread: varchar("thread", { length: 80 }).notNull(),
    assignee: varchar("assignee", { length: 200 }),
    status: varchar("status", { length: 8, enum: INBOX_STATUSES }),
    statusAt: timestamp("status_at", { withTimezone: true }),
    snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
    updatedBy: varchar("updated_by", { length: 200 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.thread], name: "pk_inbox_threads" }),
    index("ix_inbox_threads_assignee").on(t.assignee),
    oneOf("ck_inbox_threads_status", t.status, INBOX_STATUSES),
  ],
);
export type InboxThread = typeof inboxThreads.$inferSelect;

export const INBOX_CHANNELS = ["email", "text", "dm", "comment"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];
export const INBOX_REPLY_STATES = ["waiting", "sent", "dropped", "failed"] as const;
export type InboxReplyState = (typeof INBOX_REPLY_STATES)[number];

/**
 * A reply from the Inbox that waits on a yes (Ask to send): To approve lists it as `reply:<id>`,
 * and Approve sends it on the channel's own path. `target` is that path's id: the reach contact,
 * the text contact, the comment, the email's call invite or reply.
 */
export const inboxReplies = pgTable(
  "inbox_replies",
  {
    id: serial("id").notNull(),
    thread: varchar("thread", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 8, enum: INBOX_CHANNELS }).notNull(),
    target: varchar("target", { length: 80 }).notNull(),
    who: text("who"),
    body: text("body").notNull(),
    why: text("why"),
    state: varchar("state", { length: 8, enum: INBOX_REPLY_STATES }).notNull().default("waiting"),
    detail: text("detail"),
    askedBy: varchar("asked_by", { length: 200 }).notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: varchar("decided_by", { length: 200 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_inbox_replies" }),
    index("ix_inbox_replies_state").on(t.state, t.askedAt),
    index("ix_inbox_replies_thread").on(t.thread),
    oneOf("ck_inbox_replies_channel", t.channel, INBOX_CHANNELS),
    oneOf("ck_inbox_replies_state", t.state, INBOX_REPLY_STATES),
  ],
);
export type InboxReply = typeof inboxReplies.$inferSelect;

/**
 * Learn's tables (designs/2026-10-07-learn.md): the sources followed, every item they bring or
 * someone saves, and the items asked into an SOP. Each row is one workspace's (`client`: a
 * client's id, or `wren` for Wren's own). Items are public pages and videos, so their text and
 * transcripts are kept whole: the repo holds no content, the database does.
 */
import { oneOf } from "@wren/db/columns";
import { type SQL, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const learn = pgSchema("learn");

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** show: worth reading. hold: worth knowing. drop: kept, never shown. */
export const VERDICTS = ["show", "hold", "drop"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What a source is, by its feed: shown, and picks the reader its items get. */
export const SOURCE_KINDS = [
  "youtube",
  "podcast",
  "newsletter",
  "blog",
  "reddit",
  "forum",
  "releases",
  "instagram",
  "x",
  "tiktok",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * How an item is consumed, shown everywhere with its own mark: a YouTube video, a short (YouTube
 * Shorts), a podcast episode, a newsletter post, a blog post, a Reddit thread, an X post, an
 * Instagram or TikTok reel, a release note, or a link saved by hand.
 */
export const TYPES = [
  "youtube",
  "shorts",
  "podcast",
  "newsletter",
  "blog",
  "reddit",
  "x",
  "instagram",
  "tiktok",
  "releases",
  "link",
] as const;
export type ItemType = (typeof TYPES)[number];

/** A moment worth jumping to: seconds in, and what happens there. */
export interface Moment {
  t: number;
  label: string;
}

/** When a source's new item reaches William: every one, 8 and up, or in the 09:00 digest only. */
export const TELLS = ["every", "top", "digest"] as const;
export type Tell = (typeof TELLS)[number];
/** The score "top" alerts at. */
export const TOP_SCORE = 8;

/**
 * article: text (a blog, a newsletter). video: YouTube. reel: a short off YouTube (Instagram,
 * TikTok). post: a text, image or carousel post (LinkedIn, X, Instagram, Threads). film: a produced
 * launch or demo film. episode: a podcast's.
 */
export const ITEM_KINDS = ["article", "video", "reel", "post", "film", "episode"] as const;

/** A post's public numbers; each only when its platform gives it (Instagram: no views). */
export interface PostStats {
  likes?: number;
  comments?: number;
  views?: number;
}
export type ItemKind = (typeof ITEM_KINDS)[number];

/** How a saved item came in. */
export const VIAS = ["portal", "shortcut", "cli"] as const;
export type Via = (typeof VIAS)[number];

/** An item's way into an SOP: asked, written into the folder, or failed with why. */
export const SOP_STATES = ["asked", "added", "failed"] as const;
export type SopState = (typeof SOP_STATES)[number];

/** A feed Wren follows: RSS or Atom (a YouTube channel, a Substack, a blog, a podcast). */
export const sources = learn.table(
  "sources",
  {
    id: serial("id"),
    /** Whose: Wren's own (`wren`) or a client's id. Every read and write is scoped to it. */
    client: varchar("client", { length: 40 }).notNull(),
    url: text("url").notNull(),
    /** The page it was found from (a channel, a blog), when that isn't the feed itself. */
    page: text("page"),
    name: text("name").notNull(),
    kind: varchar("kind", { length: 12, enum: SOURCE_KINDS }).notNull().default("blog"),
    /** Its picture: a channel's avatar, a podcast's artwork, a site's icon. */
    avatarUrl: text("avatar_url"),
    tell: varchar("tell", { length: 8, enum: TELLS }).notNull().default("top"),
    /** The last read that worked. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** The last read's error; null once one works. */
    failure: text("failure"),
    /** Unfollowed: no more reads, its items kept. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_sources" }),
    unique("uq_learn_sources_client_url").on(t.client, t.url),
    oneOf("ck_learn_sources_kind", t.kind, SOURCE_KINDS),
    oneOf("ck_learn_sources_tell", t.tell, TELLS),
  ],
);

/** A collection of items, nested like folders in a drive. */
export const collections = learn.table(
  "collections",
  {
    id: serial("id"),
    /** Whose: Wren's own (`wren`) or a client's id. */
    client: varchar("client", { length: 40 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    /** The collection it sits in; none at the top. */
    parentId: integer("parent_id"),
    by: varchar("by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_collections" }),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "fk_collections_parent_id_collections",
    }).onDelete("cascade"),
    index("ix_learn_collections_parent").on(t.parentId),
    index("ix_learn_collections_client").on(t.client),
  ],
);

/**
 * One item: from a source's feed, or saved by hand (no source). Kept before it's read, read before
 * it's scored. `score` (0-10) is how much it should change how Wren works, against the SOPs.
 */
export const items = learn.table(
  "items",
  {
    id: serial("id"),
    sourceId: integer("source_id"),
    /** Cleaned of tracking params, so a share and its feed entry are one item. */
    url: text("url").notNull(),
    kind: varchar("kind", { length: 8, enum: ITEM_KINDS }).notNull().default("article"),
    /** How it's consumed: picks its mark, its player and its shelf. */
    type: varchar("type", { length: 12, enum: TYPES }).notNull().default("link"),
    title: text("title").notNull(),
    /** Who made it: a channel, an author, a handle. */
    creator: text("creator"),
    /** What the feed or the page gave. */
    text: text("text").notNull().default(""),
    /** What was said and shown, as markdown: the reader's, null until read. */
    transcript: text("transcript"),
    /** The file it becomes under an SOP's `sources/`: "youtube-<id>.md". */
    file: text("file"),
    /** The Mac's video reader must read it: the worker has no yt-dlp. */
    needsMac: timestamp("needs_mac", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** The last read's error; the item waits for the next try. */
    readFailure: text("read_failure"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Its picture: a video's thumbnail, a post's og:image, an episode's artwork. */
    thumbnailUrl: text("thumbnail_url"),
    /** Seconds long, for video and audio. */
    duration: integer("duration"),
    /** The audio file an episode plays. */
    mediaUrl: text("media_url"),
    /** Moments worth jumping to, from the scorer. */
    moments: jsonb("moments").$type<Moment[]>().notNull().default([]),
    /** A followed post's numbers as its platform last gave them (`statsAt`); null when it gives none. */
    stats: jsonb("stats").$type<PostStats>(),
    statsAt: timestamp("stats_at", { withTimezone: true }),
    score: smallint("score"),
    /** Null until scored. */
    verdict: varchar("verdict", { length: 8, enum: VERDICTS }),
    summary: text("summary"),
    /** The SOPs it would change, by name. */
    changes: jsonb("changes").$type<string[]>().notNull().default([]),
    why: text("why"),
    /** Reads of the model's answer; it stops asking after 3. */
    tries: smallint("tries").notNull().default(0),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    /** Its meaning as a unit vector (`EMBED_DIMS`), for search by meaning; null until embedded. */
    embedding: real("embedding").array(),
    /** William shared it in. */
    savedAt: timestamp("saved_at", { withTimezone: true }),
    savedBy: varchar("saved_by", { length: 320 }),
    savedVia: varchar("saved_via", { length: 8, enum: VIAS }),
    /** An alert or a digest named it. */
    toldAt: timestamp("told_at", { withTimezone: true }),
    /** First opened: read, not new. */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    /** Out of the way: archived. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Seconds watched or heard, to resume. */
    position: integer("position"),
    /** Last played: orders Continue watching. */
    playedAt: timestamp("played_at", { withTimezone: true }),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    /** In the Watch later queue since. */
    laterAt: timestamp("later_at", { withTimezone: true }),
    /** Kept at the top of every list it's in. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /** The collection it sits in, like a file in a folder. */
    collectionId: integer("collection_id"),
    /** Whose: Wren's own (`wren`) or a client's id. Its pictures and audio load for them alone. */
    client: varchar("client", { length: 40 }).notNull(),
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english'::regconfig, title), 'A'::"char") || setweight(to_tsvector('english'::regconfig, coalesce(summary, ''::text)), 'B'::"char") || setweight(to_tsvector('english'::regconfig, coalesce(transcript, text)), 'C'::"char")`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_items" }),
    foreignKey({
      columns: [t.sourceId],
      foreignColumns: [sources.id],
      name: "fk_items_source_id_sources",
    }),
    foreignKey({
      columns: [t.collectionId],
      foreignColumns: [collections.id],
      name: "fk_items_collection_id_collections",
    }).onDelete("set null"),
    index("ix_learn_items_collection").on(t.collectionId),
    index("ix_learn_items_type").on(t.type),
    unique("uq_learn_items_client_url").on(t.client, t.url),
    index("ix_learn_items_source").on(t.sourceId),
    index("ix_learn_items_created").on(t.createdAt),
    index("ix_learn_items_saved").on(t.savedAt),
    index("ix_learn_items_search").using("gin", t.search),
    check("ck_learn_items_score", sql`${t.score} between 0 and 10`),
    oneOf("ck_learn_items_kind", t.kind, ITEM_KINDS),
    oneOf("ck_learn_items_type", t.type, TYPES),
    oneOf("ck_learn_items_verdict", t.verdict, VERDICTS),
    oneOf("ck_learn_items_saved_via", t.savedVia, VIAS),
  ],
);

/**
 * How an item is made (`breakdown.ts`, designs/2026-10-25-competitor-analyzer.md): its hook style
 * from a fixed set, the hook line, the beats, the call to action, and in `facts` what its kind's
 * rubric adds (a reel's format, a post's shape and counts, a film's shots). One row an item,
 * written once it is read.
 */
export const HOOK_STYLES = [
  "contrarian",
  "demo-first",
  "result-first",
  "identity-call",
  "list-tease",
  "question",
  "story",
  "warning",
  "news",
  "how-to",
  "pattern-break",
  "other",
] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];
export const CTA_KINDS = [
  "comment-word",
  "follow",
  "link",
  "dm",
  "save-share",
  "none",
  "other",
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];
export const POST_FORMATS = [
  "talking-head",
  "screen-demo",
  "voiceover",
  "text-on-screen",
  "mixed",
] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

/** One beat of a script: when it starts (seconds, when the transcript is timed) and what it does. */
export interface Beat {
  t: number | null;
  beat: string;
}

export const breakdowns = learn.table(
  "breakdowns",
  {
    itemId: integer("item_id").notNull(),
    hookStyle: varchar("hook_style", { length: 16, enum: HOOK_STYLES }).notNull(),
    /** The opening line, as said or shown. */
    hook: text("hook").notNull(),
    /** Why the hook works, one sentence. */
    hookWhy: text("hook_why").notNull(),
    topic: text("topic").notNull(),
    /** The item's kind when it was broken down: which rubric `facts` follows. */
    kind: varchar("kind", { length: 8, enum: ITEM_KINDS }).notNull(),
    /** The kind's facts, checked by its rubric's schema at write time (`FACTS` in breakdown.ts). */
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
    beats: jsonb("beats").$type<Beat[]>().notNull().default([]),
    ctaKind: varchar("cta_kind", { length: 12, enum: CTA_KINDS }).notNull(),
    /** The ask, as said; null with `none`. */
    cta: text("cta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId], name: "pk_breakdowns" }),
    foreignKey({
      columns: [t.itemId],
      foreignColumns: [items.id],
      name: "fk_breakdowns_item_id_items",
    }).onDelete("cascade"),
    index("ix_learn_breakdowns_hook_style").on(t.hookStyle),
    index("ix_learn_breakdowns_kind").on(t.kind),
    oneOf("ck_learn_breakdowns_hook_style", t.hookStyle, HOOK_STYLES),
    oneOf("ck_learn_breakdowns_kind", t.kind, ITEM_KINDS),
    oneOf("ck_learn_breakdowns_cta_kind", t.ctaKind, CTA_KINDS),
  ],
);

/** When each person last looked at what a workspace's sources brought: its badge counts past it. */
export const seen = learn.table(
  "seen",
  {
    client: varchar("client", { length: 40 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.client, t.email], name: "pk_seen" })],
);

/** An item asked into an SOP's folder; the Mac writes it there and marks it added. */
export const sopSources = learn.table(
  "sop_sources",
  {
    id: serial("id"),
    /** The Learn item asked in; null for words from a note. */
    itemId: integer("item_id"),
    /** The note the words came from (Notes → Make an SOP), with the words themselves. */
    noteId: uuid("note_id"),
    /** Whose note: Wren's (`wren`) or a client's id; null for an item's (the item says). */
    client: varchar("client", { length: 40 }),
    title: text("title"),
    text: text("text"),
    /** The SOP's folder name, as `wren sop ls` prints it. */
    sop: varchar("sop", { length: 64 }).notNull(),
    state: varchar("state", { length: 8, enum: SOP_STATES }).notNull().default("asked"),
    /** Its file under `sources/`, once written. */
    file: text("file"),
    /** Its points were extracted into `points/`. */
    points: timestamp("points", { withTimezone: true }),
    error: text("error"),
    by: varchar("by", { length: 320 }),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_sop_sources" }),
    foreignKey({
      columns: [t.itemId],
      foreignColumns: [items.id],
      name: "fk_sop_sources_item_id_items",
    }).onDelete("cascade"),
    unique("uq_learn_sop_sources_item_sop").on(t.itemId, t.sop),
    index("ix_learn_sop_sources_sop").on(t.sop),
    oneOf("ck_learn_sop_sources_state", t.state, SOP_STATES),
    check(
      "ck_learn_sop_sources_from",
      sql`(${t.itemId} is not null) <> (${t.noteId} is not null and ${t.client} is not null and ${t.text} is not null)`,
    ),
  ],
);

/** An item's tags: short words, any number per item. */
export const itemTags = learn.table(
  "item_tags",
  {
    itemId: integer("item_id").notNull(),
    tag: varchar("tag", { length: 40 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tag], name: "pk_item_tags" }),
    foreignKey({
      columns: [t.itemId],
      foreignColumns: [items.id],
      name: "fk_item_tags_item_id_items",
    }).onDelete("cascade"),
    index("ix_learn_item_tags_tag").on(t.tag),
  ],
);

/**
 * What a person hears about a source's new items in the portal's bell: every post, only those
 * that score 8 and up, or nothing (they still show in Today).
 */
export const ALERT_PICKS = ["every", "top", "off"] as const;
export type AlertPick = (typeof ALERT_PICKS)[number];
/** Why an alert: a new post, a post that scored high, a saved link that read and scored high. */
export const ALERT_WHYS = ["new", "score", "saved"] as const;
export type AlertWhy = (typeof ALERT_WHYS)[number];
/** Where it went: the bell, or rolled into the person's Today once the hour's bell was full. */
export const ALERT_STATES = ["bell", "digest"] as const;
export type AlertState = (typeof ALERT_STATES)[number];
/** The bell rings at most this many times an hour per person per workspace; the rest roll into Today. */
export const ALERTS_PER_HOUR = 5;

/** A person's pick for one source; no row takes the source's own `tell` (digest is off). */
export const alertPicks = learn.table(
  "alert_picks",
  {
    client: varchar("client", { length: 40 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    sourceId: integer("source_id").notNull(),
    pick: varchar("pick", { length: 8, enum: ALERT_PICKS }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.client, t.email, t.sourceId], name: "pk_alert_picks" }),
    index("ix_learn_alert_picks_source").on(t.sourceId),
    foreignKey({
      columns: [t.sourceId],
      foreignColumns: [sources.id],
      name: "fk_alert_picks_source_id_sources",
    }).onDelete("cascade"),
    oneOf("ck_learn_alert_picks_pick", t.pick, ALERT_PICKS),
  ],
);

/** A person in a workspace's Learn: their pick for saved links, and the day their digest was mailed. */
export const readers = learn.table(
  "readers",
  {
    client: varchar("client", { length: 40 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    /** Saved links alert once read and scored 8 and up (top), or never (off). */
    saved: varchar("saved", { length: 8, enum: ALERT_PICKS }).notNull().default("top"),
    /** The last day (the fleet's clock) their digest mail went, or had nothing to say. */
    mailedOn: date("mailed_on"),
  },
  (t) => [
    primaryKey({ columns: [t.client, t.email], name: "pk_readers" }),
    oneOf("ck_learn_readers_saved", t.saved, ALERT_PICKS),
  ],
);

/** One item told to one person: in the bell, or rolled into their Today. Never twice. */
export const alerts = learn.table(
  "alerts",
  {
    id: serial("id"),
    client: varchar("client", { length: 40 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    itemId: integer("item_id").notNull(),
    why: varchar("why", { length: 8, enum: ALERT_WHYS }).notNull(),
    state: varchar("state", { length: 8, enum: ALERT_STATES }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** They opened the bell after it. */
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_alerts" }),
    foreignKey({
      columns: [t.itemId],
      foreignColumns: [items.id],
      name: "fk_alerts_item_id_items",
    }).onDelete("cascade"),
    unique("uq_learn_alerts_person_item").on(t.client, t.email, t.itemId),
    index("ix_learn_alerts_person_at").on(t.client, t.email, t.at),
    index("ix_learn_alerts_item").on(t.itemId),
    oneOf("ck_learn_alerts_why", t.why, ALERT_WHYS),
    oneOf("ck_learn_alerts_state", t.state, ALERT_STATES),
  ],
);

/**
 * A workspace's Learn settings. `digestMail`: mail each person their daily digest at their login
 * address. Off until a person with manage turns it on; Wren's own needs William's yes.
 */
export const learnSettings = learn.table(
  "settings",
  {
    client: varchar("client", { length: 40 }).notNull(),
    digestMail: boolean("digest_mail").notNull().default(false),
    by: varchar("by", { length: 320 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.client], name: "pk_settings" })],
);

/** One row a day the 09:00 digest went out (or had nothing to say), so a day sends one. */
export const digests = learn.table(
  "digests",
  {
    day: date("day").notNull(),
    /** Items it named; 0 when nothing was new. */
    items: integer("items").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day], name: "pk_digests" })],
);

/**
 * `items` as records. `state` is where it is: waiting to be read, waiting for the Mac, failed,
 * waiting for a score, or its verdict; done once marked. `source` is the source's name, or Saved.
 */
const ITEM_SELECT = sql`
    select i.id, i.title, i.kind::text kind, i.type::text type, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.archived_at is not null then 'archived'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      case when i.archived_at is not null then 'archived' when i.opened_at is not null then 'read'
        else 'unread' end status,
      i.read_failure failure,
      (select string_agg(t.tag, ', ' order by t.tag) from learn.item_tags t
        where t.item_id = i.id) tags,
      col.name collection, i.starred_at is not null starred, i.later_at is not null later,
      i.duration,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id
      left join learn.collections col on col.id = i.collection_id
    where i.client = 'wren'`;

const ITEM_COLUMNS = {
  id: integer("id"),
  title: text("title"),
  kind: text("kind"),
  type: text("type"),
  creator: text("creator"),
  source: text("source"),
  sourceKind: text("source_kind"),
  sourceId: integer("source_id"),
  score: integer("score"),
  summary: text("summary"),
  changes: text("changes"),
  why: text("why"),
  verdict: text("verdict"),
  state: text("state"),
  status: text("status"),
  failure: text("failure"),
  tags: text("tags"),
  collection: text("collection"),
  starred: boolean("starred"),
  later: boolean("later"),
  duration: integer("duration"),
  sops: text("sops"),
  at: timestamp("at", { withTimezone: true }),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  savedVia: text("saved_via"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  open: text("open"),
  chars: integer("chars"),
};

export const itemRecords = learn.view("item_records", ITEM_COLUMNS).as(ITEM_SELECT);

/** What William shared in, newest first: his reel history. */
export const savedRecords = learn
  .view("saved_records", ITEM_COLUMNS)
  .as(sql`select * from (${ITEM_SELECT}) x where x.saved_at is not null`);

/** `sources` as records, with what each brought. */
export const sourceRecords = learn
  .view("source_records", {
    id: integer("id"),
    name: text("name"),
    url: text("url"),
    page: text("page"),
    kind: text("kind"),
    avatarUrl: text("avatar_url"),
    tell: text("tell"),
    state: text("state"),
    items: integer("items"),
    shown: integer("shown"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    failure: text("failure"),
    by: text("by"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  })
  .as(sql`
    select s.id, s.name, s.url, s.page, s.kind::text kind, s.avatar_url, s.tell::text tell,
      case when s.stopped_at is not null then 'stopped' when s.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      s.fetched_at, s.failure, s.by::text by, s.created_at
    from learn.sources s left join learn.items i on i.source_id = s.id
    where s.client = 'wren'
    group by s.id`);

/**
 * Each broken-down reel or video, Wren's own, with its numbers: the Competitors pages. `reach` is
 * views when the platform gives them, else likes plus comments, so rows from both rank together.
 */
export const breakdownRecords = learn
  .view("breakdown_records", {
    id: integer("id"),
    title: text("title"),
    creator: text("creator"),
    source: text("source"),
    sourceId: integer("source_id"),
    followed: text("followed"),
    type: text("type"),
    kind: text("kind"),
    hookStyle: text("hook_style"),
    hook: text("hook"),
    hookWhy: text("hook_why"),
    topic: text("topic"),
    format: text("format"),
    beats: text("beats"),
    ctaKind: text("cta_kind"),
    cta: text("cta"),
    likes: integer("likes"),
    comments: integer("comments"),
    views: integer("views"),
    reach: integer("reach"),
    score: integer("score"),
    at: timestamp("at", { withTimezone: true }),
    statsAt: timestamp("stats_at", { withTimezone: true }),
    open: text("open"),
  })
  .as(sql`
    select i.id, i.title, coalesce(i.creator, s.name) creator, coalesce(s.name, 'Saved') source,
      i.source_id, case when i.source_id is null then 'saved' else 'followed' end followed,
      i.type::text type, i.kind::text kind, b.hook_style::text hook_style, b.hook, b.hook_why,
      b.topic, b.facts->>'format' format,
      (select string_agg(case when x.value->>'t' is null then '' else
          '[' || ((x.value->>'t')::int / 60) || ':' || lpad(((x.value->>'t')::int % 60)::text, 2, '0') || '] ' end
          || (x.value->>'beat'), chr(10) order by x.ordinality)
        from jsonb_array_elements(b.beats) with ordinality x) beats,
      b.cta_kind::text cta_kind, b.cta,
      (i.stats->>'likes')::int likes, (i.stats->>'comments')::int comments,
      (i.stats->>'views')::int views,
      coalesce((i.stats->>'views')::int,
        nullif(coalesce((i.stats->>'likes')::int, 0) + coalesce((i.stats->>'comments')::int, 0), 0)) reach,
      i.score::int score, coalesce(i.published_at, i.created_at) at, i.stats_at, i.url open
    from learn.breakdowns b join learn.items i on i.id = b.item_id
      left join learn.sources s on s.id = i.source_id
    where i.client = 'wren'`);

/** Each hook style across Wren's broken-down reels: how often, by whom, and how far it reached. */
export const hookRecords = learn
  .view("hook_records", {
    id: text("id"),
    style: text("style"),
    reels: integer("reels"),
    creators: integer("creators"),
    medianReach: integer("median_reach"),
    topReach: integer("top_reach"),
    top: text("top"),
    topCreator: text("top_creator"),
    lastAt: timestamp("last_at", { withTimezone: true }),
  })
  .as(sql`
    select r.hook_style id, r.hook_style style, count(*)::int reels, count(distinct r.creator)::int creators,
      (percentile_cont(0.5) within group (order by r.reach))::int median_reach,
      max(r.reach)::int top_reach,
      (array_agg(r.title order by r.reach desc nulls last))[1] top,
      (array_agg(r.creator order by r.reach desc nulls last))[1] top_creator,
      max(r.at) last_at
    from learn.breakdown_records r
    group by r.hook_style`);

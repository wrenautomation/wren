/**
 * Learn's tables (designs/2026-10-07-learn.md): the sources Wren follows, every item they bring or
 * William saves, and the items asked into an SOP. Items are public pages and videos, so their
 * text and transcripts are kept whole: the repo holds no content, the database does.
 */
import { oneOf } from "@wren/db/columns";
import { type SQL, sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const learn = pgSchema("learn");

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** show: worth reading. hold: worth knowing. drop: kept, never shown. */
export const VERDICTS = ["show", "hold", "drop"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What a source is, by its feed: shown, and picks the reader its items get. */
export const SOURCE_KINDS = ["youtube", "podcast", "blog", "forum", "releases"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** When a source's new item reaches William: every one, 8 and up, or in the 09:00 digest only. */
export const TELLS = ["every", "top", "digest"] as const;
export type Tell = (typeof TELLS)[number];
/** The score "top" alerts at. */
export const TOP_SCORE = 8;

/** article: text. video: YouTube. reel: a short off YouTube (Instagram, TikTok, X). episode: a podcast's. */
export const ITEM_KINDS = ["article", "video", "reel", "episode"] as const;
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
    url: text("url").notNull(),
    /** The page it was found from (a channel, a blog), when that isn't the feed itself. */
    page: text("page"),
    name: text("name").notNull(),
    kind: varchar("kind", { length: 12, enum: SOURCE_KINDS }).notNull().default("blog"),
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
    unique("uq_learn_sources_url").on(t.url),
    oneOf("ck_learn_sources_kind", t.kind, SOURCE_KINDS),
    oneOf("ck_learn_sources_tell", t.tell, TELLS),
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
    /** William shared it in. */
    savedAt: timestamp("saved_at", { withTimezone: true }),
    savedBy: varchar("saved_by", { length: 320 }),
    savedVia: varchar("saved_via", { length: 8, enum: VIAS }),
    /** An alert or a digest named it. */
    toldAt: timestamp("told_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
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
    unique("uq_learn_items_url").on(t.url),
    index("ix_learn_items_source").on(t.sourceId),
    index("ix_learn_items_created").on(t.createdAt),
    index("ix_learn_items_saved").on(t.savedAt),
    index("ix_learn_items_search").using("gin", t.search),
    check("ck_learn_items_score", sql`${t.score} between 0 and 10`),
    oneOf("ck_learn_items_kind", t.kind, ITEM_KINDS),
    oneOf("ck_learn_items_verdict", t.verdict, VERDICTS),
    oneOf("ck_learn_items_saved_via", t.savedVia, VIAS),
  ],
);

/** An item asked into an SOP's folder; the Mac writes it there and marks it added. */
export const sopSources = learn.table(
  "sop_sources",
  {
    id: serial("id"),
    itemId: integer("item_id").notNull(),
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
  ],
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
    select i.id, i.title, i.kind::text kind, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.done_at is not null then 'done'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      i.read_failure failure,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id`;

const ITEM_COLUMNS = {
  id: integer("id"),
  title: text("title"),
  kind: text("kind"),
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
  failure: text("failure"),
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
    select s.id, s.name, s.url, s.page, s.kind::text kind, s.tell::text tell,
      case when s.stopped_at is not null then 'stopped' when s.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      s.fetched_at, s.failure, s.by::text by, s.created_at
    from learn.sources s left join learn.items i on i.source_id = s.id
    group by s.id`);

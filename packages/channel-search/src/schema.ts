import { runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Search: what Google and the AI answer engines show for a site, and the
 * keywords we want it found for. Numbers are Google's, stored as it says them;
 * nothing here decides. The loop (`restate/watch.ts`) reads these to propose.
 */

/** Search Console, one row per day, query and page. Re-read for a week: Google revises late. */
export const searchDays = pgTable(
  "search_days",
  {
    day: date("day").notNull(),
    query: text("query").notNull(),
    /** The full URL Google showed. */
    page: text("page").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    /** Average position, 1 = top. */
    position: doublePrecision("position").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.query, t.page], name: "pk_search_days" }),
    index("ix_search_days_query").on(t.query),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_days_run_id_runs",
    }),
  ],
);
export type SearchDay = typeof searchDays.$inferSelect;

/** Search Console's URL inspection, one row per page per day checked. */
export const searchPages = pgTable(
  "search_pages",
  {
    url: text("url").notNull(),
    checkedOn: date("checked_on").notNull(),
    /** PASS, NEUTRAL, FAIL or VERDICT_UNSPECIFIED, as Google says it. */
    verdict: varchar("verdict", { length: 32 }).notNull(),
    /** "Submitted and indexed", "Discovered - currently not indexed", ... */
    coverage: text("coverage"),
    lastCrawl: timestamp("last_crawl", { withTimezone: true }),
    googleCanonical: text("google_canonical"),
    raw: jsonb("raw").notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.url, t.checkedOn], name: "pk_search_pages" }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_pages_run_id_runs",
    }),
  ],
);
export type SearchPage = typeof searchPages.$inferSelect;

/** seed: a person added it. fanout: a sub-question of a seed. query: people already searched it. */
export const KEYWORD_SOURCES = ["seed", "fanout", "query"] as const;
export type KeywordSource = (typeof KEYWORD_SOURCES)[number];

/** A phrase we want the site found for. Retired, never deleted, so its history stays readable. */
export const searchKeywords = pgTable(
  "search_keywords",
  {
    id: serial("id").notNull(),
    phrase: text("phrase").notNull(),
    /** The path meant to answer it (`/recruiting/lead-reactivation`); null = the model picks. */
    page: text("page"),
    source: varchar("source", { length: 16, enum: KEYWORD_SOURCES }).notNull(),
    /** The seed a fan-out question came from. */
    parentId: integer("parent_id"),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_search_keywords" }),
    unique("uq_search_keywords_phrase").on(t.phrase),
    oneOf("ck_search_keywords_source", t.source, KEYWORD_SOURCES),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "fk_search_keywords_parent_id_search_keywords",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_keywords_run_id_runs",
    }),
  ],
);
export type SearchKeyword = typeof searchKeywords.$inferSelect;

export const ENGINES = ["google", "perplexity"] as const;
export type Engine = (typeof ENGINES)[number];

/** What an engine answered for a keyword on a day: did it cite the site, and where. */
export const searchAnswers = pgTable(
  "search_answers",
  {
    engine: varchar("engine", { length: 16, enum: ENGINES }).notNull(),
    keywordId: integer("keyword_id").notNull(),
    askedOn: date("asked_on").notNull(),
    /** The site is among the answer's sources (AI Overview or Perplexity citations). */
    cited: boolean("cited").notNull(),
    /** The site's place among the organic results (Google) or citations (Perplexity), 1-based; null = absent. */
    rank: integer("rank"),
    /** Google showed an AI Overview; null for engines that always answer. */
    overview: boolean("overview"),
    /** Every URL the answer cited, in order. */
    sources: jsonb("sources").$type<string[]>().notNull(),
    /** Google's "People also ask": real questions, fed back as fan-out. */
    questions: jsonb("questions").$type<string[]>().notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.engine, t.keywordId, t.askedOn], name: "pk_search_answers" }),
    oneOf("ck_search_answers_engine", t.engine, ENGINES),
    foreignKey({
      columns: [t.keywordId],
      foreignColumns: [searchKeywords.id],
      name: "fk_search_answers_keyword_id_search_keywords",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_answers_run_id_runs",
    }),
  ],
);
export type SearchAnswer = typeof searchAnswers.$inferSelect;

export const PROPOSAL_KINDS = ["title", "description", "heading", "copy", "faq", "page"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
/** open: waiting on a person. taken: in a pull request. dropped: a person said no, or it went stale. */
export const PROPOSAL_STATES = ["open", "taken", "dropped"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** One small edit for the keywords (the `/search-week` skill writes them, `refusal` gates them). `current` is the page's text word for word. */
export const searchProposals = pgTable(
  "search_proposals",
  {
    id: serial("id").notNull(),
    madeOn: date("made_on").notNull(),
    page: text("page").notNull(),
    kind: varchar("kind", { length: 16, enum: PROPOSAL_KINDS }).notNull(),
    current: text("current").notNull(),
    proposed: text("proposed").notNull(),
    why: text("why").notNull(),
    /** The keywords it serves, by phrase. */
    keywords: jsonb("keywords").$type<string[]>().notNull(),
    state: varchar("state", { length: 16, enum: PROPOSAL_STATES }).notNull().default("open"),
    /** The pull request that took it. */
    pr: text("pr"),
    /** The model call that made it (`CallRecord`): rows from before the skill; null since. */
    llm: jsonb("llm"),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_search_proposals" }),
    oneOf("ck_search_proposals_kind", t.kind, PROPOSAL_KINDS),
    oneOf("ck_search_proposals_state", t.state, PROPOSAL_STATES),
    index("ix_search_proposals_state").on(t.state),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_proposals_run_id_runs",
    }),
  ],
);
export type SearchProposal = typeof searchProposals.$inferSelect;

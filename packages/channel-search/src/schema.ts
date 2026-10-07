import { runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
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
    index("ix_search_days_run_id").on(t.runId),
    index("ix_search_days_query").on(t.query),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_search_days_run_id_runs",
    }),
  ],
);
export type SearchDay = typeof searchDays.$inferSelect;

/** What Search Console's URL inspection can say about a page (its `verdict` enum). */
export const INSPECTION_VERDICTS = [
  "PASS",
  "PARTIAL",
  "FAIL",
  "NEUTRAL",
  "VERDICT_UNSPECIFIED",
] as const;

export type InspectionVerdict = (typeof INSPECTION_VERDICTS)[number];

/** Search Console's URL inspection, one row per page per day checked. */
export const searchPages = pgTable(
  "search_pages",
  {
    url: text("url").notNull(),
    checkedOn: date("checked_on").notNull(),
    /** As Google says it. */
    verdict: varchar("verdict", { length: 32, enum: INSPECTION_VERDICTS }).notNull(),
    /** "Submitted and indexed", "Discovered - currently not indexed", ... */
    coverage: text("coverage"),
    lastCrawl: timestamp("last_crawl", { withTimezone: true }),
    googleCanonical: text("google_canonical"),
    raw: jsonb("raw").notNull(),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.url, t.checkedOn], name: "pk_search_pages" }),
    index("ix_search_pages_run_id").on(t.runId),
    oneOf("ck_search_pages_verdict", t.verdict, INSPECTION_VERDICTS),
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
    index("ix_search_keywords_run_id").on(t.runId),
    index("ix_search_keywords_parent_id").on(t.parentId),
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
    index("ix_search_answers_run_id").on(t.runId),
    index("ix_search_answers_keyword_id").on(t.keywordId),
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
    index("ix_search_proposals_run_id").on(t.runId),
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

/** A site day's channel: the visitor's first touch, `other` for a touch that names none, `direct` for no touch. */
export const SITE_CHANNELS = [
  "email",
  "sms",
  "ads",
  "content",
  "search",
  "reach",
  "other",
  "direct",
] as const;
export type SiteChannel = (typeof SITE_CHANNELS)[number];

/**
 * The lander's visits rolled up per day, first-touch channel and campaign. Counts only: a
 * visitor id never lands here. Each daily pass recomputes from the export and upserts, so a
 * re-read overwrites and never adds.
 */
export const siteDays = pgTable(
  "site_days",
  {
    day: date("day").notNull(),
    channel: varchar("channel", { length: 16, enum: SITE_CHANNELS }).notNull(),
    /** `utm_campaign` of the first touch, "" when none. */
    campaign: varchar("campaign", { length: 100 }).notNull(),
    /** Visitors seen that day. */
    visits: integer("visits").notNull(),
    /** Visitors seen for the first time that day. */
    firstTouches: integer("first_touches").notNull(),
    /** Pitch-page applications. */
    forms: integer("forms").notNull(),
    /** Clicks on a booking link (`/book/<offer>`). */
    bookings: integer("bookings").notNull(),
    /** Views of an offer's video page (`/watch/<offer>`). */
    watchPlays: integer("watch_plays").notNull(),
    /** Calls booked on cal.com (not cancelled), by when they were booked. */
    calls: integer("calls").default(0).notNull(),
    /** Engagements whose first invoice was paid that day, under the engagement's source. */
    paid: integer("paid").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.channel, t.campaign], name: "pk_site_days" }),
    oneOf("ck_site_days_channel", t.channel, SITE_CHANNELS),
  ],
);
export type SiteDay = typeof siteDays.$inferSelect;

/**
 * The lander's export per day and link (designs/2026-10-07-content-analytics.md): a `/go/` link's
 * source, campaign and content (`/go/yt/<video slug>`, `/go/li/<stage>/<first 8 of the draft>`).
 * Clicks are visitors arriving on it that day; forms, calls and won count under the first and
 * the last touch of the person who sent them, so a post gets credit both ways. Re-read and
 * upserted like `site_days`.
 */
export const linkDays = pgTable(
  "link_days",
  {
    day: date("day").notNull(),
    /** `utm_source`: youtube, linkedin, instagram. */
    source: varchar("source", { length: 40 }).notNull(),
    campaign: varchar("campaign", { length: 100 }).notNull(),
    content: varchar("content", { length: 100 }).notNull(),
    /** Visitors who arrived on the link that day. */
    clicks: integer("clicks").notNull(),
    /** Hops to a YouTube video (`/go/...?v=`), which load no page of ours. */
    hops: integer("hops").notNull(),
    formsFirst: integer("forms_first").notNull(),
    formsLast: integer("forms_last").notNull(),
    callsFirst: integer("calls_first").notNull(),
    callsLast: integer("calls_last").notNull(),
    wonFirst: integer("won_first").notNull(),
    wonLast: integer("won_last").notNull(),
    /** Paid invoices of the clients it won, in cents (USD). */
    revenueFirst: integer("revenue_first").notNull(),
    revenueLast: integer("revenue_last").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.source, t.campaign, t.content], name: "pk_link_days" }),
    index("ix_link_days_content").on(t.content),
  ],
);
export type LinkDay = typeof linkDays.$inferSelect;

/** The lander's width buckets (its `src/scripts/hit.ts`): under 768, 1024, 1440, and wider. */
export const HEAT_WIDTHS = ["phone", "tablet", "laptop", "wide"] as const;
export type HeatWidth = (typeof HEAT_WIDTHS)[number];

/**
 * Clicks on the lander per day, page, width bucket, element path and where in the element (a
 * 10 by 10 grid, `cell` = row * 10 + column), from its `click` and `rage` events. Counts only,
 * no visitor ids. Heatmaps rebuild the page from a replay and find each path in it.
 */
export const heatDays = pgTable(
  "heat_days",
  {
    day: date("day").notNull(),
    page: varchar("page", { length: 200 }).notNull(),
    width: varchar("width", { length: 8, enum: HEAT_WIDTHS }).notNull(),
    /** A CSS path from an id, a `[data-signal]` or body, 8 steps at most. */
    path: varchar("path", { length: 300 }).notNull(),
    cell: integer("cell").notNull(),
    clicks: integer("clicks").notNull(),
    /** Clicks that were the third on one element inside a second. */
    rage: integer("rage").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.page, t.width, t.path, t.cell], name: "pk_heat_days" }),
    oneOf("ck_heat_days_width", t.width, HEAT_WIDTHS),
  ],
);

/**
 * How far down the lander's pages views got, per day, page and width bucket: `views` reached
 * `band` (0 is the top tenth, so every view; 9 the last tenth).
 */
export const scrollDays = pgTable(
  "scroll_days",
  {
    day: date("day").notNull(),
    page: varchar("page", { length: 200 }).notNull(),
    width: varchar("width", { length: 8, enum: HEAT_WIDTHS }).notNull(),
    band: integer("band").notNull(),
    views: integer("views").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.page, t.width, t.band], name: "pk_scroll_days" }),
    oneOf("ck_scroll_days_width", t.width, HEAT_WIDTHS),
  ],
);

/**
 * A week of Search Console: the 7 days up to its newest day (Google is 2 or 3 days behind, so
 * today would undercount), against the 7 before, grouped `by` page or query.
 */
const searchWeek = (by: "page" | "query") =>
  sql.raw(`select ${by} k,
    sum(clicks) filter (where day > w.d - 7)::int clicks,
    sum(impressions) filter (where day > w.d - 7)::int impressions,
    round((sum(position * impressions) filter (where day > w.d - 7)
      / nullif(sum(impressions) filter (where day > w.d - 7), 0))::numeric, 1)::float "position",
    sum(clicks) filter (where day <= w.d - 7)::int clicks_before,
    sum(impressions) filter (where day <= w.d - 7)::int impressions_before
  from search_days, (select max(day) d from search_days) w
  where day > w.d - 14 group by ${by}`);

/** Each sitemap page (`marketing.search_page`): its index state and its week in Google. */
export const marketingSearchPageRecords = pgView("marketing_search_page_records", {
  id: text("id"),
  url: text("url"),
  indexed: text("indexed"),
  coverage: text("coverage"),
  checked: date("checked"),
  clicks: integer("clicks"),
  impressions: integer("impressions"),
  position: doublePrecision("position"),
  clicksChange: integer("clicks_change"),
  impressionsChange: integer("impressions_change"),
}).as(sql`
  select p.url id, p.url, case when p.verdict = 'PASS' then 'indexed' else 'not_indexed' end indexed,
    p.coverage, p.checked_on checked, coalesce(w.clicks, 0) clicks,
    coalesce(w.impressions, 0) impressions, w.position,
    coalesce(w.clicks, 0) - coalesce(w.clicks_before, 0) clicks_change,
    coalesce(w.impressions, 0) - coalesce(w.impressions_before, 0) impressions_change
  from (select distinct on (url) url, verdict, coverage, checked_on from search_pages
        order by url, checked_on desc) p
  left join (${searchWeek("page")}) w on w.k = p.url`);

/** Each keyword (`marketing.keyword`): its week in Google, by the query that is its phrase. */
export const marketingKeywordRecords = pgView("marketing_keyword_records", {
  id: integer("id"),
  phrase: text("phrase"),
  source: text("source"),
  page: text("page"),
  state: text("state"),
  clicks: integer("clicks"),
  impressions: integer("impressions"),
  position: doublePrecision("position"),
  clicksChange: integer("clicks_change"),
  impressionsChange: integer("impressions_change"),
  added: timestamp("added", { withTimezone: true }),
}).as(sql`
  select k.id, k.phrase, k.source::text source, k.page,
    case when k.retired_at is null then 'active' else 'retired' end state,
    coalesce(w.clicks, 0) clicks, coalesce(w.impressions, 0) impressions, w.position,
    coalesce(w.clicks, 0) - coalesce(w.clicks_before, 0) clicks_change,
    coalesce(w.impressions, 0) - coalesce(w.impressions_before, 0) impressions_change,
    k.added_at added
  from search_keywords k left join (${searchWeek("query")}) w on w.k = k.phrase`);

/** Each day in Google (`marketing.search_day`), all pages and queries added up. */
export const marketingSearchDayRecords = pgView("marketing_search_day_records", {
  id: text("id"),
  day: date("day"),
  clicks: integer("clicks"),
  impressions: integer("impressions"),
  position: doublePrecision("position"),
}).as(sql`
  select day::text id, day, sum(clicks)::int clicks, sum(impressions)::int impressions,
    round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1)::float "position"
  from search_days group by day`);

/** Each answer an engine gave (`marketing.answer`); `latest` marks the newest per engine and keyword. */
export const marketingAnswerRecords = pgView("marketing_answer_records", {
  id: text("id"),
  phrase: text("phrase"),
  engine: text("engine"),
  asked: date("asked"),
  cited: text("cited"),
  rank: integer("rank"),
  overview: text("overview"),
  latest: text("latest"),
}).as(sql`
  select concat_ws('/', a.engine, a.keyword_id, a.asked_on) id, k.phrase, a.engine::text engine,
    a.asked_on asked, case when a.cited then 'cited' else 'not_cited' end cited, a.rank,
    case when a.overview then 'shown' when not a.overview then 'none' end overview,
    case when a.asked_on = max(a.asked_on) over (partition by a.engine, a.keyword_id)
      then 'latest' else 'older' end latest
  from search_answers a join search_keywords k on k.id = a.keyword_id`);

/** Each day, channel and campaign on the site (`marketing.site_day`), by first touch. */
export const marketingSiteDayRecords = pgView("marketing_site_day_records", {
  id: text("id"),
  day: date("day"),
  channel: text("channel"),
  campaign: text("campaign"),
  visits: integer("visits"),
  firstTouches: integer("first_touches"),
  forms: integer("forms"),
  bookings: integer("bookings"),
  watchPlays: integer("watch_plays"),
  calls: integer("calls"),
  paid: integer("paid"),
  age: text("age"),
}).as(sql`
  select concat_ws('/', day, channel, campaign) id, day, channel::text channel,
    nullif(campaign, '')::text campaign, visits, first_touches, forms, bookings, watch_plays,
    calls, paid,
    case when day > current_date - 7 then 'week'
      when day > current_date - 30 then 'month' else 'earlier' end age
  from site_days`);

/**
 * Each `/go/` link's day (`marketing.link_day`, designs/2026-10-07-content-analytics.md): its
 * visitors, then forms, calls and clients won by first and by last touch, revenue in USD. A
 * post's own link names it (`content` = its draft's first 8); `post` is its record id.
 */
export const marketingLinkDayRecords = pgView("marketing_link_day_records", {
  id: text("id"),
  day: date("day"),
  source: text("source"),
  campaign: text("campaign"),
  content: text("content"),
  post: text("post"),
  postTitle: text("post_title"),
  clicks: integer("clicks"),
  hops: integer("hops"),
  formsFirst: integer("forms_first"),
  formsLast: integer("forms_last"),
  callsFirst: integer("calls_first"),
  callsLast: integer("calls_last"),
  wonFirst: integer("won_first"),
  wonLast: integer("won_last"),
  revenueFirst: doublePrecision("revenue_first"),
  revenueLast: doublePrecision("revenue_last"),
  currency: text("currency"),
  age: text("age"),
}).as(sql`
  select concat_ws('/', l.day, l.source, nullif(l.campaign, ''), nullif(l.content, '')) id, l.day,
    l.source::text source, nullif(l.campaign, '')::text campaign,
    nullif(l.content, '')::text "content", p.id post, p.title post_title, l.clicks, l.hops,
    l.forms_first, l.forms_last, l.calls_first, l.calls_last, l.won_first, l.won_last,
    l.revenue_first / 100.0 revenue_first, l.revenue_last / 100.0 revenue_last,
    'USD'::text currency,
    case when l.day > current_date - 7 then 'week'
      when l.day > current_date - 30 then 'month' else 'earlier' end age
  from link_days l
  left join lateral (select concat_ws('/', d.idea_id, d.platform, d.id) id,
      coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title
    from content_drafts d where l.content <> '' and left(d.id::text, 8) = l.content
    limit 1) p on true`);

/**
 * Each channel's funnel (`marketing.funnel`) over the last 30 days, 90 days and all time: new
 * visitors, then forms, calls booked and engagements paid, all under first touch.
 */
export const marketingFunnelRecords = pgView("marketing_funnel_records", {
  id: text("id"),
  window: text("window"),
  channel: text("channel"),
  visitors: integer("visitors"),
  forms: integer("forms"),
  calls: integer("calls"),
  paid: integer("paid"),
}).as(sql`
  select w.name || '/' || d.channel id, w.name "window", d.channel::text channel,
    sum(d.first_touches)::int visitors, sum(d.forms)::int forms, sum(d.calls)::int calls,
    sum(d.paid)::int paid
  from site_days d
  join (values ('30d', 30), ('90d', 90), ('all', 100000)) w(name, days)
    on d.day > current_date - w.days
  group by w.name, d.channel`);

/**
 * Each page's heatmap (`marketing.heat`) per width bucket, over the last 7 and 30 days: views
 * (everyone reaches the top band), clicks and rage clicks.
 */
export const marketingHeatRecords = pgView("marketing_heat_records", {
  id: text("id"),
  window: text("window"),
  page: text("page"),
  width: text("width"),
  views: integer("views"),
  clicks: integer("clicks"),
  rage: integer("rage"),
}).as(sql`
  select w.name || ':' || x.width || ':' || x.page id, w.name "window", x.page::text page,
    x.width::text width, sum(x.views)::int views, sum(x.clicks)::int clicks, sum(x.rage)::int rage
  from (
    select day, page, width, coalesce(s.views, 0) views, coalesce(h.clicks, 0) clicks,
      coalesce(h.rage, 0) rage
    from (select day, page, width, views from scroll_days where band = 0) s
    full join (select day, page, width, sum(clicks) clicks, sum(rage) rage from heat_days
      group by day, page, width) h using (day, page, width)
  ) x
  join (values ('7d', 7), ('30d', 30)) w(name, days) on x.day > current_date - w.days
  group by w.name, x.page, x.width`);

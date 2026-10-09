/**
 * Sites (designs/2026-10-07-sites.md). Main database only, like `hooks`: `client` null is Wren's.
 *
 * - `site_pages`: one row per page we run, a data page (rendered from its versions) or a code
 *   page (registered by its URL).
 * - `site_page_versions`: a data page's copy, one row per save, never overwritten.
 * - `site_events`: what the tracker saw, one row per event. Not audited: high volume.
 * - `site_forms`: every form sent, kept whole, and whether it entered the door.
 * - `site_form_defs`: hosted forms (designs/2026-10-07-forms-and-pay.md), each a spec of fields
 *   served at `/o/f/<slug>` and usable as a page's form section.
 * - `site_splits` and `site_split_arms`: a page's A/B split at the edge, each arm a live page of
 *   the same owner with its weight. Events and forms that came through a split name it.
 * - `site_hops`: each click on a client's `/go/` link (bots left out), with the utm it carried.
 * - `site_links`: tracked `/go/` links made in the portal, each to one page, with its utm.
 */
import { clients } from "@wren/core/clients";
import { hooks } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { FormSpec } from "./forms.js";
import {
  ARM_LABELS,
  CHANNELS,
  EVENT_NAMES,
  FORM_ARMS,
  FORM_SPLIT_STATES,
  type FormArm,
  type FormSplitState,
  PAGE_KINDS,
  PAGE_SOURCES,
  PAGE_STAGES,
  PAGE_STATUSES,
  SPLIT_GOALS,
  SPLIT_STATES,
  type SplitGoal,
  type SplitState,
  VERSION_ORIGINS,
} from "./model.js";
import type { Content } from "./templates/types.js";

export const sitePages = pgTable(
  "site_pages",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose page; null is Wren's. */
    client: varchar("client", { length: 40 }),
    slug: varchar("slug", { length: 80 }).notNull(),
    /** Its name in the list: "Audit, cost angle". */
    title: varchar("title", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 12 }).notNull(),
    source: varchar("source", { length: 8 }).notNull(),
    /** A code page's address. A data page's comes from its owner's host and slug. */
    url: text("url"),
    /** Where a code page's source is: a lander repo path or a standalone dir. */
    repoPath: text("repo_path"),
    /** A data page's template. */
    template: varchar("template", { length: 16 }),
    offer: varchar("offer", { length: 64 }),
    angle: varchar("angle", { length: 120 }),
    audience: varchar("audience", { length: 120 }),
    /** The page it was copied from, as a variant. */
    variantOf: uuid("variant_of"),
    stage: varchar("stage", { length: 8 }).notNull().default("convert"),
    status: varchar("status", { length: 8 }).notNull().default("draft"),
    liveVersion: integer("live_version"),
    draftVersion: integer("draft_version"),
    /** The version asked to go live, waiting in To approve. */
    waitingVersion: integer("waiting_version"),
    waitingBy: text("waiting_by"),
    waitingAt: timestamp("waiting_at", { withTimezone: true }),
    /** Asked to come down (a stopped split's B to E), waiting in To approve like a version. */
    retireBy: text("retire_by"),
    retireAt: timestamp("retire_at", { withTimezone: true }),
    /** Opens the newest draft at `/o/__preview/<id>?t=<it>`; new on every save. */
    previewToken: varchar("preview_token", { length: 43 }).notNull(),
    /** The door its forms enter; null takes the owner's site door. */
    hook: uuid("hook"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_pages" }),
    uniqueIndex("uq_site_pages_slug").on(sql`coalesce(${t.client}, '')`, t.slug),
    uniqueIndex("uq_site_pages_url").on(t.url).where(sql`${t.url} is not null`),
    index("ix_site_pages_client").on(t.client),
    index("ix_site_pages_offer").on(t.offer),
    index("ix_site_pages_variant_of").on(t.variantOf),
    index("ix_site_pages_hook").on(t.hook),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_pages_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.variantOf],
      foreignColumns: [t.id],
      name: "fk_site_pages_variant_of",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.hook],
      foreignColumns: [hooks.id],
      name: "fk_site_pages_hook",
    }).onDelete("set null"),
    oneOf("ck_site_pages_kind", t.kind, PAGE_KINDS),
    oneOf("ck_site_pages_source", t.source, PAGE_SOURCES),
    oneOf("ck_site_pages_stage", t.stage, PAGE_STAGES),
    oneOf("ck_site_pages_status", t.status, PAGE_STATUSES),
  ],
);
export type SitePage = typeof sitePages.$inferSelect;

export const sitePageVersions = pgTable(
  "site_page_versions",
  {
    page: uuid("page").notNull(),
    number: integer("number").notNull(),
    content: jsonb("content").$type<Content>().notNull(),
    origin: varchar("origin", { length: 8 }).notNull(),
    why: text("why"),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.page, t.number], name: "pk_site_page_versions" }),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_page_versions_page",
    }).onDelete("cascade"),
    oneOf("ck_site_page_versions_origin", t.origin, VERSION_ORIGINS),
  ],
);
export type SitePageVersion = typeof sitePageVersions.$inferSelect;

/**
 * A page's split: its address serves one of its arms per visitor, by weight, sticky by a cookie
 * holding the arm. At most one running (or waiting to ship) per page.
 */
export const siteSplits = pgTable(
  "site_splits",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose; null is Wren's. Always the page's owner. */
    client: varchar("client", { length: 40 }),
    /** The page whose address is split: arm A. */
    page: uuid("page").notNull(),
    state: varchar("state", { length: 10 }).$type<SplitState>().notNull().default("running"),
    goal: varchar("goal", { length: 8 }).$type<SplitGoal>().notNull().default("forms"),
    /** The arm asked to become the page, and the version on A that carries its copy. */
    winner: varchar("winner", { length: 2 }),
    shipVersion: integer("ship_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    startedBy: text("started_by").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_splits" }),
    uniqueIndex("uq_site_splits_live").on(t.page).where(sql`${t.state} in ('running', 'shipping')`),
    index("ix_site_splits_client").on(t.client),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_splits_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_splits_page",
    }).onDelete("cascade"),
    oneOf("ck_site_splits_state", t.state, SPLIT_STATES),
    oneOf("ck_site_splits_goal", t.goal, SPLIT_GOALS),
  ],
);
export type SiteSplit = typeof siteSplits.$inferSelect;

/** One arm of a split: a live page and its share, as a whole-number weight. */
export const siteSplitArms = pgTable(
  "site_split_arms",
  {
    split: uuid("split").notNull(),
    label: varchar("label", { length: 2 }).notNull(),
    page: uuid("page").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.split, t.label], name: "pk_site_split_arms" }),
    uniqueIndex("uq_site_split_arms_page").on(t.split, t.page),
    index("ix_site_split_arms_page").on(t.page),
    foreignKey({
      columns: [t.split],
      foreignColumns: [siteSplits.id],
      name: "fk_site_split_arms_split",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_split_arms_page",
    }).onDelete("cascade"),
    oneOf("ck_site_split_arms_label", t.label, ARM_LABELS),
    check("ck_site_split_arms_weight", sql`${t.weight} between 1 and 100`),
  ],
);
export type SiteSplitArm = typeof siteSplitArms.$inferSelect;

export const siteFormDefs = pgTable(
  "site_form_defs",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose form; null is Wren's. */
    client: varchar("client", { length: 40 }),
    slug: varchar("slug", { length: 80 }).notNull(),
    /** Its name in the list: "Quote request". */
    name: varchar("name", { length: 200 }).notNull(),
    status: varchar("status", { length: 8 }).notNull().default("draft"),
    spec: jsonb("spec").$type<FormSpec>().notNull(),
    /** The door its submits enter; null takes the owner's site door. */
    hook: uuid("hook"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_form_defs" }),
    uniqueIndex("uq_site_form_defs_slug").on(sql`coalesce(${t.client}, '')`, t.slug),
    index("ix_site_form_defs_client").on(t.client),
    index("ix_site_form_defs_hook").on(t.hook),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_form_defs_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.hook],
      foreignColumns: [hooks.id],
      name: "fk_site_form_defs_hook",
    }).onDelete("set null"),
    oneOf("ck_site_form_defs_status", t.status, PAGE_STATUSES),
  ],
);
export type SiteFormDef = typeof siteFormDefs.$inferSelect;

/**
 * A form's A/B split (designs/2026-10-07-forms-and-pay.md, "A/B per form"): its address serves
 * the form (A) or `b` by weight, sticky by the `wab` cookie. One running per form. Kept when it
 * ends: a submit from B is checked against `b` even after.
 */
export const siteFormSplits = pgTable(
  "site_form_splits",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose; null is Wren's. Always the form's owner. */
    client: varchar("client", { length: 40 }),
    form: uuid("form").notNull(),
    state: varchar("state", { length: 8 }).$type<FormSplitState>().notNull().default("running"),
    /** B's spec: A's copied at the start, then edited. */
    b: jsonb("b").$type<FormSpec>().notNull(),
    /** B's share of new visitors, 1 to 99; A gets the rest. */
    weight: integer("weight").notNull().default(50),
    /** The arm kept when it ended: B when shipped, A when stopped. */
    winner: varchar("winner", { length: 1 }).$type<FormArm>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    startedBy: text("started_by").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_form_splits" }),
    uniqueIndex("uq_site_form_splits_running").on(t.form).where(sql`${t.state} = 'running'`),
    index("ix_site_form_splits_form").on(t.form),
    index("ix_site_form_splits_client").on(t.client),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_form_splits_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.form],
      foreignColumns: [siteFormDefs.id],
      name: "fk_site_form_splits_form",
    }).onDelete("cascade"),
    oneOf("ck_site_form_splits_state", t.state, FORM_SPLIT_STATES),
    oneOf("ck_site_form_splits_winner", t.winner, FORM_ARMS),
    check("ck_site_form_splits_weight", sql`${t.weight} between 1 and 99`),
    check("ck_site_form_splits_ended", sql`(${t.state} = 'running') = (${t.endedAt} is null)`),
  ],
);
export type SiteFormSplit = typeof siteFormSplits.$inferSelect;

export const siteEvents = pgTable(
  "site_events",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    /** The page it happened on; null on a hosted form's own page. */
    page: uuid("page"),
    /** The hosted form it counts for: its page, or a page's form section. */
    form: uuid("form"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** The split that served it, when one did: counted for the arm whose page this is. */
    split: uuid("split"),
    /** Random per page load: events of one view share it. */
    view: varchar("view", { length: 36 }).notNull(),
    name: varchar("name", { length: 8 }).notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    source: varchar("source", { length: 120 }),
    medium: varchar("medium", { length: 120 }),
    campaign: varchar("campaign", { length: 120 }),
    content: varchar("content", { length: 120 }),
    ref: varchar("ref", { length: 200 }),
    width: integer("width"),
    /** On a `step`: the hosted form's step reached, 2 and on. */
    step: smallint("step"),
    /** The form split that served it, and the arm. */
    formSplit: uuid("form_split"),
    arm: varchar("arm", { length: 1 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_events" }),
    index("ix_site_events_page_at").on(t.page, t.at),
    index("ix_site_events_form_at").on(t.form, t.at),
    index("ix_site_events_split").on(t.split).where(sql`${t.split} is not null`),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_events_page",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.form],
      foreignColumns: [siteFormDefs.id],
      name: "fk_site_events_form",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.split],
      foreignColumns: [siteSplits.id],
      name: "fk_site_events_split",
    }).onDelete("set null"),
    check("ck_site_events_where", sql`${t.page} is not null or ${t.form} is not null`),
    index("ix_site_events_form_split").on(t.formSplit).where(sql`${t.formSplit} is not null`),
    foreignKey({
      columns: [t.formSplit],
      foreignColumns: [siteFormSplits.id],
      name: "fk_site_events_form_split",
    }).onDelete("set null"),
    oneOf("ck_site_events_arm", t.arm, FORM_ARMS),
    check(
      "ck_site_events_step",
      sql`(${t.name} = 'step') = (${t.step} is not null) and (${t.step} is null or ${t.step} between 2 and 10)`,
    ),
    oneOf("ck_site_events_name", t.name, EVENT_NAMES),
    oneOf("ck_site_events_channel", t.channel, CHANNELS),
  ],
);
export type SiteEvent = typeof siteEvents.$inferSelect;

/** The consent a submit ticked: the words it showed and their version (`consentVersion`). */
export interface FormConsent {
  text: string;
  version: string;
}

/** The touch a form came with: the utm and referrer the visit arrived on. */
export interface FormTouch {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  ref?: string | null;
}

export const siteForms = pgTable(
  "site_forms",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** The page it was sent from; null from a hosted form's own page. */
    page: uuid("page"),
    /** The hosted form it filled; null for a page's default form. */
    form: uuid("form"),
    /** The split that served its page, when one did. */
    split: uuid("split"),
    /** The form split that served it, and the arm whose spec checked it. */
    formSplit: uuid("form_split"),
    arm: varchar("arm", { length: 1 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull(),
    /** The text consent it ticked, with the words shown; null when it didn't. */
    consent: jsonb("consent").$type<FormConsent>(),
    /** The `wv` visitor cookie, when the browser sent one (Wren's own host). */
    visitor: varchar("visitor", { length: 64 }),
    /** Turnstile: `yes` passed, `off` not set up where it came in. */
    human: varchar("human", { length: 4 }),
    touch: jsonb("touch").$type<FormTouch>().notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    /** Sent to the door; false with `why` when it had none or it refused. */
    entered: boolean("entered").notNull().default(false),
    why: text("why"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_forms" }),
    index("ix_site_forms_page_at").on(t.page, t.at),
    index("ix_site_forms_form_at").on(t.form, t.at),
    index("ix_site_forms_split").on(t.split).where(sql`${t.split} is not null`),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_forms_page",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.form],
      foreignColumns: [siteFormDefs.id],
      name: "fk_site_forms_form",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.split],
      foreignColumns: [siteSplits.id],
      name: "fk_site_forms_split",
    }).onDelete("set null"),
    check("ck_site_forms_where", sql`${t.page} is not null or ${t.form} is not null`),
    index("ix_site_forms_form_split").on(t.formSplit).where(sql`${t.formSplit} is not null`),
    foreignKey({
      columns: [t.formSplit],
      foreignColumns: [siteFormSplits.id],
      name: "fk_site_forms_form_split",
    }).onDelete("set null"),
    oneOf("ck_site_forms_arm", t.arm, FORM_ARMS),
    oneOf("ck_site_forms_human", t.human, ["yes", "off"]),
    oneOf("ck_site_forms_channel", t.channel, CHANNELS),
  ],
);
export type SiteForm = typeof siteForms.$inferSelect;

/**
 * A click on a client's `/go/<channel>/<campaign>/<content>` link, counted at its host's edge
 * before the hop to the page with its utm. `content` is the post or ad id. Bots aren't counted.
 * Not audited (high volume), like `site_events`.
 */
export const siteHops = pgTable(
  "site_hops",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    /** The host's client; null is Wren's (its `/go/` is the lander's today). */
    client: varchar("client", { length: 40 }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** The short name in the link: `ads`, `ig`, `sms`. */
    link: varchar("link", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    source: varchar("source", { length: 120 }),
    medium: varchar("medium", { length: 120 }),
    campaign: varchar("campaign", { length: 120 }),
    content: varchar("content", { length: 120 }),
    /** Where it sent them, a path on the same host. */
    to: varchar("to", { length: 200 }).notNull(),
    /** The page that path is, when it's one of the owner's. */
    page: uuid("page"),
    ref: varchar("ref", { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_hops" }),
    index("ix_site_hops_client_at").on(t.client, t.at),
    index("ix_site_hops_page_at").on(t.page, t.at),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_hops_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_hops_page",
    }).onDelete("set null"),
    oneOf("ck_site_hops_channel", t.channel, CHANNELS),
  ],
);
export type SiteHop = typeof siteHops.$inferSelect;

/**
 * A tracked link made in the portal: `/go/<link>/<campaign>[/<content>]?to=/o/<slug>` on its
 * owner's host (Wren's: the lander's `/go/`). Its hits are read off `site_hops` and the page's
 * events with the same utm. One row per owner, page and utm.
 */
export const siteLinks = pgTable(
  "site_links",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose; null is Wren's. Always the page's owner. */
    client: varchar("client", { length: 40 }),
    page: uuid("page").notNull(),
    /** The short name: `ads`, `ig`, `sms`. */
    link: varchar("link", { length: 80 }).notNull(),
    /** The utm it lands with: the short name's source and medium, campaign, the post or ad id. */
    source: varchar("source", { length: 120 }).notNull(),
    medium: varchar("medium", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 10 }).notNull(),
    campaign: varchar("campaign", { length: 80 }).notNull(),
    content: varchar("content", { length: 80 }),
    /** What the team calls it: "Spring ad, roof photo". */
    name: varchar("name", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_site_links" }),
    uniqueIndex("uq_site_links_utm").on(
      sql`coalesce(${t.client}, '')`,
      t.page,
      t.link,
      t.campaign,
      sql`coalesce(${t.content}, '')`,
    ),
    index("ix_site_links_client").on(t.client),
    index("ix_site_links_page").on(t.page),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_site_links_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.page],
      foreignColumns: [sitePages.id],
      name: "fk_site_links_page",
    }).onDelete("cascade"),
    oneOf("ck_site_links_channel", t.channel, CHANNELS),
  ],
);
export type SiteLink = typeof siteLinks.$inferSelect;

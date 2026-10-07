/**
 * The template store as records (designs/2026-10-06-edits-claude-templates.md, 3): templates,
 * their versions, each variant's numbers, and the sequences and steps that send them. Read only;
 * the Library draws them (4). Numbers come from `template_stats`.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  actor,
  date,
  defineRecord,
  named,
  number,
  prose,
  type RecordType,
  rate,
  type State,
  status,
  text,
} from "./records.js";
import { TEMPLATE_EDITS, templateDetail } from "./template-edits.js";
import type { Workflow } from "./workflows.js";

const KIND: Record<string, State> = {
  email: { label: "Email", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
  dm: { label: "DM", tone: "neutral" },
  post: { label: "Post", tone: "neutral" },
  prompt: { label: "Prompt", tone: "neutral" },
};
/** `TemplateStatus`: waiting on a yes, Wren's default, a newer default unused, its own, nothing. */
const STATUS: Record<string, State> = {
  waiting: { label: "Waiting approval", tone: "warn" },
  default: { label: "Default", tone: "neutral" },
  updated: { label: "Default updated", tone: "warn" },
  edited: { label: "Edited", tone: "good" },
  empty: { label: "Empty", tone: "neutral" },
};
const STATE: Record<string, State> = {
  live: { label: "Live", tone: "good" },
  waiting: { label: "Waiting", tone: "warn" },
  draft: { label: "Draft", tone: "warn" },
  kept: { label: "Kept", tone: "neutral" },
};

const ORIGIN: Record<string, State> = {
  default: { label: "Default", tone: "neutral" },
  edit: { label: "Edit", tone: "neutral" },
  restore: { label: "Restore", tone: "neutral" },
  ai: { label: "AI", tone: "neutral" },
  import: { label: "Import", tone: "neutral" },
};

/** The version that goes out for template `t`: its own live one, else the newest default it follows. */
export const LIVE_ID = sql.raw(`coalesce(t.live_version_id, CASE WHEN t.follows_default THEN (
  SELECT d.id FROM template_versions d WHERE d.template_id = t.id AND d.origin = 'default'
  ORDER BY d.number DESC LIMIT 1) END)`);

/** A template's status as SQL, the same rules as `statusOf`. */
const STATUS_SQL = sql.raw(`CASE WHEN t.waiting_version_id IS NOT NULL THEN 'waiting'
  WHEN t.follows_default THEN CASE WHEN lv.id IS NULL THEN 'empty' ELSE 'default' END
  WHEN lv.id IS NULL THEN 'empty'
  WHEN (SELECT max(d.number) FROM template_versions d
    WHERE d.template_id = t.id AND d.origin = 'default') > lv.number THEN 'updated'
  ELSE 'edited' END`);

const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Record<string, unknown>[];

/** Each template's numbers over all its versions: one row per kind, system and name. */
const TOTALS = sql`
  SELECT kind, system, template, sum(sends)::int sends, sum(replies)::int replies,
    sum(booked)::int booked, max(last_sent) last_sent
  FROM template_stats GROUP BY 1, 2, 3`;

export const templateRecord = defineRecord({
  id: "templates.template",
  app: "library",
  channel: null,
  name: { one: "template", many: "templates" },
  rows: (db) =>
    rowsOf(
      db,
      sql`
      WITH totals AS (${TOTALS})
      SELECT t.id::text id, t.kind, t.system, t.name, t.folder, ${STATUS_SQL} status,
        lv.number live, dv.number draft, t.waiting_by, t.why,
        coalesce(dv.source, lv.source, '') words,
        (SELECT count(*)::int FROM template_versions v WHERE v.template_id = t.id) versions,
        coalesce(s.sends, 0) sends, coalesce(s.replies, 0) replies, s.booked, s.last_sent,
        t.updated_at
      FROM templates t
      LEFT JOIN template_versions lv ON lv.id = ${LIVE_ID}
      LEFT JOIN template_versions dv ON dv.id = t.draft_version_id
      LEFT JOIN totals s ON s.kind = t.kind AND s.system = t.system AND s.template = t.name
      ORDER BY t.folder, t.name`,
    ),
  key: "id",
  title: "name",
  subtitle: "system",
  fields: {
    name: text("Template"),
    kind: status(KIND, "Channel"),
    system: named("Whose"),
    folder: text("Folder"),
    status: status(STATUS),
    live: number("Live"),
    draft: number("Draft"),
    waitingBy: actor("Asked by"),
    why: text("Why"),
    versions: number(),
    sends: number(),
    replies: number(),
    replyRate: rate("sends", "Replied", { from: "replies" }),
    booked: number(),
    lastSent: date("Last sent"),
    updatedAt: date("Updated"),
    words: prose("Words"),
  },
  views: [
    { id: "all", label: "All", sort: "name" },
    { id: "waiting", label: "Waiting approval", where: { status: "waiting" }, sort: "-updatedAt" },
    { id: "updated", label: "Default updated", where: { status: "updated" }, sort: "name" },
    { id: "prompts", label: "Prompts", where: { kind: "prompt" }, sort: "name" },
  ],
  related: [
    { record: "templates.version", by: "template_id" },
    { record: "templates.variant", by: "template_id" },
    { record: "templates.step", by: "template_id" },
  ],
  // The Library's page: words with a sample, slots, variants, versions and campaigns.
  load: templateDetail,
  // Save keeps a draft (`template-edits.ts`); publishing is the templates service's.
  edits: TEMPLATE_EDITS,
});

export const versionRecord = defineRecord({
  id: "templates.version",
  app: "library",
  channel: null,
  name: { one: "version", many: "versions" },
  rows: (db) =>
    rowsOf(
      db,
      sql`
      SELECT v.id::text id, v.template_id::text template_id, t.kind, t.system, t.name,
        v.number, v.version, v.source, v.origin, v.why,
        CASE WHEN v.id = ${LIVE_ID} THEN 'live' WHEN t.waiting_version_id = v.id THEN 'waiting'
          WHEN t.draft_version_id = v.id THEN 'draft' ELSE 'kept' END state,
        v.created_by, v.created_at, v.published_by, v.published_at
      FROM template_versions v JOIN templates t ON t.id = v.template_id
      ORDER BY v.id DESC`,
    ),
  key: "id",
  title: "number",
  subtitle: "name",
  fields: {
    number: number("Version"),
    name: text("Template"),
    kind: status(KIND, "Channel"),
    system: named("Whose"),
    state: status(STATE),
    origin: status(ORIGIN, "From"),
    why: text("Why"),
    version: text("Hash"),
    source: prose("Words"),
    publishedAt: date("Published"),
    publishedBy: actor("Published by"),
    createdBy: actor("Saved by"),
    createdAt: date("Saved"),
  },
  views: [
    { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
    { id: "live", label: "Live", where: { state: "live" }, sort: "name" },
  ],
  related: [{ record: "templates.variant", by: "version_id" }],
});

export const variantRecord = defineRecord({
  id: "templates.variant",
  app: "library",
  channel: null,
  name: { one: "variant", many: "variants" },
  rows: (db) =>
    rowsOf(
      db,
      sql`
      SELECT md5(concat_ws(chr(31), s.kind, s.system, s.template, s.version, s.picks::text)) id,
        s.template_id::text template_id, v.id::text version_id, s.kind, s.system, s.template,
        s.version, coalesce(s.picks::text, '{}') picks, s.sends::int sends, s.replies::int replies,
        s.booked::int booked, s.last_sent
      FROM template_stats s
      LEFT JOIN LATERAL (SELECT x.id FROM template_versions x
        WHERE x.template_id = s.template_id AND x.version = s.version
        ORDER BY x.number DESC LIMIT 1) v ON true
      ORDER BY s.last_sent DESC NULLS LAST`,
    ),
  key: "id",
  title: "picks",
  subtitle: "template",
  fields: {
    picks: text("Variant"),
    template: text(),
    kind: status(KIND, "Channel"),
    system: named("Whose"),
    version: text(),
    sends: number(),
    replies: number(),
    replyRate: rate("sends", "Replied", { from: "replies" }),
    booked: number(),
    lastSent: date("Last sent"),
  },
  views: [{ id: "all", label: "All", sort: "-lastSent", at: "lastSent" }],
});

/** A sequence's steps from the cadence workflows: each node that names a template. */
const stepsOf = (workflows: readonly Workflow[]) =>
  workflows.flatMap((w) =>
    w.nodes.flatMap((n, i) => {
      if (!n.template) return [];
      const wait = w.wires.find((x) => x.to.startsWith(`${n.id}.`))?.wait ?? null;
      return [{ w, n, step: i + 1, wait, ref: n.template }];
    }),
  );

/** A step's template id and numbers, by kind, system and name. */
async function templateIds(db: Queryable) {
  const rows = await rowsOf(
    db,
    sql`
    WITH totals AS (${TOTALS})
    SELECT t.id::text id, t.kind, t.system, t.name, lv.number live_version, lv.version live_hash,
      coalesce(s.sends, 0) sends, coalesce(s.replies, 0) replies, s.booked
    FROM templates t
    LEFT JOIN template_versions lv ON lv.id = ${LIVE_ID}
    LEFT JOIN totals s ON s.kind = t.kind AND s.system = t.system AND s.template = t.name`,
  );
  return new Map(rows.map((r) => [`${r.kind}\0${r.system}\0${r.name}`, r]));
}

/** The sequences and their steps, from the workflows the worker runs. */
export function sequenceRecords(workflows: readonly Workflow[]): RecordType[] {
  const steps = stepsOf(workflows);
  const sequence = defineRecord({
    id: "templates.sequence",
    app: "library",
    channel: null,
    name: { one: "sequence", many: "sequences" },
    rows: async () =>
      [...new Map(steps.map((s) => [s.w.id, s.w])).values()].map((w) => {
        const own = steps.filter((s) => s.w === w);
        return {
          id: w.id,
          name: w.name,
          blurb: w.blurb,
          channel: own[0]?.ref.kind ?? null,
          system: own[0]?.ref.system ?? null,
          steps: own.length,
        };
      }),
    key: "id",
    title: "name",
    subtitle: "blurb",
    fields: {
      name: text("Sequence"),
      blurb: text("What it does"),
      channel: status(KIND),
      system: named("Whose"),
      steps: number(),
    },
    views: [{ id: "all", label: "All", sort: "name" }],
    related: [{ record: "templates.step", by: "sequence_id" }],
    // Its steps in order, each with its template's numbers and its live version's variants.
    load: async (db, id) => {
      const own = steps.filter((s) => s.w.id === id);
      if (!own.length) return null;
      const ids = await templateIds(db);
      const found = own.map((s) => ({
        s,
        t: ids.get(`${s.ref.kind}\0${s.ref.system}\0${s.ref.name}`),
      }));
      const known = found.flatMap(({ t }) => (t ? [Number(t.id)] : []));
      const picks = known.length
        ? await rowsOf(
            db,
            sql`
            SELECT s.template_id, s.picks, s.sends::int sends, s.replies::int replies
            FROM template_stats s JOIN templates t ON t.id = s.template_id
            JOIN template_versions v ON v.id = ${LIVE_ID} AND v.version = s.version
            WHERE s.template_id IN (${sql.join(
              known.map((k) => sql`${k}`),
              sql`, `,
            )})
            ORDER BY s.sends DESC`,
          )
        : [];
      return {
        steps: found.map(({ s, t }) => ({
          node: s.n.id,
          step: s.step,
          wait: s.wait,
          touch: s.n.uses ?? null,
          kind: s.ref.kind,
          system: s.ref.system,
          template: s.ref.name,
          templateId: t ? String(t.id) : null,
          liveVersion: t?.live_version == null ? null : Number(t.live_version),
          sends: Number(t?.sends ?? 0),
          replies: Number(t?.replies ?? 0),
          booked: t?.booked === null || t?.booked === undefined ? null : Number(t.booked),
          variants: t
            ? picks
                .filter((p) => String(p.template_id) === String(t.id))
                .map((p) => ({
                  picks: p.picks ?? {},
                  sends: Number(p.sends ?? 0),
                  replies: Number(p.replies ?? 0),
                }))
            : [],
        })),
      };
    },
  });
  const step = defineRecord({
    id: "templates.step",
    app: "library",
    channel: null,
    name: { one: "step", many: "steps" },
    rows: async (db) => {
      const ids = await templateIds(db);
      return steps.map(({ w, n, step, wait, ref }) => {
        const t = ids.get(`${ref.kind}\0${ref.system}\0${ref.name}`);
        return {
          id: `${w.id}/${n.id}`,
          sequence_id: w.id,
          sequence: w.name,
          step,
          wait,
          touch: n.uses ?? null,
          kind: ref.kind,
          system: ref.system,
          template: ref.name,
          template_id: t?.id ?? null,
          live_version: t?.live_version ?? null,
          sends: t?.sends ?? 0,
          replies: t?.replies ?? 0,
          booked: t?.booked ?? null,
        };
      });
    },
    key: "id",
    title: "template",
    subtitle: "sequence",
    fields: {
      sequence: text(),
      step: number(),
      wait: text("After"),
      template: text(),
      kind: status(KIND, "Channel"),
      system: named("Whose"),
      touch: text("Sent by"),
      liveVersion: number("Live"),
      sends: number(),
      replies: number(),
      replyRate: rate("sends", "Replied", { from: "replies" }),
      booked: number(),
    },
    views: [{ id: "all", label: "All", sort: "sequence" }],
  });
  return [sequence, step];
}

/** Every template record; the sequences come from the worker's workflows. */
export const templateRecords = (workflows: readonly Workflow[]): RecordType[] => [
  templateRecord,
  versionRecord,
  variantRecord,
  ...sequenceRecords(workflows),
];

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
  prompt: { label: "Prompt", tone: "neutral" },
};
const STATE: Record<string, State> = {
  live: { label: "Live", tone: "good" },
  draft: { label: "Draft", tone: "warn" },
  empty: { label: "Empty", tone: "neutral" },
};

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
      SELECT t.id::text id, t.kind, t.system, t.name,
        CASE WHEN t.draft_version_id IS NOT NULL THEN 'draft'
          WHEN t.live_version_id IS NOT NULL THEN 'live' ELSE 'empty' END state,
        lv.version live_version, dv.version draft_version,
        coalesce(dv.source, lv.source, '') words,
        (SELECT count(*)::int FROM template_versions v WHERE v.template_id = t.id) versions,
        coalesce(s.sends, 0) sends, coalesce(s.replies, 0) replies, s.booked, s.last_sent,
        t.updated_at
      FROM templates t
      LEFT JOIN template_versions lv ON lv.id = t.live_version_id
      LEFT JOIN template_versions dv ON dv.id = t.draft_version_id
      LEFT JOIN totals s ON s.kind = t.kind AND s.system = t.system AND s.template = t.name
      ORDER BY t.kind, t.system, t.name`,
    ),
  key: "id",
  title: "name",
  subtitle: "system",
  fields: {
    name: text("Template"),
    kind: status(KIND, "Channel"),
    system: text("Whose"),
    state: status(STATE),
    liveVersion: text("Live"),
    draftVersion: text("Draft"),
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
    { id: "drafts", label: "Drafts", where: { state: "draft" }, sort: "-updatedAt" },
    { id: "prompts", label: "Prompts", where: { kind: "prompt" }, sort: "name" },
  ],
  related: [
    { record: "templates.version", by: "template_id" },
    { record: "templates.variant", by: "template_id" },
    { record: "templates.step", by: "template_id" },
  ],
  // The Library's page: words with a sample, slots, variants, versions and campaigns.
  load: templateDetail,
  // Save keeps a draft; Publish is the same edit setting the live version (`template-edits.ts`).
  edits: TEMPLATE_EDITS,
  actions: ["templates.publish"],
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
        v.version, v.source,
        CASE WHEN t.live_version_id = v.id THEN 'live' WHEN t.draft_version_id = v.id THEN 'draft'
          ELSE 'kept' END state,
        v.created_by, v.created_at, v.published_by, v.published_at
      FROM template_versions v JOIN templates t ON t.id = v.template_id
      ORDER BY v.id DESC`,
    ),
  key: "id",
  title: "version",
  subtitle: "name",
  fields: {
    version: text(),
    name: text("Template"),
    kind: status(KIND, "Channel"),
    system: text("Whose"),
    state: status({ ...STATE, kept: { label: "Kept", tone: "neutral" } }),
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
      LEFT JOIN template_versions v ON v.template_id = s.template_id AND v.version = s.version
      ORDER BY s.last_sent DESC NULLS LAST`,
    ),
  key: "id",
  title: "picks",
  subtitle: "template",
  fields: {
    picks: text("Variant"),
    template: text(),
    kind: status(KIND, "Channel"),
    system: text("Whose"),
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
    SELECT t.id::text id, t.kind, t.system, t.name, lv.version live_version,
      coalesce(s.sends, 0) sends, coalesce(s.replies, 0) replies, s.booked
    FROM templates t
    LEFT JOIN template_versions lv ON lv.id = t.live_version_id
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
      system: text("Whose"),
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
            JOIN template_versions v ON v.id = t.live_version_id AND v.version = s.version
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
          liveVersion: (t?.live_version as string | null) ?? null,
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
      system: text("Whose"),
      touch: text("Sent by"),
      liveVersion: text("Live"),
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

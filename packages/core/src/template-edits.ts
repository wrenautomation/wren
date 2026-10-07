/**
 * What the Library shows and changes on a template (designs/2026-10-06-edits-claude-templates.md,
 * 4): its live and draft words with a sample render, its slots and variants with their numbers,
 * each version's numbers, the campaigns that sent it; and its edits. A save keeps the words as
 * the draft as a new numbered version; making one live goes through the templates service.
 * Publishing sends nothing. Email, posts and prompts only: a text or DM saves on its copy page,
 * which holds its slot's rules.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { RecordEdits, Values } from "./records.js";
import type { TemplateOrigin } from "./schema.js";
import {
  AuthoringError,
  checkSource,
  fieldKeys,
  optionText,
  parseKind,
  placeholderFacts,
  renderKind,
  type Template,
  type TemplateKind,
  variantPoints,
} from "./slots/index.js";
import { saveDraft, statusOf, type TemplateRef } from "./templates.js";

/** The made-up lead every sample render uses; the portal's Play walks the same one. */
export const SAMPLE_LEAD: Readonly<Record<string, string>> = {
  first_name: "Sam",
  last_name: "Rivera",
  name: "Sam Rivera",
  full_name: "Sam Rivera",
  company: "Northwind Staffing",
  company_name: "Northwind Staffing",
  company_short: "Northwind",
  firm: "Northwind Staffing",
  title: "Managing Partner",
  city: "Toronto",
  sender: "William",
  sender_name: "William",
  time: "2:30 PM",
  // The firm's newest post (`postFacts`), so an option that needs one renders.
  "post.title": "How we place travel nurses in two weeks",
  "post.kind": "video",
  "post.site": "YouTube",
  "post.url": "https://www.youtube.com/watch?v=example",
  "post.days": "12",
  // An earlier social touch with them (`touchFacts`), so an option that cites one renders.
  "touch.line": "your comment on our LinkedIn post",
  "touch.platform": "LinkedIn",
  "touch.when": "last week",
  "touch.days": "9",
  "touch.count": "2",
  // An offer's terms (`offerFacts`) and the links and times a send fills in.
  "offer.name": "Pilot",
  "offer.days": "30",
  "offer.goal": "10",
  "offer.slots": "3",
  "offer.page": "https://example.com/offer",
  "call.times": "Tuesday at 2 PM or Thursday at 10 AM",
  "call.booked": "Thursday at 10 AM",
  "link.book": "https://example.com/book",
  "link.page": "https://example.com",
  "link.watch": "https://example.com/watch",
  // Firm facts some niches quote.
  "company.aum": "$250M",
  "company.ind_clients": "120",
  // A video's slug in its footer's links (`videoSlug`).
  video: "12-how-id-fix-cold-email",
};

/** The kinds the Library saves; texts and DMs save where their slot's rules live. */
export const LIBRARY_EDITS: ReadonlySet<TemplateKind> = new Set<TemplateKind>([
  "email",
  "post",
  "prompt",
]);

/** The longest words a save takes: a long prompt, with room. */
export const WORDS_MAX = 60_000;

const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Record<string, unknown>[];

interface Words {
  number: number;
  version: string;
  source: string;
}

interface Head extends TemplateRef {
  id: number;
  folder: string;
  followsDefault: boolean;
  live: Words | null;
  draft: Words | null;
  waiting: (Words & { by: string | null }) | null;
  newestDefault: number | null;
}

/** A template by its row id, with its live, draft and waiting words. */
async function headOf(db: Queryable, id: string): Promise<Head | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const [r] = await rowsOf(
    db,
    sql`
    SELECT t.id, t.kind, t.system, t.name, t.folder, t.follows_default, t.waiting_by,
      lv.number live_number, lv.version live_version, lv.source live_source,
      dv.number draft_number, dv.version draft_version, dv.source draft_source,
      wv.number waiting_number, wv.version waiting_version, wv.source waiting_source,
      (SELECT max(d.number) FROM template_versions d
        WHERE d.template_id = t.id AND d.origin = 'default') newest_default
    FROM templates t
    LEFT JOIN template_versions lv ON lv.id = coalesce(t.live_version_id, CASE WHEN t.follows_default
      THEN (SELECT d.id FROM template_versions d WHERE d.template_id = t.id AND d.origin = 'default'
        ORDER BY d.number DESC LIMIT 1) END)
    LEFT JOIN template_versions dv ON dv.id = t.draft_version_id
    LEFT JOIN template_versions wv ON wv.id = t.waiting_version_id
    WHERE t.id = ${Number(id)}`,
  );
  if (!r) return null;
  const words = (k: string): Words | null =>
    r[`${k}_version`]
      ? {
          number: Number(r[`${k}_number`]),
          version: String(r[`${k}_version`]),
          source: String(r[`${k}_source`] ?? ""),
        }
      : null;
  const waiting = words("waiting");
  return {
    id: Number(r.id),
    kind: r.kind as TemplateKind,
    system: String(r.system),
    name: String(r.name),
    folder: String(r.folder ?? ""),
    followsDefault: Boolean(r.follows_default),
    live: words("live"),
    draft: words("draft"),
    waiting: waiting ? { ...waiting, by: (r.waiting_by as string | null) ?? null } : null,
    newestDefault: r.newest_default == null ? null : Number(r.newest_default),
  };
}

/** The words with the made-up lead in them, or why they don't render. */
export function sampleOf(kind: TemplateKind, name: string, source: string) {
  try {
    const tpl = parseKind(kind, name, source);
    const out = renderKind(kind, tpl, factsFor(tpl), "sample");
    return { sample: { subject: out.subject, body: out.body }, problem: null };
  } catch (err) {
    return { sample: null, problem: err instanceof Error ? err.message : String(err) };
  }
}

/** Every fact the words name: the lead's where it has one, «key» for the rest. */
const factsFor = (tpl: Template) => ({ ...placeholderFacts(tpl), ...SAMPLE_LEAD });

/** A version's words as the detail shows them. */
const viewOf = (h: Head, v: Words | null) =>
  v ? { ...v, ...sampleOf(h.kind, h.name, v.source) } : null;

/** One `[[#name a | b]]` point: its options' words and their numbers on the live version. */
export interface VariantPoint {
  name: string;
  options: { text: string; sends: number; replies: number }[];
}

/** Each variant point in `tpl`, with sends and replies per option from `picks` rows. */
export function pointsOf(
  tpl: Template,
  rows: readonly { picks: unknown; sends: number; replies: number }[],
): VariantPoint[] {
  const blocks = [...(tpl.subject ?? []), ...tpl.body];
  return [...variantPoints(blocks)].map((p) => ({
    name: p.name,
    options: p.options.map((o, i) => {
      const on = rows.filter((r) => picksOf(r.picks)[p.name] === i);
      return {
        text: optionText(o),
        sends: on.reduce((t, r) => t + r.sends, 0),
        replies: on.reduce((t, r) => t + r.replies, 0),
      };
    }),
  }));
}

const picksOf = (picks: unknown): Record<string, number> => {
  const p = typeof picks === "string" ? safeJson(picks) : picks;
  return p && typeof p === "object" ? (p as Record<string, number>) : {};
};
const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** A template's detail for its page: words, samples, slots, variants, versions, campaigns. */
export async function templateDetail(db: Queryable, id: string) {
  const h = await headOf(db, id);
  if (!h) return null;
  const stats = (
    await rowsOf(
      db,
      sql`
      SELECT version, picks, sends::int sends, replies::int replies, booked::int booked, last_sent
      FROM template_stats WHERE template_id = ${h.id}`,
    )
  ).map((r) => ({
    version: String(r.version),
    picks: r.picks,
    sends: Number(r.sends ?? 0),
    replies: Number(r.replies ?? 0),
    booked: r.booked === null || r.booked === undefined ? null : Number(r.booked),
  }));
  const versions = (
    await rowsOf(
      db,
      sql`
      SELECT v.id, v.number, v.version, v.origin, v.why, v.created_by, v.created_at,
        v.published_by, v.published_at, o.number opened_from
      FROM template_versions v LEFT JOIN template_versions o ON o.id = v.opened_from
      WHERE v.template_id = ${h.id} ORDER BY v.number DESC`,
    )
  ).map((v) => {
    const own = stats.filter((s) => s.version === v.version);
    const sum = (k: "sends" | "replies") => own.reduce((t, s) => t + s[k], 0);
    const booked = own.some((s) => s.booked !== null)
      ? own.reduce((t, s) => t + (s.booked ?? 0), 0)
      : null;
    const number = Number(v.number);
    return {
      number,
      version: String(v.version),
      state: (h.live?.number === number
        ? "live"
        : h.waiting?.number === number
          ? "waiting"
          : h.draft?.number === number
            ? "draft"
            : "kept") as "live" | "waiting" | "draft" | "kept",
      origin: String(v.origin) as TemplateOrigin,
      why: (v.why as string | null) ?? null,
      openedFrom: v.opened_from == null ? null : Number(v.opened_from),
      by: (v.created_by as string | null) ?? null,
      at: v.created_at ? new Date(v.created_at as string).toISOString() : null,
      publishedBy: (v.published_by as string | null) ?? null,
      publishedAt: v.published_at ? new Date(v.published_at as string).toISOString() : null,
      sends: sum("sends"),
      replies: sum("replies"),
      booked,
    };
  });
  // The campaigns that sent it: an email's niche and sequence, from its sends.
  const campaigns =
    h.kind === "email"
      ? (
          await rowsOf(
            db,
            sql`
            SELECT e.niche, e.sequence_name, count(*)::int sends, max(m.sent_at) last_sent
            FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
            WHERE m.state = 'sent' AND m.template = ${h.name} AND e.niche = ${h.system}
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          )
        ).map((r) => ({
          campaign: String(r.niche),
          sequence: (r.sequence_name as string | null) ?? null,
          sends: Number(r.sends),
          lastSent: r.last_sent ? new Date(r.last_sent as string).toISOString() : null,
        }))
      : [];
  const shown = h.draft ?? h.live;
  let slots: string[] = [];
  let variants: VariantPoint[] = [];
  try {
    if (shown) {
      const tpl = parseKind(h.kind, h.name, shown.source);
      slots = fieldKeys(tpl);
      const on = h.live ? stats.filter((s) => s.version === h.live?.version) : [];
      variants = pointsOf(tpl, on);
    }
  } catch {
    // The sample says why it doesn't parse.
  }
  return {
    kind: h.kind,
    system: h.system,
    name: h.name,
    folder: h.folder,
    status: statusOf({
      followsDefault: h.followsDefault,
      live: h.live,
      waiting: h.waiting,
      newestDefault: h.newestDefault === null ? null : { number: h.newestDefault },
    }),
    followsDefault: h.followsDefault,
    newestDefault: h.newestDefault,
    editable: LIBRARY_EDITS.has(h.kind),
    live: viewOf(h, h.live),
    draft: viewOf(h, h.draft),
    waiting: h.waiting ? { ...viewOf(h, h.waiting), by: h.waiting.by } : null,
    slots,
    variants,
    versions,
    campaigns,
  };
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof templateDetail>>>;

const PATCH = z
  .object({ words: z.string().max(WORDS_MAX) })
  .partial()
  .strict();

/**
 * The words save as the draft, a new numbered version; History and Undo cover them. Making a
 * version live is not an edit: it goes through the templates service, which checks who may
 * and, for copy that sends, waits on a person's yes.
 */
export const TEMPLATE_EDITS: RecordEdits = {
  fields: ["words"],
  patch: PATCH,
  about:
    "the words of one outreach template or model prompt. Slots: {field|fallback}, " +
    "[[#name option a | option b]] variants, ((groups)) that drop when a field is empty, " +
    "<<prompt>> slots a model fills. Saving keeps a draft; Publish makes it live.",
  read: async (db, id) => {
    const h = await headOf(db, id);
    if (!h) return null;
    return { words: (h.draft ?? h.live)?.source ?? "" };
  },
  check: async (patch, _now, db, id) => {
    const h = await headOf(db, id);
    if (!h) return null;
    if (!LIBRARY_EDITS.has(h.kind))
      return "Texts and DMs save on their copy pages in Marketing, which hold each one's rules.";
    if (patch.words !== undefined) {
      try {
        if (!checkSource(h.kind, h.name, String(patch.words)))
          return "Empty words save nothing. To stop it sending, take it out of its sequence.";
      } catch (err) {
        if (err instanceof AuthoringError) return err.message;
        throw err;
      }
    }
    return null;
  },
  write: async (db, id, patch: Values, by) => {
    const h = await headOf(db, id);
    if (!h) throw new Error(`no template ${id}`);
    // Only the three keys: the store makes the row from what it's given.
    const ref: TemplateRef = { kind: h.kind, system: h.system, name: h.name };
    if (typeof patch.words === "string") await saveDraft(db, ref, patch.words, { by });
  },
  context: async (db, id) => {
    const d = await templateDetail(db, id);
    if (!d) return null;
    const lines = [
      `A ${d.kind} template, ${d.system}/${d.name}.`,
      d.slots.length ? `Its fields: ${d.slots.map((s) => `{${s}}`).join(" ")}.` : "",
      ...d.versions
        .filter((v) => v.sends)
        .slice(0, 5)
        .map(
          (v) =>
            `Version ${v.number} (${v.state}): ${v.sends} sent, ${v.replies} replied` +
            (v.booked !== null ? `, ${v.booked} booked` : "") +
            ".",
        ),
      ...d.variants.flatMap((p) =>
        p.options.map(
          (o) => `Variant ${p.name} "${o.text}": ${o.sends} sent, ${o.replies} replied.`,
        ),
      ),
    ];
    return lines.filter(Boolean).join("\n");
  },
};

/**
 * How each variant option did. Every message pins the option it got at each variant point
 * (`provenance.picks`, `v1` → option index). Picks are drawn independently, so one option's
 * rate against its siblings at the same point is a fair comparison. Counted per
 * template@version: an edit makes a new version and starts the count over.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { parseTemplate } from "../outreach/authoring.js";
import { optionText, variantPoints } from "../outreach/templates.js";

export interface VariantOutcome {
  readonly niche: string;
  readonly template: string;
  readonly version: string;
  /** The variant point's name (`v3`) and where it sits. */
  readonly variant: string;
  readonly inSubject: boolean;
  readonly option: number;
  /** The option's words, facts as `{name}`; null when the version's source is not on file. */
  readonly text: string | null;
  readonly sent: number;
  /** First fetch of the pixel at least 2 min after the send (tracked sends only). */
  readonly opened: number;
  readonly tracked: number;
  readonly replies: number;
  readonly interested: number;
}

/** Every option's text by variant name, and which names sit in the subject. */
export function variantTexts(name: string, source: string) {
  const tpl = parseTemplate(name, source);
  const texts = new Map<string, string[]>();
  const subject = new Set<string>();
  for (const p of variantPoints(tpl.subject ?? [])) subject.add(p.name);
  for (const p of variantPoints([...(tpl.subject ?? []), ...tpl.body]))
    texts.set(p.name, p.options.map(optionText));
  return { texts, subject };
}

export async function variantOutcomes(db: Queryable, niche?: string): Promise<VariantOutcome[]> {
  // Replies and human opens counted once per message, then joined: no per-row subqueries.
  const rows = (await db.execute(sql`
    WITH sent AS (
      SELECT m.id, e.niche, m.template, m.template_version, m.sent_at, m.open_token, m.provenance
      FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE m.state = 'sent' ${niche ? sql`AND e.niche = ${niche}` : sql``}
    ), replied AS (
      SELECT te.in_reply_to_message_id AS id, count(*) AS replies,
        count(*) FILTER (WHERE te.disposition IN ('interested', 'meeting_booked')) AS interested
      FROM thread_events te JOIN sent s ON s.id = te.in_reply_to_message_id
      WHERE te.kind = 'reply' GROUP BY 1
    ), opened AS (
      SELECT DISTINCT oe.message_id AS id
      FROM open_events oe JOIN sent s ON s.id = oe.message_id
      WHERE oe.seen_at - s.sent_at >= interval '2 minutes'
    )
    SELECT a.*, tv.source FROM (
      SELECT s.niche, s.template, s.template_version AS version, p.key AS variant,
        p.value::int AS option, count(*)::int AS sent,
        count(*) FILTER (WHERE s.open_token IS NOT NULL)::int AS tracked,
        count(o.id)::int AS opened,
        coalesce(sum(r.replies), 0)::int AS replies,
        coalesce(sum(r.interested), 0)::int AS interested
      FROM sent s
      LEFT JOIN replied r ON r.id = s.id
      LEFT JOIN opened o ON o.id = s.id
      CROSS JOIN LATERAL jsonb_each_text(s.provenance -> 'picks') p
      GROUP BY 1, 2, 3, 4, 5
    ) a
    LEFT JOIN template_versions tv
      ON tv.niche = a.niche AND tv.template = a.template AND tv.version = a.version
  `)) as Record<string, unknown>[];
  const parsed = new Map<string, ReturnType<typeof variantTexts> | null>();
  const out: VariantOutcome[] = rows.map((r) => {
    const key = `${r.niche}\0${r.template}\0${r.version}`;
    if (!parsed.has(key)) {
      try {
        parsed.set(key, r.source ? variantTexts(String(r.template), String(r.source)) : null);
      } catch {
        parsed.set(key, null);
      }
    }
    const t = parsed.get(key) ?? null;
    const variant = String(r.variant);
    const option = Number(r.option);
    return {
      niche: String(r.niche),
      template: String(r.template),
      version: String(r.version),
      variant,
      inSubject: t?.subject.has(variant) ?? false,
      option,
      text: t?.texts.get(variant)?.[option] ?? null,
      sent: Number(r.sent),
      tracked: Number(r.tracked),
      opened: Number(r.opened),
      replies: Number(r.replies),
      interested: Number(r.interested),
    };
  });
  // Template, then the variant in document order (v2 before v10), then option.
  const n = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  return out.sort(
    (a, b) =>
      a.niche.localeCompare(b.niche) ||
      a.template.localeCompare(b.template) ||
      a.version.localeCompare(b.version) ||
      n(a.variant) - n(b.variant) ||
      a.option - b.option,
  );
}

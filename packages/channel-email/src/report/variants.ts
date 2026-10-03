/**
 * How each variant option did. Every message pins the option it got at each variant point
 * (`provenance.picks`, `v1` → option index). Picks are drawn independently, so one option's
 * rate against its siblings at the same point is a fair comparison. Counted per
 * template@version: an edit makes a new version and starts the count over.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { parseTemplate } from "../outreach/authoring.js";
import type { Block, Option } from "../outreach/templates.js";

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

const optionText = (o: Option) =>
  o
    .map((b) => (b.kind === "text" ? b.text : `{${b.key}}`))
    .join("")
    .trim();

function* points(
  blocks: readonly Block[],
): Generator<{ name: string; options: readonly Option[] }> {
  for (const b of blocks) {
    if (b.kind === "variants") yield b;
    else if (b.kind === "group") yield* points(b.blocks);
  }
}

/** Every option's text by variant name, and which names sit in the subject. */
export function variantTexts(name: string, source: string) {
  const tpl = parseTemplate(name, source);
  const texts = new Map<string, string[]>();
  const subject = new Set<string>();
  for (const p of points(tpl.subject ?? [])) subject.add(p.name);
  for (const p of points([...(tpl.subject ?? []), ...tpl.body]))
    texts.set(p.name, p.options.map(optionText));
  return { texts, subject };
}

export async function variantOutcomes(db: Queryable, niche?: string): Promise<VariantOutcome[]> {
  const rows = (await db.execute(sql`
    WITH sent AS (
      SELECT m.id, e.niche, m.template, m.template_version, m.sent_at, m.open_token, m.provenance
      FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE m.state = 'sent' ${niche ? sql`AND e.niche = ${niche}` : sql``}
    ), per AS (
      SELECT s.id,
        EXISTS (SELECT 1 FROM open_events oe WHERE oe.message_id = s.id
                AND oe.seen_at - s.sent_at >= interval '2 minutes') AS opened,
        (SELECT count(*) FROM thread_events te WHERE te.in_reply_to_message_id = s.id
                AND te.kind = 'reply') AS replies,
        (SELECT count(*) FROM thread_events te WHERE te.in_reply_to_message_id = s.id
                AND te.kind = 'reply'
                AND te.disposition IN ('interested', 'meeting_booked')) AS interested
      FROM sent s
    )
    SELECT s.niche, s.template, s.template_version AS version, p.key AS variant,
      p.value::int AS option, count(*)::int AS sent,
      count(*) FILTER (WHERE s.open_token IS NOT NULL)::int AS tracked,
      count(*) FILTER (WHERE per.opened)::int AS opened,
      sum(per.replies)::int AS replies, sum(per.interested)::int AS interested,
      tv.source
    FROM sent s
    JOIN per ON per.id = s.id
    CROSS JOIN LATERAL jsonb_each_text(s.provenance -> 'picks') p
    LEFT JOIN template_versions tv
      ON tv.niche = s.niche AND tv.template = s.template AND tv.version = s.template_version
    GROUP BY s.niche, s.template, s.template_version, p.key, p.value, tv.source
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

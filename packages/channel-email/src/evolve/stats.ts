/**
 * An experiment's counts, per locus and allele. The unit is the recipient: an
 * enrollment counts once for each allele it was sent, and an outcome on its thread
 * credits every allele it was sent before that outcome, so a reply to the follow-up
 * still credits the opener's subject. Picks are option indexes per version, so each
 * version's source is parsed once to turn them into allele keys.
 */

import type { Queryable } from "@wren/db";
import type { AlleleCounts } from "@wren/experiments";
import { sql } from "drizzle-orm";
import { parseTemplate } from "../outreach/authoring.js";
import { alleleKey, variantPoints } from "../outreach/templates.js";

type Counts = { -readonly [K in keyof AlleleCounts]: AlleleCounts[K] };
/** locus → allele → counts. */
export type AlleleStats = Map<string, Map<string, AlleleCounts>>;

const zero = (): Counts => ({
  exposures: 0,
  replies: 0,
  interested: 0,
  booked: 0,
  opens: 0,
  tracked: 0,
  negatives: 0,
});

/** locus → allele key per option, for one version's source. */
export function alleleIndex(template: string, source: string): Map<string, string[]> {
  const tpl = parseTemplate(template, source);
  const out = new Map<string, string[]>();
  for (const p of variantPoints([...(tpl.subject ?? []), ...tpl.body])) {
    out.set(p.name, p.options.map(alleleKey));
  }
  return out;
}

export async function alleleStats(
  db: Queryable,
  niche: string,
  template: string,
): Promise<AlleleStats> {
  // Outcomes per enrollment as the latest time each happened: a send before it gets the credit.
  const rows = (await db.execute(sql`
    WITH sent AS (
      SELECT m.id, m.enrollment_id, m.template_version, m.sent_at,
        m.open_token IS NOT NULL AS tracked, m.provenance -> 'picks' AS picks
      FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.niche = ${niche} AND m.template = ${template} AND m.state = 'sent'
    ), thread AS (
      SELECT te.enrollment_id,
        max(te.received_at) FILTER (WHERE te.kind = 'reply') AS replied,
        max(te.received_at) FILTER (
          WHERE te.kind = 'reply' AND te.disposition IN ('interested', 'meeting_booked')) AS interested,
        max(te.received_at) FILTER (WHERE te.disposition = 'meeting_booked') AS booked,
        max(te.received_at) FILTER (
          WHERE te.kind IN ('unsubscribe', 'complaint') OR te.disposition = 'not_interested') AS negative
      FROM thread_events te WHERE te.enrollment_id IN (SELECT enrollment_id FROM sent)
      GROUP BY 1
    ), calls AS (
      SELECT ci.enrollment_id, max(ci.created_at) AS booked
      FROM call_invites ci
      WHERE ci.state IN ('booked', 'already_booked')
        AND ci.enrollment_id IN (SELECT enrollment_id FROM sent)
      GROUP BY 1
    ), opened AS (
      SELECT DISTINCT oe.message_id AS id
      FROM open_events oe JOIN sent s ON s.id = oe.message_id
      WHERE oe.seen_at - s.sent_at >= interval '2 minutes'
    )
    SELECT s.enrollment_id, s.template_version AS version, s.picks, s.tracked,
      o.id IS NOT NULL AS opened,
      coalesce(t.replied >= s.sent_at, false) AS replied,
      coalesce(t.interested >= s.sent_at, false) AS interested,
      coalesce(t.booked >= s.sent_at, false) OR coalesce(c.booked >= s.sent_at, false) AS booked,
      coalesce(t.negative >= s.sent_at, false) AS negative,
      tv.source
    FROM sent s
    LEFT JOIN thread t ON t.enrollment_id = s.enrollment_id
    LEFT JOIN calls c ON c.enrollment_id = s.enrollment_id
    LEFT JOIN opened o ON o.id = s.id
    LEFT JOIN template_versions tv
      ON tv.niche = ${niche} AND tv.template = ${template} AND tv.version = s.template_version
  `)) as unknown as {
    enrollment_id: number;
    version: string;
    picks: Record<string, number> | null;
    tracked: boolean;
    opened: boolean;
    replied: boolean;
    interested: boolean;
    booked: boolean;
    negative: boolean;
    source: string | null;
  }[];

  const versions = new Map<string, Map<string, string[]> | null>();
  // locus → allele → enrollment → what that recipient did, OR'd over its messages.
  const seen = new Map<string, Map<string, Map<number, Omit<Counts, "exposures">>>>();
  for (const r of rows) {
    if (!versions.has(r.version)) {
      let index: Map<string, string[]> | null = null;
      try {
        index = r.source ? alleleIndex(template, r.source) : null;
      } catch {
        index = null;
      }
      versions.set(r.version, index);
    }
    const index = versions.get(r.version);
    if (!index) continue;
    for (const [locus, option] of Object.entries(r.picks ?? {})) {
      const allele = index.get(locus)?.[Number(option)];
      if (allele === undefined) continue;
      const byAllele = seen.get(locus) ?? new Map();
      seen.set(locus, byAllele);
      const byEnrollment = byAllele.get(allele) ?? new Map();
      byAllele.set(allele, byEnrollment);
      const was = byEnrollment.get(r.enrollment_id);
      const bit = (now: boolean, before: number | undefined) => (now || before === 1 ? 1 : 0);
      byEnrollment.set(r.enrollment_id, {
        replies: bit(r.replied, was?.replies),
        interested: bit(r.interested, was?.interested),
        booked: bit(r.booked, was?.booked),
        opens: bit(r.tracked && r.opened, was?.opens),
        tracked: bit(r.tracked, was?.tracked),
        negatives: bit(r.negative, was?.negatives),
      });
    }
  }
  const out: AlleleStats = new Map();
  for (const [locus, byAllele] of seen) {
    const counts = new Map<string, AlleleCounts>();
    for (const [allele, byEnrollment] of byAllele) {
      const c = zero();
      for (const e of byEnrollment.values()) {
        c.exposures += 1;
        c.replies += e.replies;
        c.interested += e.interested;
        c.booked += e.booked;
        c.opens += e.opens;
        c.tracked += e.tracked;
        c.negatives += e.negatives;
      }
      counts.set(allele, c);
    }
    out.set(locus, counts);
  }
  return out;
}

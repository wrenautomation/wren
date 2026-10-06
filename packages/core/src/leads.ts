/**
 * One lead across channels (designs/2026-10-05-workflows.md, "One lead across channels"): the
 * person when we know them, else the firm. Every channel row already carries `company_id` and a
 * nullable `person_id` (`enrollments`, `sms_contacts`, `reach_contacts`), so the lead needs no id of
 * its own. Each channel guards itself (email's unique indexes, texts' busy firm); this adds the
 * other two. Raw SQL over the three tables, so core imports no channel.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export type LeadChannel = "email" | "text" | "dm";

export interface Lead {
  personId: number | null;
  companyId: number | null;
}

/** `person:<id>`, else `firm:<id>`; null when the row names neither. */
export const leadKey = (l: Lead): string | null =>
  l.personId !== null
    ? `person:${l.personId}`
    : l.companyId !== null
      ? `firm:${l.companyId}`
      : null;

/** A firm gets at most one first touch in this window, across channels. */
export const FIRST_TOUCH_GAP_MS = 86_400_000;

/**
 * Why `lead` can't start a `channel` sequence now, or null. Two rules over the other channels:
 * the lead is in one active sequence at a time, and its firm got no first touch in the last day.
 * A first touch is a text or DM enroll (their opener queues then) or a sent email opener.
 */
export async function leadRefusal(
  db: Queryable,
  lead: Lead,
  channel: LeadChannel,
  now: Date,
): Promise<string | null> {
  const busy = await activeElsewhere(db, lead, channel);
  if (busy) return busy;
  return lead.companyId === null ? null : firstTouchElsewhere(db, lead.companyId, channel, now);
}

/** The active sequence another channel holds this lead in, as a reason, or null. */
export async function activeElsewhere(
  db: Queryable,
  lead: Lead,
  channel: LeadChannel,
): Promise<string | null> {
  if (lead.personId === null && lead.companyId === null) return null;
  const match =
    lead.personId !== null
      ? sql`person_id = ${lead.personId}`
      : sql`company_id = ${lead.companyId} AND person_id IS NULL`;
  const arms = [
    channel !== "email" &&
      sql`SELECT 'email' AS channel, id FROM enrollments WHERE state = 'active' AND ${match}`,
    channel !== "text" &&
      sql`SELECT 'text' AS channel, id FROM sms_contacts WHERE state IN ('enrolled', 'replied') AND ${match}`,
    channel !== "dm" &&
      sql`SELECT 'dm' AS channel, id FROM reach_contacts WHERE state IN ('enrolled', 'connected', 'replied') AND ${match}`,
  ].filter((a) => a !== false);
  const [row] = (await db.execute(sql`${sql.join(arms, sql` UNION ALL `)} LIMIT 1`)) as unknown as {
    channel: LeadChannel;
    id: number;
  }[];
  return row ? `lead ${leadKey(lead)} is in an active ${row.channel} sequence (${row.id})` : null;
}

/** The firm's first touch on another channel inside FIRST_TOUCH_GAP_MS, as a reason, or null. */
export async function firstTouchElsewhere(
  db: Queryable,
  companyId: number,
  channel: LeadChannel,
  now: Date,
): Promise<string | null> {
  const since = new Date(now.getTime() - FIRST_TOUCH_GAP_MS).toISOString();
  const until = now.toISOString();
  const arms = [
    channel !== "email" &&
      sql`SELECT 'email' AS channel, m.sent_at AS at FROM messages m
          JOIN enrollments e ON e.id = m.enrollment_id
          WHERE e.company_id = ${companyId} AND m.step = 0 AND m.state = 'sent'
            AND m.sent_at > ${since}::timestamptz AND m.sent_at <= ${until}::timestamptz`,
    channel !== "text" &&
      sql`SELECT 'text' AS channel, enrolled_at AS at FROM sms_contacts
          WHERE company_id = ${companyId} AND enrolled_at > ${since}::timestamptz AND enrolled_at <= ${until}::timestamptz`,
    channel !== "dm" &&
      sql`SELECT 'dm' AS channel, enrolled_at AS at FROM reach_contacts
          WHERE company_id = ${companyId} AND enrolled_at > ${since}::timestamptz AND enrolled_at <= ${until}::timestamptz`,
  ].filter((a) => a !== false);
  const [row] = (await db.execute(
    sql`${sql.join(arms, sql` UNION ALL `)} ORDER BY at DESC LIMIT 1`,
  )) as unknown as { channel: LeadChannel; at: Date | string }[];
  if (!row) return null;
  const hours = Math.floor((now.getTime() - new Date(row.at).getTime()) / 3_600_000);
  return `firm ${companyId} got a first touch by ${row.channel} ${hours}h ago`;
}

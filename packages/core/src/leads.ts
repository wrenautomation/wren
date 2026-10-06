/**
 * One lead across channels (designs/2026-10-05-workflows.md, "One lead across channels"): the
 * person when we know them, else the firm. Every channel row already carries `company_id` and a
 * nullable `person_id` (`enrollments`, `sms_contacts`, `reach_contacts`), so the lead needs no id of
 * its own. Each channel guards itself (email's unique indexes, texts' busy firm); this adds the
 * other two. Reads the `lead_channels` view over the three tables, so core imports no channel.
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
  const [row] = (await db.execute(
    sql`SELECT channel, id FROM lead_channels WHERE active AND channel <> ${channel} AND ${match} LIMIT 1`,
  )) as unknown as {
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
  const [row] = (await db.execute(
    sql`SELECT channel, first_touch_at AS at FROM lead_channels
        WHERE company_id = ${companyId} AND channel <> ${channel}
          AND first_touch_at > ${since}::timestamptz AND first_touch_at <= ${until}::timestamptz
        ORDER BY at DESC LIMIT 1`,
  )) as unknown as { channel: LeadChannel; at: Date | string }[];
  if (!row) return null;
  const hours = Math.floor((now.getTime() - new Date(row.at).getTime()) / 3_600_000);
  return `firm ${companyId} got a first touch by ${row.channel} ${hours}h ago`;
}

/** The channel tables whose rows `linkPeople` fills. */
export type ContactTable = "sms_contacts" | "reach_contacts";

/**
 * Fill `person_id` on text or DM contacts that have none, and the firm when the contact has
 * none: the person whose address the contact's email is (`contact_candidates`), whose full name
 * it carries at its firm, or (a LinkedIn DM contact) whose `linkedin_url` is its handle. Only
 * when exactly one person fits and the firm agrees; a firm's main line has nothing to match and
 * stays firm-level. `ids` limits it to rows just written; without, it's the backfill. Returns
 * how many it linked.
 */
export async function linkPeople(
  db: Queryable,
  table: ContactTable,
  ids?: readonly number[],
): Promise<number> {
  if (ids?.length === 0) return 0;
  const t = sql.identifier(table);
  const open = sql`c.person_id IS NULL${
    ids
      ? sql` AND c.id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})`
      : sql``
  }`;
  const arms = [
    sql`SELECT c.id, p.id AS person_id FROM ${t} c
      JOIN people p ON p.company_id = c.company_id AND lower(p.full_name) = lower(btrim(c.name))
      WHERE ${open} AND c.name IS NOT NULL`,
    table === "sms_contacts"
      ? sql`SELECT c.id, cc.person_id FROM ${t} c
          JOIN contact_candidates cc ON cc.domain = lower(split_part(c.email, '@', 2))
            AND lower(cc.email) = lower(btrim(c.email))
          WHERE ${open} AND c.email IS NOT NULL`
      : sql`SELECT c.id, p.id AS person_id FROM ${t} c
          JOIN people p ON lower(substring(p.linkedin_url from 'linkedin\\.com/in/([^/?#]+)')) = lower(c.handle)
          WHERE ${open} AND c.platform = 'linkedin' AND p.linkedin_url IS NOT NULL`,
  ];
  const rows = (await db.execute(sql`
    WITH hit AS (${sql.join(arms, sql` UNION `)}),
    one AS (
      SELECT id, min(person_id) AS person_id FROM hit GROUP BY id HAVING count(DISTINCT person_id) = 1
    )
    UPDATE ${t} c SET person_id = p.id, company_id = p.company_id
    FROM one JOIN people p ON p.id = one.person_id
    WHERE c.id = one.id AND (c.company_id IS NULL OR c.company_id = p.company_id)
    RETURNING c.id`)) as unknown as { id: number }[];
  return rows.length;
}

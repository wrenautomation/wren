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

/** A thread's channel as `lead_channels` says it, by the word a spine subject uses. */
const THREAD_CHANNEL: Readonly<Record<string, LeadChannel>> = {
  email: "email",
  sms: "text",
  reach: "dm",
};
const SUBJECT_WORD: Readonly<Record<LeadChannel, string>> = {
  email: "email",
  text: "sms",
  dm: "reach",
};

/**
 * Every thread of the leads `abouts` name (`sms:42`, `email:7`, or an email address), as abouts:
 * a reply on one channel is about the same lead's threads on the others, so a Wait held on any
 * of them lets go. The person when known, else the firm, as `leadKey` says.
 */
export async function leadThreads(db: Queryable, abouts: readonly string[]): Promise<string[]> {
  const threads = abouts.flatMap((a) => {
    const m = /^(email|sms|reach):(\d{1,9})$/.exec(a);
    return m ? [sql`(${THREAD_CHANNEL[m[1] as string]}, ${Number(m[2])})`] : [];
  });
  const emails = abouts.filter((a) => a.includes("@")).map((a) => a.toLowerCase());
  if (!threads.length && !emails.length) return [];
  const arms = [
    ...(threads.length
      ? [
          sql`SELECT person_id, company_id FROM lead_channels
              WHERE (channel, id) IN (${sql.join(threads, sql`, `)})`,
        ]
      : []),
    ...(emails.length
      ? [
          sql`SELECT person_id, company_id FROM enrollments WHERE lower(to_email) IN (${sql.join(
            emails.map((e) => sql`${e}`),
            sql`, `,
          )})`,
          sql`SELECT person_id, company_id FROM sms_contacts WHERE lower(email) IN (${sql.join(
            emails.map((e) => sql`${e}`),
            sql`, `,
          )})`,
        ]
      : []),
  ];
  const rows = (await db.execute(sql`
    WITH hit AS (${sql.join(arms, sql` UNION `)})
    SELECT DISTINCT l.channel, l.id FROM lead_channels l JOIN hit h
      ON (h.person_id IS NOT NULL AND l.person_id = h.person_id)
      OR (h.person_id IS NULL AND h.company_id IS NOT NULL AND l.person_id IS NULL
        AND l.company_id = h.company_id)
    LIMIT 100`)) as unknown as { channel: LeadChannel; id: number }[];
  return rows.map((r) => `${SUBJECT_WORD[r.channel]}:${r.id}`);
}

/** One channel's thread: an email enrollment, a text or a DM contact. */
export interface Thread {
  channel: LeadChannel;
  id: number;
}

/** Who a follow-up works: the lead, or the one thread when its row names no person or firm. */
export type Who = Lead | Thread;
const isThread = (w: Who): w is Thread => "channel" in w;

/** The thread a spine subject names (`lead:sms:42`, `reply:email:7`), or null. */
export function threadOf(subject: string): Thread | null {
  const m = /^(?:lead|reply):(email|sms|reach):(\d{1,9})$/.exec(subject);
  return m ? { channel: THREAD_CHANNEL[m[1] as string] as LeadChannel, id: Number(m[2]) } : null;
}

/**
 * Who a spine event is about: its own facts, else its thread's row (`lead:sms:42`), else the
 * thread alone when that row names neither person nor firm. Null when it names no thread.
 */
export async function leadOfEvent(
  db: Queryable,
  e: { subject: string; data: Record<string, unknown> },
): Promise<Who | null> {
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const person = n(e.data.personId);
  const company = n(e.data.companyId);
  if (person !== null || company !== null) return { personId: person, companyId: company };
  const thread = threadOf(e.subject);
  if (!thread) return null;
  const [row] = (await db.execute(sql`
    SELECT person_id, company_id FROM lead_channels
    WHERE channel = ${thread.channel} AND id = ${thread.id}`)) as unknown as {
    person_id: number | null;
    company_id: number | null;
  }[];
  if (!row) return null;
  return row.person_id !== null || row.company_id !== null
    ? { personId: row.person_id, companyId: row.company_id }
    : thread;
}

/**
 * The rows of `who` in a table of `channel` (`lead_channels` when null): the person's, else the
 * firm's own (no person), else the one thread.
 */
const whoMatch = (who: Who, channel: LeadChannel | null) => {
  if (!isThread(who))
    return who.personId !== null
      ? sql`person_id = ${who.personId}`
      : sql`company_id = ${who.companyId} AND person_id IS NULL`;
  if (channel === null) return sql`channel = ${who.channel} AND id = ${who.id}`;
  return channel === who.channel ? sql`id = ${who.id}` : sql`FALSE`;
};

const named = (who: Who) => isThread(who) || who.personId !== null || who.companyId !== null;

/**
 * How they answered on any channel, or null: a text or DM reply, an email thread stopped by a
 * reply or a booking, or a call booked off any of its threads or addresses.
 */
export async function leadAnswered(db: Queryable, who: Who): Promise<string | null> {
  if (!named(who)) return null;
  const email = whoMatch(who, "email");
  const [row] = (await db.execute(sql`
    SELECT how FROM (
      SELECT 'replied by text' how FROM sms_contacts WHERE ${whoMatch(who, "text")} AND state = 'replied'
      UNION ALL
      SELECT 'replied by DM' FROM reach_contacts WHERE ${whoMatch(who, "dm")} AND state = 'replied'
      UNION ALL
      SELECT CASE stop_reason WHEN 'booked' THEN 'booked a call' ELSE 'replied by email' END
        FROM enrollments WHERE ${email} AND state = 'stopped'
          AND stop_reason IN ('reply', 'booked')
      UNION ALL
      SELECT 'booked a call' FROM call_bookings b WHERE b.state = 'booked' AND (
        b.enrollment_id IN (SELECT id FROM enrollments WHERE ${email})
        OR lower(b.email) IN (SELECT lower(to_email) FROM enrollments WHERE ${email})
        OR lower(b.email) IN (SELECT lower(email) FROM sms_contacts WHERE ${whoMatch(who, "text")}
          AND email IS NOT NULL))
    ) x LIMIT 1`)) as unknown as { how: string }[];
  return row?.how ?? null;
}

/** The active sequence any channel holds them in, as a reason, or null. */
export async function activeSequence(db: Queryable, who: Who): Promise<string | null> {
  if (!named(who)) return null;
  const [row] = (await db.execute(
    sql`SELECT channel, id FROM lead_channels WHERE active AND state <> 'replied' AND ${whoMatch(who, null)} LIMIT 1`,
  )) as unknown as { channel: LeadChannel; id: number }[];
  return row ? `in an active ${row.channel} sequence (${row.id})` : null;
}

/** Their thread on `channel`, the newest, or null: a thread alone has none on another channel. */
export async function threadOn(
  db: Queryable,
  who: Who,
  channel: LeadChannel,
): Promise<number | null> {
  if (isThread(who)) return who.channel === channel ? who.id : null;
  if (!named(who)) return null;
  const [row] = (await db.execute(sql`
    SELECT id FROM lead_channels WHERE channel = ${channel} AND ${whoMatch(who, null)}
    ORDER BY created_at DESC, id DESC LIMIT 1`)) as unknown as { id: number }[];
  return row?.id ?? null;
}

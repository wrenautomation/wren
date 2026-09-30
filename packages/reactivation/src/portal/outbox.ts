/**
 * The portal's Emails and Replies pages (R11, R13): what the composer wrote and
 * where each stands, and every reply with its handoff and whether a meeting
 * came of it. Bounded pages, like the rest of the views.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { MARKS } from "../brief.js";
import { REACTIVATION, type WhyLine } from "../compose.js";
import { billOf } from "../handoff.js";
import { iso, PAGE, type Source, sourcesOf } from "./views.js";

export const EMAIL_FILTERS = ["awaiting", "approved", "sent", "stopped", "all"] as const;
export type EmailFilter = (typeof EMAIL_FILTERS)[number];

/** Where an email pair stands, first match wins. */
export type EmailStatus = "stopped" | "sent" | "awaiting" | "approved";

export interface EmailRow {
  enrollmentId: number;
  personId: number | null;
  name: string;
  firm: string;
  to: string;
  from: string;
  subject: string | null;
  opener: string;
  followup: string | null;
  /**
   * Why each line: the brief's sentences as the pair was written from them,
   * and which paragraphs used which. Null for drafts written before the
   * composer kept this.
   */
  why: { brief: string[]; opener: WhyLine[]; followup: WhyLine[] } | null;
  /** What `why.brief` cites. */
  sources: Source[];
  status: EmailStatus;
  /** Why it stopped: a reply, a bounce, skipped by you. */
  stopReason: string | null;
  /** Steps out the door. */
  sent: number;
  approvedBy: string | null;
  writtenAt: string;
  lastSentAt: string | null;
}

export interface EmailsPage {
  rows: EmailRow[];
  total: number;
  offset: number;
  counts: Record<EmailFilter, number>;
  /** `first`: approve the first batch, then it flows; `every`: each batch waits. */
  approval: { mode: "first" | "every"; firstApproved: boolean };
}

export const REPLY_FILTERS = ["interested", "booked", "all"] as const;
export type ReplyFilter = (typeof REPLY_FILTERS)[number];

export interface ReplyRow {
  threadEventId: number;
  enrollmentId: number;
  personId: number | null;
  name: string;
  firm: string;
  from: string | null;
  subject: string | null;
  text: string;
  receivedAt: string;
  disposition: string | null;
  handoff: { recruiter: string; forwardedAt: string | null } | null;
  booked: { at: string; by: string } | null;
}

export interface RepliesPage {
  rows: ReplyRow[];
  total: number;
  offset: number;
  counts: Record<ReplyFilter, number>;
  /** Null on the demo: prices stay off public pages. */
  bill: ReturnType<typeof billOf> | null;
}

/** Longer replies are cut; the full thread is in the recruiter's inbox. */
const REPLY_CHARS = 2000;

const STATUS = sql`case
  when e.state = 'stopped' then 'stopped'
  when m.sent > 0 then 'sent'
  when m.drafts > 0 then 'awaiting'
  else 'approved' end`;

const EMAIL_WHERE: Record<EmailFilter, SQL> = {
  awaiting: sql`${STATUS} = 'awaiting'`,
  approved: sql`${STATUS} = 'approved'`,
  sent: sql`${STATUS} = 'sent'`,
  stopped: sql`${STATUS} = 'stopped'`,
  all: sql`true`,
};

const EMAIL_FROM = sql`
  from enrollments e
  join lateral (
    select count(*) filter (where state = 'sent')::int sent,
      count(*) filter (where state = 'draft')::int drafts,
      max(sent_at) last_sent_at,
      max(approved_by) filter (where step = 0) approved_by
    from messages where enrollment_id = e.id) m on true
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id
  where e.niche = ${REACTIVATION}`;

const pageOf = <F extends string>(
  filters: readonly F[],
  fallback: F,
  filter: unknown,
  offset: unknown,
) => ({
  filter: filters.includes(filter as F) ? (filter as F) : fallback,
  offset:
    typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0,
});

export async function portalEmails(
  db: Queryable,
  query: { filter?: EmailFilter; offset?: number; approval: "first" | "every" },
): Promise<EmailsPage> {
  const { filter, offset } = pageOf(EMAIL_FILTERS, "awaiting", query.filter, query.offset);
  const rows = await db.execute<{
    id: number;
    person_id: number | null;
    name: string | null;
    firm: string | null;
    to_email: string;
    sender: string;
    status: EmailStatus;
    stop_reason: string | null;
    sent: number;
    approved_by: string | null;
    created_at: unknown;
    last_sent_at: unknown;
  }>(sql`
    select e.id, e.person_id, p.full_name name, coalesce(co.name, co.domain) firm, e.to_email,
      e.sender, ${STATUS} status, e.stop_reason, m.sent, m.approved_by, e.created_at,
      m.last_sent_at
    ${EMAIL_FROM} and ${EMAIL_WHERE[filter]}
    order by e.created_at desc, e.id desc
    limit ${PAGE} offset ${offset}`);
  const steps = rows.length
    ? await db.execute<{
        enrollment_id: number;
        step: number;
        subject: string | null;
        body: string;
        provenance: unknown;
      }>(
        sql`select enrollment_id, step, subject, body, provenance from messages
          where enrollment_id in (${sql.join(
            rows.map((r) => sql`${r.id}`),
            sql`, `,
          )}) order by step`,
      )
    : [];
  const [n] = await db.execute<Record<EmailFilter, number>>(sql`
    select ${sql.join(
      EMAIL_FILTERS.map(
        (f) => sql`count(*) filter (where ${EMAIL_WHERE[f]})::int ${sql.identifier(f)}`,
      ),
      sql`, `,
    )}
    ${EMAIL_FROM}`);
  const [first] = await db.execute<{ yes: boolean }>(sql`
    select exists (select 1 from messages m join enrollments e on e.id = m.enrollment_id
      where e.niche = ${REACTIVATION} and m.approved_by in ('client', 'operator')) yes`);
  const counts = Object.fromEntries(EMAIL_FILTERS.map((f) => [f, n?.[f] ?? 0])) as Record<
    EmailFilter,
    number
  >;
  const whys = new Map(
    rows.map((r) => {
      const mine = steps.filter((s) => Number(s.enrollment_id) === Number(r.id));
      const at = (step: number) => mine.find((s) => Number(s.step) === step)?.provenance;
      return [Number(r.id), whyOf(at(0), at(1))];
    }),
  );
  const cited = [...whys.values()].flatMap((w) => (w ? marksIn(w.brief) : []));
  const sources = new Map((await sourcesOf(db, cited)).map((s) => [s.mark, s]));
  return {
    rows: rows.map((r) => {
      const mine = steps.filter((s) => Number(s.enrollment_id) === Number(r.id));
      const opener = mine.find((s) => Number(s.step) === 0);
      const followup = mine.find((s) => Number(s.step) === 1);
      const why = whys.get(Number(r.id)) ?? null;
      return {
        enrollmentId: Number(r.id),
        personId: r.person_id === null ? null : Number(r.person_id),
        name: r.name ?? r.to_email,
        firm: r.firm ?? "",
        to: r.to_email,
        from: r.sender,
        subject: opener?.subject ?? null,
        opener: opener?.body ?? "",
        followup: followup?.body ?? null,
        why,
        sources: why
          ? [...new Set(marksIn(why.brief))].flatMap((m) => {
              const s = sources.get(m);
              return s ? [s] : [];
            })
          : [],
        status: r.status,
        stopReason: r.stop_reason,
        sent: Number(r.sent),
        approvedBy: r.approved_by,
        writtenAt: iso(r.created_at) ?? "",
        lastSentAt: iso(r.last_sent_at),
      };
    }),
    total: counts[filter],
    offset,
    counts,
    approval: { mode: query.approval, firstApproved: first?.yes ?? false },
  };
}

/** Every mark in these lines, lowercase: `f12`, `c3`. */
const marksIn = (lines: string[]) =>
  lines.flatMap((l) =>
    [...l.matchAll(MARKS)].flatMap((m) =>
      (m[1] ?? "").split(/[,;]/).map((x) => x.trim().toLowerCase()),
    ),
  );

const isWhy = (x: unknown): x is WhyLine =>
  !!x &&
  typeof (x as WhyLine).text === "string" &&
  Array.isArray((x as WhyLine).lines) &&
  (x as WhyLine).lines.every((n) => Number.isInteger(n) && n >= 0);

/** The "why" a pair's provenance carries, or null when the composer didn't keep one. */
export function whyOf(opener: unknown, followup: unknown): EmailRow["why"] {
  const p = (opener ?? {}) as { brief?: { lines?: unknown }; why?: unknown };
  const lines = p.brief?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) return null;
  const read = (why: unknown) =>
    Array.isArray(why)
      ? why.filter(isWhy).filter((w) => w.lines.every((n) => n < lines.length))
      : [];
  return {
    brief: lines,
    opener: read(p.why),
    followup: read((followup as { why?: unknown } | undefined)?.why),
  };
}

const INTERESTED = sql`t.disposition in ('interested', 'meeting_booked')`;
const REPLY_WHERE: Record<ReplyFilter, SQL> = {
  interested: sql`(${INTERESTED} or h.meeting_booked_at is not null)`,
  booked: sql`h.meeting_booked_at is not null`,
  all: sql`true`,
};

const REPLY_FROM = sql`
  from thread_events t
  join enrollments e on e.id = t.enrollment_id
  left join handoffs h on h.thread_event_id = t.id
  left join people p on p.id = e.person_id
  left join companies co on co.id = e.company_id
  where t.kind = 'reply' and e.niche = ${REACTIVATION}`;

export async function portalReplies(
  db: Queryable,
  query: {
    filter?: ReplyFilter;
    offset?: number;
    /** Null leaves the bill off. */
    offer: { upfront: number; perMeeting: number; cap: number } | null;
  },
): Promise<RepliesPage> {
  const { filter, offset } = pageOf(REPLY_FILTERS, "interested", query.filter, query.offset);
  const rows = await db.execute<{
    id: number;
    enrollment_id: number;
    person_id: number | null;
    name: string | null;
    firm: string | null;
    to_email: string;
    from_address: string | null;
    subject: string | null;
    text: string | null;
    received_at: unknown;
    disposition: string | null;
    recruiter_email: string | null;
    forwarded_at: unknown;
    meeting_booked_at: unknown;
    booked_by: string | null;
  }>(sql`
    select t.id, t.enrollment_id, e.person_id, p.full_name name,
      coalesce(co.name, co.domain) firm, e.to_email, t.from_address, t.subject,
      left(coalesce(t.body_text, t.snippet, ''), ${REPLY_CHARS}) text, t.received_at,
      t.disposition, h.recruiter_email, h.forwarded_at, h.meeting_booked_at, h.booked_by
    ${REPLY_FROM} and ${REPLY_WHERE[filter]}
    order by t.received_at desc, t.id desc
    limit ${PAGE} offset ${offset}`);
  const [n] = await db.execute<Record<ReplyFilter, number>>(sql`
    select ${sql.join(
      REPLY_FILTERS.map(
        (f) => sql`count(*) filter (where ${REPLY_WHERE[f]})::int ${sql.identifier(f)}`,
      ),
      sql`, `,
    )}
    ${REPLY_FROM}`);
  const counts = Object.fromEntries(REPLY_FILTERS.map((f) => [f, n?.[f] ?? 0])) as Record<
    ReplyFilter,
    number
  >;
  return {
    rows: rows.map((r) => ({
      threadEventId: Number(r.id),
      enrollmentId: Number(r.enrollment_id),
      personId: r.person_id === null ? null : Number(r.person_id),
      name: r.name ?? r.to_email,
      firm: r.firm ?? "",
      from: r.from_address,
      subject: r.subject,
      text: r.text ?? "",
      receivedAt: iso(r.received_at) ?? "",
      disposition: r.disposition,
      handoff: r.recruiter_email
        ? { recruiter: r.recruiter_email, forwardedAt: iso(r.forwarded_at) }
        : null,
      booked:
        r.meeting_booked_at && r.booked_by
          ? { at: iso(r.meeting_booked_at) ?? "", by: r.booked_by }
          : null,
    })),
    total: counts[filter],
    offset,
    counts,
    bill: query.offer ? billOf(counts.booked, query.offer) : null,
  };
}

/**
 * The Friday report (E8): what the campaign did this week, in numbers, from
 * the same rows every other read surface uses. No LLM: a report that is
 * wrong is worse than one that is plain, and every line here is a query
 * the operator can re-run. The text is plain sentences and short tables so
 * it reads the same in a mailbox, a terminal, or a stored row.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { formatRate } from "./stats.js";

/** The counters every slice of the campaign is measured by. */
export interface Counts {
  sent: number;
  openers: number;
  replies: number;
  interested: number;
  hardBounces: number;
  unsubscribes: number;
  complaints: number;
}

export interface SliceStats<K> {
  key: K;
  week: Counts;
  toDate: Counts;
}

export interface ReportDomain {
  domain: string;
  sent: number;
  hardBounces: number;
  /** Google Postmaster's latest day for the domain, or null when it has none. */
  spamRate: number | null;
  reputation: string | null;
  postmasterDay: string | null;
}

export interface Pause {
  sender: string;
  domain: string;
  reason: string;
  pausedAt: string;
}

export interface ReplyLine {
  receivedAt: string;
  company: string | null;
  fromAddress: string | null;
  niche: string;
  disposition: string | null;
  snippet: string | null;
}

export interface Pool {
  /** Approved and waiting for the walk. */
  approved: number;
  /** Drafts the operator has not reviewed. */
  drafts: number;
  activeEnrollments: number;
  /** Openers sent per day that sent anything, over the period. */
  openersPerSendDay: number;
  /** Send days until the approved pool is gone at that pace; null when nothing is sending. */
  sendDaysLeft: number | null;
}

export interface WeeklyStats {
  periodStart: string;
  periodEnd: string;
  headline: SliceStats<"campaign">;
  byNiche: SliceStats<{ niche: string }>[];
  byArm: SliceStats<{ niche: string; arm: string }>[];
  domains: ReportDomain[];
  pauses: Pause[];
  replies: ReplyLine[];
  pool: Pool;
}

export interface CollectOptions {
  /** The end of the period (exclusive). */
  now: Date;
  /** Period length; the default is the seven days before `now`. */
  days?: number | undefined;
}

type CountRow = {
  sent: string | number;
  openers: string | number;
  replies: string | number;
  interested: string | number;
  hard_bounces: string | number;
  unsubscribes: string | number;
  complaints: string | number;
};

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

function counts(row: CountRow | undefined): Counts {
  return {
    sent: n(row?.sent),
    openers: n(row?.openers),
    replies: n(row?.replies),
    interested: n(row?.interested),
    hardBounces: n(row?.hard_bounces),
    unsubscribes: n(row?.unsubscribes),
    complaints: n(row?.complaints),
  };
}

/**
 * Sends and inbound events, each counted in the window it happened in:
 * a send by `sent_at`, an event by `received_at`. One query per grouping,
 * with `since = null` meaning "to date".
 */
function countsSql(since: string | null, until: string) {
  const sendWindow =
    since === null
      ? sql`m.sent_at < ${until}::timestamptz`
      : sql`m.sent_at >= ${since}::timestamptz AND m.sent_at < ${until}::timestamptz`;
  const eventWindow =
    since === null
      ? sql`te.received_at < ${until}::timestamptz`
      : sql`te.received_at >= ${since}::timestamptz AND te.received_at < ${until}::timestamptz`;
  return sql`
    WITH sends AS (
      SELECT e.niche, split_part(o.template, '/', 1) AS arm,
             count(*) AS sent, count(*) FILTER (WHERE m.step = 0) AS openers
      FROM messages m
      JOIN enrollments e ON e.id = m.enrollment_id
      JOIN messages o ON o.enrollment_id = e.id AND o.step = 0
      WHERE m.state = 'sent' AND ${sendWindow}
      GROUP BY 1, 2
    ), events AS (
      SELECT e.niche, split_part(o.template, '/', 1) AS arm,
             count(*) FILTER (WHERE te.kind = 'reply') AS replies,
             count(*) FILTER (WHERE te.kind = 'reply'
                              AND te.disposition IN ('interested', 'meeting_booked')) AS interested,
             count(*) FILTER (WHERE te.kind = 'bounce' AND te.bounce_class = 'hard') AS hard_bounces,
             count(*) FILTER (WHERE te.kind = 'unsubscribe') AS unsubscribes,
             count(*) FILTER (WHERE te.kind = 'complaint') AS complaints
      FROM thread_events te
      JOIN enrollments e ON e.id = te.enrollment_id
      JOIN messages o ON o.enrollment_id = e.id AND o.step = 0
      WHERE ${eventWindow}
      GROUP BY 1, 2
    )
    SELECT COALESCE(s.niche, ev.niche) AS niche, COALESCE(s.arm, ev.arm) AS arm,
           COALESCE(s.sent, 0) AS sent, COALESCE(s.openers, 0) AS openers,
           COALESCE(ev.replies, 0) AS replies, COALESCE(ev.interested, 0) AS interested,
           COALESCE(ev.hard_bounces, 0) AS hard_bounces, COALESCE(ev.unsubscribes, 0) AS unsubscribes,
           COALESCE(ev.complaints, 0) AS complaints
    FROM sends s FULL OUTER JOIN events ev ON ev.niche = s.niche AND ev.arm = s.arm
    ORDER BY 1, 2`;
}

type ArmRow = CountRow & { niche: string; arm: string };

const add = (a: Counts, b: Counts): Counts => ({
  sent: a.sent + b.sent,
  openers: a.openers + b.openers,
  replies: a.replies + b.replies,
  interested: a.interested + b.interested,
  hardBounces: a.hardBounces + b.hardBounces,
  unsubscribes: a.unsubscribes + b.unsubscribes,
  complaints: a.complaints + b.complaints,
});

export const ZERO: Counts = {
  sent: 0,
  openers: 0,
  replies: 0,
  interested: 0,
  hardBounces: 0,
  unsubscribes: 0,
  complaints: 0,
};

/** Fold arm rows up into niche and campaign totals; every arm appears in both windows. */
function slices(week: ArmRow[], toDate: ArmRow[]) {
  const armKey = (r: ArmRow) => `${r.niche}\u0000${r.arm}`;
  const byArm = new Map<string, SliceStats<{ niche: string; arm: string }>>();
  const byNiche = new Map<string, SliceStats<{ niche: string }>>();
  let campaign: SliceStats<"campaign"> = { key: "campaign", week: ZERO, toDate: ZERO };
  const fold = (rows: ArmRow[], which: "week" | "toDate") => {
    for (const r of rows) {
      const c = counts(r);
      const arm = byArm.get(armKey(r)) ?? {
        key: { niche: r.niche, arm: r.arm },
        week: ZERO,
        toDate: ZERO,
      };
      arm[which] = add(arm[which], c);
      byArm.set(armKey(r), arm);
      const niche = byNiche.get(r.niche) ?? { key: { niche: r.niche }, week: ZERO, toDate: ZERO };
      niche[which] = add(niche[which], c);
      byNiche.set(r.niche, niche);
      campaign = { ...campaign, [which]: add(campaign[which], c) };
    }
  };
  fold(toDate, "toDate");
  fold(week, "week");
  return {
    headline: campaign,
    byNiche: [...byNiche.values()].sort((a, b) => a.key.niche.localeCompare(b.key.niche)),
    byArm: [...byArm.values()].sort(
      (a, b) => a.key.niche.localeCompare(b.key.niche) || a.key.arm.localeCompare(b.key.arm),
    ),
  };
}

export async function collectWeekly(db: Queryable, opts: CollectOptions): Promise<WeeklyStats> {
  const days = opts.days ?? 7;
  // Raw params go over the wire as text; a Date would not.
  const until = opts.now.toISOString();
  const since = new Date(opts.now.getTime() - days * 86_400_000).toISOString();

  const week = (await db.execute(countsSql(since, until))) as ArmRow[];
  const toDate = (await db.execute(countsSql(null, until))) as ArmRow[];

  const domainRows = (await db.execute(sql`
    WITH sent AS (
      SELECT split_part(e.sender, '@', 2) AS domain, count(*) AS sent
      FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE m.state = 'sent' AND m.sent_at >= ${since}::timestamptz AND m.sent_at < ${until}::timestamptz
      GROUP BY 1
    ), bounced AS (
      SELECT split_part(e.sender, '@', 2) AS domain, count(*) AS hard_bounces
      FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id
      WHERE te.kind = 'bounce' AND te.bounce_class = 'hard'
        AND te.received_at >= ${since}::timestamptz AND te.received_at < ${until}::timestamptz
      GROUP BY 1
    ), pm AS (
      SELECT DISTINCT ON (domain) domain, day, spam_rate, domain_reputation
      FROM postmaster_days WHERE day <= (${until}::timestamptz)::date
      ORDER BY domain, day DESC
    ), domains AS (
      SELECT domain FROM sent UNION SELECT domain FROM bounced UNION SELECT domain FROM pm
    )
    SELECT d.domain, COALESCE(s.sent, 0) AS sent, COALESCE(b.hard_bounces, 0) AS hard_bounces,
           pm.spam_rate, pm.domain_reputation, pm.day::text AS postmaster_day
    FROM domains d
    LEFT JOIN sent s ON s.domain = d.domain
    LEFT JOIN bounced b ON b.domain = d.domain
    LEFT JOIN pm ON pm.domain = d.domain
    ORDER BY d.domain`)) as {
    domain: string;
    sent: string | number;
    hard_bounces: string | number;
    spam_rate: number | null;
    domain_reputation: string | null;
    postmaster_day: string | null;
  }[];

  const pauseRows = (await db.execute(sql`
    SELECT sender, domain, reason, paused_at::text AS paused_at
    FROM sender_pauses WHERE lifted_at IS NULL ORDER BY paused_at`)) as {
    sender: string;
    domain: string;
    reason: string;
    paused_at: string;
  }[];

  const replyRows = (await db.execute(sql`
    SELECT te.received_at::text AS received_at, c.name AS company, te.from_address, e.niche,
           te.disposition, left(te.snippet, 160) AS snippet
    FROM thread_events te
    JOIN enrollments e ON e.id = te.enrollment_id
    LEFT JOIN companies c ON c.id = e.company_id
    WHERE te.kind = 'reply' AND te.received_at >= ${since}::timestamptz AND te.received_at < ${until}::timestamptz
      AND (te.disposition IS NULL
           OR te.disposition IN ('interested', 'meeting_booked', 'referral', 'other'))
    ORDER BY te.received_at DESC LIMIT 40`)) as {
    received_at: string;
    company: string | null;
    from_address: string | null;
    niche: string;
    disposition: string | null;
    snippet: string | null;
  }[];

  const [poolRow] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM messages WHERE state = 'approved') AS approved,
      (SELECT count(*) FROM messages WHERE state = 'draft') AS drafts,
      (SELECT count(*) FROM enrollments WHERE state = 'active') AS active,
      (SELECT count(*) FROM messages WHERE state = 'sent' AND step = 0
         AND sent_at >= ${since}::timestamptz AND sent_at < ${until}::timestamptz) AS openers,
      (SELECT count(DISTINCT (sent_at AT TIME ZONE 'UTC')::date) FROM messages
         WHERE state = 'sent' AND sent_at >= ${since}::timestamptz AND sent_at < ${until}::timestamptz) AS send_days`)) as {
    approved: string | number;
    drafts: string | number;
    active: string | number;
    openers: string | number;
    send_days: string | number;
  }[];
  const sendDays = n(poolRow?.send_days);
  const openersPerSendDay = sendDays === 0 ? 0 : n(poolRow?.openers) / sendDays;
  const approved = n(poolRow?.approved);

  return {
    periodStart: since,
    periodEnd: until,
    ...slices(week, toDate),
    domains: domainRows.map((r) => ({
      domain: r.domain,
      sent: n(r.sent),
      hardBounces: n(r.hard_bounces),
      spamRate: r.spam_rate,
      reputation: r.domain_reputation,
      postmasterDay: r.postmaster_day,
    })),
    pauses: pauseRows.map((r) => ({
      sender: r.sender,
      domain: r.domain,
      reason: r.reason,
      pausedAt: r.paused_at,
    })),
    replies: replyRows.map((r) => ({
      receivedAt: r.received_at,
      company: r.company,
      fromAddress: r.from_address,
      niche: r.niche,
      disposition: r.disposition,
      snippet: r.snippet,
    })),
    pool: {
      approved,
      drafts: n(poolRow?.drafts),
      activeEnrollments: n(poolRow?.active),
      openersPerSendDay,
      sendDaysLeft: openersPerSendDay === 0 ? null : Math.ceil(approved / openersPerSendDay),
    },
  };
}

// ---- rendering --------------------------------------------------------

const day = (iso: string): string => iso.slice(0, 10);

function delta(now: number, before: number | undefined): string {
  if (before === undefined) return "";
  const d = now - before;
  return d === 0 ? " (=)" : ` (${d > 0 ? "+" : ""}${d})`;
}

function countsLine(c: Counts, prev?: Counts): string {
  return [
    `sends ${c.sent}${delta(c.sent, prev?.sent)}`,
    `replies ${c.replies}${delta(c.replies, prev?.replies)}`,
    `interested ${c.interested}${delta(c.interested, prev?.interested)}`,
    `reply rate ${formatRate(c.replies, c.sent)}`,
  ].join(" · ");
}

function healthLine(d: ReportDomain): string {
  const bounce = d.sent === 0 ? "no sends" : `bounces ${d.hardBounces}/${d.sent}`;
  const pm =
    d.postmasterDay === null
      ? "postmaster: no data"
      : `postmaster ${d.postmasterDay}: spam ${
          d.spamRate === null ? "?" : `${(100 * d.spamRate).toFixed(2)}%`
        }, reputation ${d.reputation ?? "?"}`;
  return `- ${d.domain}: ${bounce} · ${pm}`;
}

/** The one line the operator acts on Monday, from the numbers alone. */
export function mondayLine(s: WeeklyStats): string {
  if (s.pauses.length > 0) {
    const first = s.pauses[0] as Pause;
    return `Monday: ${s.pauses.length} sender(s) paused — investigate ${first.domain} (${first.reason}) and lift or replace.`;
  }
  const unread = s.replies.filter((r) => r.disposition === null).length;
  if (unread > 0)
    return `Monday: read the ${unread} unclassified repl${unread === 1 ? "y" : "ies"} below.`;
  if (s.pool.sendDaysLeft !== null && s.pool.sendDaysLeft <= 5) {
    return `Monday: the approved pool empties in ~${s.pool.sendDaysLeft} send day(s) — queue and approve the next batch.`;
  }
  if (s.pool.approved === 0 && s.pool.drafts > 0) {
    return `Monday: nothing approved; ${s.pool.drafts} drafts waiting for review.`;
  }
  if (s.pool.approved === 0) return "Monday: the pool is empty — import or resolve more leads.";
  return "Monday: nothing owed. Let it run.";
}

/**
 * The report text. `previous` is last week's stats, for the deltas; the
 * shape is stable so a stored row can be compared with the next one.
 */
export function renderWeekly(s: WeeklyStats, previous: WeeklyStats | null = null): string {
  const out: string[] = [];
  out.push(`Wren weekly email report — ${day(s.periodStart)} to ${day(s.periodEnd)}`);
  out.push("");
  out.push("1. Headline");
  out.push(`This week: ${countsLine(s.headline.week, previous?.headline.week)}`);
  out.push(`To date:   ${countsLine(s.headline.toDate)}`);
  const h = s.headline.week;
  if (h.hardBounces || h.unsubscribes || h.complaints) {
    out.push(
      `Also this week: hard bounces ${h.hardBounces}, unsubscribes ${h.unsubscribes}, complaints ${h.complaints}`,
    );
  }
  out.push("");
  out.push("2. By niche (this week / to date)");
  if (s.byNiche.length === 0) out.push("- nothing sent yet");
  for (const x of s.byNiche) {
    out.push(
      `- ${x.key.niche}: ${x.week.sent} sent, ${x.week.replies} replies, ${x.week.interested} interested / ${x.toDate.sent} sent, ${x.toDate.replies} replies, ${x.toDate.interested} interested (${formatRate(x.toDate.replies, x.toDate.sent)})`,
    );
  }
  out.push("");
  out.push("   By arm (to date)");
  for (const x of s.byArm) {
    out.push(
      `- ${x.key.niche}/${x.key.arm}: ${x.toDate.sent} sent, ${x.toDate.replies} replies, ${x.toDate.interested} interested (${formatRate(x.toDate.replies, x.toDate.sent)})`,
    );
  }
  out.push("");
  out.push("3. Deliverability");
  if (s.domains.length === 0) out.push("- no sending domains yet");
  for (const d of s.domains) out.push(healthLine(d));
  if (s.pauses.length === 0) out.push("- no paused senders");
  for (const p of s.pauses) out.push(`- PAUSED ${p.sender} since ${day(p.pausedAt)}: ${p.reason}`);
  out.push("");
  out.push("4. Replies worth reading");
  if (s.replies.length === 0) out.push("- none this week");
  for (const r of s.replies) {
    const who = r.company ?? r.fromAddress ?? "unknown";
    const tag = r.disposition ?? "unclassified";
    out.push(`- ${day(r.receivedAt)} ${who} [${r.niche}, ${tag}]: ${(r.snippet ?? "").trim()}`);
  }
  out.push("");
  out.push("5. Pool");
  const pace =
    s.pool.openersPerSendDay === 0
      ? "nothing sent this period"
      : `${s.pool.openersPerSendDay.toFixed(1)} openers per send day`;
  const left =
    s.pool.sendDaysLeft === null ? "" : ` → empties in ~${s.pool.sendDaysLeft} send day(s)`;
  out.push(
    `- ${s.pool.approved} approved and waiting, ${s.pool.drafts} drafts unreviewed, ${s.pool.activeEnrollments} enrollments active`,
  );
  out.push(`- pace: ${pace}${left}`);
  out.push("");
  out.push("6. Versus last week");
  out.push(
    previous === null
      ? "- no earlier report to compare with"
      : `- last week: ${countsLine(previous.headline.week)}`,
  );
  out.push("");
  out.push(`7. ${mondayLine(s)}`);
  return `${out.join("\n")}\n`;
}

/**
 * Reactivation fills the client's delivery portal (delivery D6, plan step 6):
 * the measures it can count (contacts reached, replies, meetings booked), the
 * running bill on meetings (R18), and one timeline line a day when the numbers
 * moved. Job orders and fees stay the client's to tell us.
 *
 * Counts are the Replies page's, all time, so the two pages and their bills agree.
 */

import type { Queryable } from "@wren/db";
import { engagements, postUpdate, recordResult, results, updates } from "@wren/delivery";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { REACTIVATION } from "./compose.js";
import { billOf } from "./handoff.js";
import type { ReactivationSettings } from "./settings.js";

/** The offers this product delivers. */
const OFFERS = ["reactivation", "recruiting-reactivation-pilot"];
/** The author of what the feed writes. */
export const FEED_BY = "reactivation";

export interface FeedStats {
  /** Active engagements fed. */
  engagements: number;
  /** Measures that changed. */
  changed: string[];
  /** Whether a timeline line went up. */
  posted: boolean;
}

interface Counts {
  reached: number;
  replies: number;
  meetings: number;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** All-time counts, and the ones that happened in [from, to). */
async function countsOf(
  db: Queryable,
  from: Date | null,
  to: Date,
): Promise<{ total: Counts; fresh: Counts }> {
  const since = from?.toISOString() ?? "-infinity";
  const until = to.toISOString();
  const [r] = await db.execute<Record<string, number>>(sql`
    with reached as (
      select min(m.sent_at) at from messages m join enrollments e on e.id = m.enrollment_id
      where e.niche = ${REACTIVATION} and m.state = 'sent' group by lower(e.to_email)),
    replies as (
      select t.received_at at from thread_events t join enrollments e on e.id = t.enrollment_id
      where t.kind = 'reply' and e.niche = ${REACTIVATION}),
    meetings as (
      select h.meeting_booked_at at from handoffs h
      join thread_events t on t.id = h.thread_event_id
      join enrollments e on e.id = t.enrollment_id
      where h.meeting_booked_at is not null and t.kind = 'reply' and e.niche = ${REACTIVATION})
    select ${sql.join(
      (["reached", "replies", "meetings"] as const).map(
        (k) => sql`
          (select count(*) from ${sql.identifier(k)})::int ${sql.identifier(k)},
          (select count(*) from ${sql.identifier(k)}
            where at >= ${since}::timestamptz and at < ${until}::timestamptz)::int ${sql.identifier(`${k}_fresh`)}`,
      ),
      sql`,`,
    )}`);
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    total: { reached: n("reached"), replies: n("replies"), meetings: n("meetings") },
    fresh: {
      reached: n("reached_fresh"),
      replies: n("replies_fresh"),
      meetings: n("meetings_fresh"),
    },
  };
}

/** What changed, in words; empty when nothing did. */
const told = (c: Counts): string[] =>
  [
    c.reached && `${c.reached} contact${c.reached === 1 ? "" : "s"} reached`,
    c.replies && `${c.replies} repl${c.replies === 1 ? "y" : "ies"}`,
    c.meetings && `${c.meetings} meeting${c.meetings === 1 ? "" : "s"} booked`,
  ].filter((s): s is string => typeof s === "string");

/**
 * One client's numbers into its active reactivation engagements. A result is
 * written only when it changed; the day's line goes up on the first call of
 * the next UTC day, about the days since the last one.
 * `main` holds the delivery schema; `db` is the client's database.
 */
export async function feedDelivery(
  main: Queryable,
  db: Queryable,
  clientId: string,
  settings: Pick<ReactivationSettings, "offer">,
  now: Date,
): Promise<FeedStats> {
  const es = await main
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.clientId, clientId),
        eq(engagements.status, "active"),
        inArray(engagements.offerId, OFFERS),
      ),
    );
  const stats: FeedStats = { engagements: es.length, changed: [], posted: false };
  const today = dayOf(now);
  for (const e of es) {
    const [last] = await main
      .select({ at: updates.createdAt })
      .from(updates)
      .where(and(eq(updates.engagementId, e.id), eq(updates.author, FEED_BY)))
      .orderBy(desc(updates.createdAt))
      .limit(1);
    // The last line covered up to the start of its day; this one covers the rest, to today.
    const from = last ? new Date(`${dayOf(last.at)}T00:00:00Z`) : null;
    const { total, fresh } = await countsOf(db, from, new Date(`${today}T00:00:00Z`));

    const bill = billOf(total.meetings, settings.offer);
    const want: Record<string, { value: number; note: string | null }> = {
      contacts_reached: { value: total.reached, note: null },
      replies: { value: total.replies, note: null },
      meetings: {
        value: total.meetings,
        note: `${money(bill.total)} owed so far: ${money(bill.upfront)} setup + ${money(bill.meetingFees)} in meetings${
          bill.meetingFees < total.meetings * bill.perMeeting ? " (capped)" : ""
        }`,
      },
    };
    const had = await main.select().from(results).where(eq(results.engagementId, e.id));
    for (const [key, w] of Object.entries(want)) {
      const h = had.find((r) => r.key === key);
      if (h && h.value === w.value && h.note === w.note) continue;
      await recordResult(main, e, { key, value: w.value, note: w.note ?? undefined, by: FEED_BY });
      stats.changed.push(key);
    }

    const lines = told(fresh);
    if (lines.length > 0 && (!last || dayOf(last.at) < today)) {
      const yesterday = dayOf(new Date(now.getTime() - 86_400_000));
      const label = !from
        ? "So far"
        : dayOf(from) === yesterday
          ? "Yesterday"
          : `Since ${dayOf(from)}`;
      await postUpdate(main, e, {
        body: `${label}: ${lines.join(", ")}.`,
        author: FEED_BY,
        at: now,
      });
      stats.posted = true;
    }
  }
  return stats;
}

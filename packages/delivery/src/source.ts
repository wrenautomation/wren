/**
 * How a client came in, suggested for its engagement's source (unit economics): the lander's
 * first touch on an application sent from a member's email, and a member's reply to a campaign.
 * Email's tables are read by SQL name: delivery never imports a channel's code.
 */
import { type Channel, touchChannel } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export interface SourceHint {
  channel: Channel;
  campaign: string | null;
  /** What says so, in a line. */
  why: string;
}

/** A lander application, as its /api/export gives it. */
export interface SiteApplicationTouch {
  ts: string;
  email?: string | null;
  /** The visitor's first touch, JSON (lander `visitor.ts`), or "". */
  first_touch?: string | null;
}

/** A lander touch, as JSON, as a channel (`touchChannel`). Else null. */
export function touchSource(raw: string): { channel: Channel; campaign: string | null } | null {
  let t: unknown;
  try {
    t = JSON.parse(raw);
  } catch {
    return null;
  }
  return t && typeof t === "object" ? touchChannel(t as Record<string, unknown>) : null;
}

/** What the site and the replies say about how a client came in: applications, then replies by campaign, oldest first. */
export async function sourceHints(
  db: Queryable,
  clientId: string,
  applications: readonly SiteApplicationTouch[],
): Promise<SourceHint[]> {
  const members = new Set(
    (
      await db.execute<{ email: string }>(
        sql`select lower(email) email from client_members where client_id = ${clientId}`,
      )
    ).map((m) => m.email),
  );
  const hints: SourceHint[] = [];
  for (const a of applications) {
    const email = a.email?.trim().toLowerCase();
    const got = email && members.has(email) && a.first_touch ? touchSource(a.first_touch) : null;
    if (got) hints.push({ ...got, why: `applied on the site ${a.ts.slice(0, 10)} as ${email}` });
  }
  const replies = await db.execute<{ campaign: string; at: string }>(sql`
    select e.niche campaign, min(t.received_at)::text at
    from thread_events t join enrollments e on e.id = t.enrollment_id
    where t.kind = 'reply' and (lower(e.to_email) in (select lower(m.email) from client_members m
      where m.client_id = ${clientId}) or lower(t.from_address) in (select lower(m.email)
      from client_members m where m.client_id = ${clientId}))
    group by e.niche order by 2`);
  for (const r of replies)
    hints.push({
      channel: "email",
      campaign: r.campaign,
      why: `replied to the ${r.campaign} campaign ${r.at.slice(0, 10)}`,
    });
  return hints;
}

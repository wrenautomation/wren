/**
 * One person's journey, oldest first: each email sent, what came back (a reply, a bounce, an
 * opt-out), the meeting booked off a reply, and each call logged. A person's page draws it with the
 * graph kit, a lane per channel.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export interface PersonTouch {
  at: string;
  channel: "Email" | "Meetings" | "Calls";
  kind: string;
  label: string;
  note: string | null;
}

/** The most one page carries; a person rarely has a tenth of it. */
const MOST = 200;

export async function personTouches(db: Queryable, personId: number): Promise<PersonTouch[]> {
  const rows = await db.execute<{
    at: Date | string;
    channel: PersonTouch["channel"];
    kind: string;
    label: string | null;
    note: string | null;
  }>(sql`
    select m.sent_at "at", 'Email' channel, 'sent' kind, m.subject label,
      'step ' || (m.step + 1) note
    from messages m join enrollments e on e.id = m.enrollment_id
    where e.person_id = ${personId} and e.niche = 'reactivation' and m.state = 'sent'
      and m.sent_at is not null
    union all
    select t.received_at, 'Email', t.kind, coalesce(t.subject, t.snippet),
      replace(t.disposition, '_', ' ')
    from thread_events t join enrollments e on e.id = t.enrollment_id
    where e.person_id = ${personId} and e.niche = 'reactivation' and t.kind <> 'note'
      and t.received_at is not null
    union all
    select h.meeting_booked_at, 'Meetings', 'booked', 'Meeting booked', null
    from handoffs h where h.person_id = ${personId} and h.meeting_booked_at is not null
    union all
    select k.called_at, 'Calls', 'called', 'Called', null
    from calls k where k.person_id = ${personId}
    order by 1 limit ${MOST}`);
  return rows.map((r) => ({
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    channel: r.channel,
    kind: r.kind,
    label: r.label ?? "",
    note: r.note,
  }));
}

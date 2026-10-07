/**
 * One person's journey, oldest first: each email sent, what came back (a reply, a bounce, an
 * opt-out), the meeting booked off a reply, each call logged, and each Follow-up or Nurture touch
 * with the wait it is in now. A person's page draws it with the graph kit, a lane per channel.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export interface PersonTouch {
  at: string;
  channel: "Email" | "Meetings" | "Calls" | "Follow-up";
  kind: string;
  label: string;
  note: string | null;
}

/** What a follow-up touch did (`data.follow.did`), as its dot reads. */
const DID: Readonly<Record<string, string>> = {
  queued: "sent",
  would_send: "would send",
  skipped: "skipped",
  answered: "answered",
};
const CHANNEL: Readonly<Record<string, string>> = { text: "Text", dm: "DM", email: "Email" };
const PART: Readonly<Record<string, string>> = { follow_up: "Follow-up", nurture: "Nurture" };

/** A follow-up touch's label from its kept note: "Nurture: DM sent". */
function followLabel(raw: string | null): string {
  const [part = "", channel = "", did = ""] = (raw ?? "").split("|");
  if (did === "waiting") return "Waiting for an answer";
  return `${PART[part] ?? "Follow-up"}: ${CHANNEL[channel] ?? "Touch"} ${DID[did] ?? did}`;
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
    with threads as (
      select (case channel when 'text' then 'lead:sms:' when 'dm' then 'lead:reach:'
        else 'lead:email:' end) || id subject
      from lead_channels where person_id = ${personId})
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
    union all
    select coalesce(ev.sent_at, ev.at), 'Follow-up', f.v->'data'->'follow'->>'did',
      concat_ws('|', f.v->'data'->'follow'->>'part', f.v->'data'->'follow'->>'channel',
        f.v->'data'->'follow'->>'did'),
      f.v->'data'->'follow'->>'why'
    from events ev cross join lateral jsonb_array_elements(ev.sent) f(v)
    where ev.subject in (select subject from threads) and ev.sent is not null
      and f.v->'data' ? 'follow'
    union all
    select ev.at, 'Follow-up', 'waiting',
      '||waiting',
      'until ' || to_char(ev.due at time zone 'UTC', 'Mon DD')
    from events ev where ev.subject in (select subject from threads)
      and ev.due is not null and ev.until = 'answer'
    order by 1 limit ${MOST}`);
  return rows.map((r) => ({
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    channel: r.channel,
    // A queued follow-up is the channel's to send: on the journey it reads as sent.
    kind: r.kind === "queued" ? "sent" : r.kind,
    label: r.channel === "Follow-up" ? followLabel(r.label) : (r.label ?? ""),
    note: r.note,
  }));
}

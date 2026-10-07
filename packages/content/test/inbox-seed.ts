/**
 * Synthetic Inbox threads for tests and the local preview (designs/2026-10-07-inbox-reply.md).
 * One person on four channels: an email reply, texts, a LinkedIn DM, a YouTube comment, a booking
 * and a like. A second person texts only. Every name, number and address is made up.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
const one = async (db: Queryable, q: ReturnType<typeof sql>): Promise<number> => {
  const [r] = (await db.execute(q)) as unknown as Row[];
  return Number(r?.id);
};

export interface InboxSeed {
  personId: number;
  enrollmentId: number;
  replyId: number;
  smsId: number;
  smsOtherId: number;
  reachId: number;
  commentId: number;
  /** The teammates: an admin and an operator. */
  admin: string;
  operator: string;
}

/** Minutes ago, from `now`, as ISO: raw sql takes no Date. */
const ago = (now: Date, min: number) => new Date(now.getTime() - min * 60_000).toISOString();

export async function seedInbox(db: Queryable, now = new Date()): Promise<InboxSeed> {
  const admin = "admin@wren.example.test";
  const operator = "alex@wren.example.test";
  await db.execute(sql`insert into operators (email, role) values (${admin}, 'admin'),
    (${operator}, 'operator') on conflict do nothing`);
  const companyId = await one(
    db,
    sql`insert into companies (name, domain) values ('Sample Plumbing Co',
      'sample-plumbing.example.test') returning id`,
  );
  const personId = await one(
    db,
    sql`insert into people (company_id, full_name, first_name, last_name, title, is_compliance,
        origin, origin_ref, raw)
      values (${companyId}, 'Dana Rivera', 'Dana', 'Rivera', 'Owner', false, 'manual', 'seed',
        '{}'::jsonb) returning id`,
  );
  const email = "dana@sample-plumbing.example.test";
  const enrollmentId = await one(
    db,
    sql`insert into enrollments (person_id, niche, sequence_name, sequence_snapshot, state,
        stop_reason, stopped_at, company_id, kind, to_email, sender, offer)
      values (${personId}, 'trades', 'intro', '{}'::jsonb, 'stopped', 'reply', ${ago(now, 2000)},
        ${companyId}, 'person', ${email}, 'will@wren.example.test', 'intro') returning id`,
  );
  await db.execute(sql`insert into messages (enrollment_id, step, template, template_version,
      to_email, subject, body, provenance, state, message_id, sent_at)
    values (${enrollmentId}, 0, 'intro/opener', 'v1', ${email}, 'Missed calls at Sample Plumbing',
      ${"Hi Dana, saw you run the after-hours line yourself. Want a text-back for missed calls?"},
      '{}'::jsonb, 'sent', '<seed-1@wren.example.test>', ${ago(now, 3000)})`);
  const replyId = await one(
    db,
    sql`insert into thread_events (enrollment_id, kind, received_at, from_address, subject,
        body_text, disposition, disposition_source)
      values (${enrollmentId}, 'reply', ${ago(now, 2000)}, ${email},
        'Re: Missed calls at Sample Plumbing',
        ${"Maybe. How does it work when I'm on a job and can't pick up?"}, 'interested', 'llm')
      returning id`,
  );
  await db.execute(sql`insert into call_bookings (uid, state, start, email, name, enrollment_id,
      booked_at) values ('seed-booking-1', 'booked', ${ago(now, -1440)}, ${email}, 'Dana Rivera',
      ${enrollmentId}, ${ago(now, 1500)})`);

  const smsId = await one(
    db,
    sql`insert into sms_contacts (e164, source_kind, basis, person_id, company_id, name, email,
        state)
      values ('+15555550142', 'manual', 'opt_in', ${personId}, ${companyId}, 'Dana Rivera',
        ${email}, 'replied') returning id`,
  );
  await db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state,
      provider_id, sent_at, created_at)
    values (${smsId}, 'out', 'manual', '+15555550142',
      'Thanks for booking. Anything you want me to look at before the call?', 'sent', 'seed-sms-1',
      ${ago(now, 1400)}, ${ago(now, 1400)})`);
  await db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state,
      received_at, created_at)
    values (${smsId}, 'in', 'inbound', '+15555550100',
      'Yes. Can it text back in Spanish too? Half my calls are Spanish.', 'received',
      ${ago(now, 30)}, ${ago(now, 30)})`);

  const accountId = (
    (await db.execute(sql`insert into reach_accounts (platform, account, handle, started_on)
      values ('linkedin', 'linkedin@wren', 'will-wren', ${now.toISOString().slice(0, 10)})
      returning id`)) as unknown as Row[]
  )[0]?.id;
  const reachId = await one(
    db,
    sql`insert into reach_contacts (platform, handle, url, found_in, name, headline, person_id,
        company_id, account_id, state, connected_at)
      values ('linkedin', 'dana-rivera-sample', 'https://linkedin.example.test/in/dana', 'search',
        'Dana Rivera', 'Owner, Sample Plumbing Co', ${personId}, ${companyId}, ${accountId},
        'replied', ${ago(now, 4000)}) returning id`,
  );
  await db.execute(sql`insert into reach_messages (contact_id, account_id, direction, kind, body,
      state, sent_at, created_at)
    values (${reachId}, ${accountId}, 'out', 'manual',
      'Good to connect, Dana. Saw your post on after-hours calls.', 'sent', ${ago(now, 3900)},
      ${ago(now, 3900)}),
      (${reachId}, ${accountId}, 'in', 'inbound', 'Thanks! Still drowning in voicemails.',
      'received', ${ago(now, 3800)}, ${ago(now, 3800)})`);

  const commentId = await one(
    db,
    sql`insert into comments (platform, channel, ref, post, parent, kind, author, body, url, at,
        raw, state, post_title)
      values ('youtube', 'content', 'seed-comment-1', 'seed-video-1', 'seed-video-1', 'post_reply',
        'dana_rivera', 'Does this work for a two-truck shop?', 'https://youtube.example.test/c1',
        ${ago(now, 600)}, '{}'::jsonb, 'waiting', 'Missed-call text-back in 3 minutes')
      returning id`,
  );
  const handleId = await one(
    db,
    sql`insert into social_handles (platform, handle, name, person_id, linked_by, linked_at)
      values ('youtube', 'dana_rivera', 'Dana Rivera', ${personId}, 'given', ${now.toISOString()})
      returning id`,
  );
  await db.execute(sql`insert into touches (handle_id, kind, direction, account, text, at, source, ref)
    values (${handleId}, 'like', 'theirs', 'wren', null, ${ago(now, 700)}, 'seed', 'seed:like-1')`);

  const smsOtherId = await one(
    db,
    sql`insert into sms_contacts (e164, source_kind, basis, name, state)
      values ('+15555550177', 'inbound', 'opt_in', 'Sam Okafor', 'replied') returning id`,
  );
  await db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state,
      received_at, created_at)
    values (${smsOtherId}, 'in', 'inbound', '+15555550100', 'Do you do quotes on weekends?',
      'received', ${ago(now, 90)}, ${ago(now, 90)})`);
  return {
    personId,
    enrollmentId,
    replyId,
    smsId,
    smsOtherId,
    reachId,
    commentId,
    admin,
    operator,
  };
}

/** The tables `seedInbox` writes, children first, for a truncate between tests. */
export const INBOX_TABLES = [
  "note_mentions",
  "inbox_notes",
  "inbox_threads",
  "inbox_replies",
  "touches",
  "social_handles",
  "comments",
  "reach_messages",
  "reach_contacts",
  "reach_accounts",
  "sms_messages",
  "sms_contacts",
  "call_bookings",
  "call_invites",
  "thread_events",
  "messages",
  "enrollments",
  "people",
  "companies",
  "operators",
] as const;

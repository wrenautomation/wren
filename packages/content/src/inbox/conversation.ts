/**
 * One Inbox thread as a conversation (designs/2026-10-07-inbox-reply.md): the person behind it,
 * every message and touch with them on any channel, our notes, and the channels a reply can take.
 */
import type { Queryable } from "@wren/db";
import { atEmails, inboxNotesOf } from "@wren/notes/inbox";
import { type SQL, sql } from "drizzle-orm";
import type { InboxChannel } from "../schema.js";
import { typed } from "./threads.js";

type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: SQL) => (await db.execute(q)) as unknown as Row[];
const ids = (rows: Row[], key = "id") =>
  rows.flatMap((r) => (r[key] == null ? [] : [Number(r[key])]));
/** `(1, 2)` for an `in`; `(null)` matches nothing. */
const list = (xs: readonly (number | string)[]) =>
  xs.length
    ? sql`(${sql.join(
        xs.map((x) => sql`${x}`),
        sql`, `,
      )})`
    : sql`(null)`;
const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Who a thread is with, and every row of theirs a timeline reads. */
export interface Party {
  thread: string;
  type: string;
  who: string | null;
  personId: number | null;
  leadId: number | null;
  /** The comment the thread is, when it is one. */
  commentId: number | null;
  enrollmentIds: number[];
  smsIds: number[];
  reachIds: number[];
  commentIds: number[];
  emails: string[];
  /** Mail to the client's own mailbox (`watch.mail`): the thread it sits in there. */
  mail: MailThread | null;
}

/** A thread in a client's connected mailbox: its mailbox and the provider's thread id. */
export interface MailThread {
  id: number;
  mailbox: string;
  threadId: string;
}

/** A person's by a social handle: the touches model's link. */
async function handlePerson(db: Queryable, platform: unknown, handle: unknown) {
  if (!platform || !handle) return { personId: null, leadId: null };
  const [h] = await rowsOf(
    db,
    sql`select person_id, lead_id from social_handles
      where platform = ${String(platform)} and lower(handle) = lower(${String(handle)}) limit 1`,
  );
  return {
    personId: h?.person_id == null ? null : Number(h.person_id),
    leadId: h?.lead_id == null ? null : Number(h.lead_id),
  };
}

/**
 * The access channel a thread came in on (`ACCESS_CHANNELS`): `sms` for a text, `email` for an
 * email, a DM's or comment's platform, null for none we name or a thread that is gone.
 */
export async function threadChannelOf(db: Queryable, thread: string): Promise<string | null> {
  const [type, rest] = typed(thread);
  if (type === "text") return "sms";
  if (type === "email" || type === "reply" || type === "mail") return "email";
  const n = Number(rest);
  if (!Number.isInteger(n)) return null;
  const table = type === "dm" ? sql`reach_contacts` : type === "comment" ? sql`comments` : null;
  if (!table) return null;
  const [r] = await rowsOf(db, sql`select platform from ${table} where id = ${n}`);
  return str(r?.platform);
}

/** The thread's own row and who it is with; null when the id names nothing. */
export async function partyOf(db: Queryable, thread: string): Promise<Party | null> {
  const [type, rest] = typed(thread);
  const n = Number(rest);
  if (!Number.isInteger(n)) return null;
  const p: Party = {
    thread,
    type,
    who: null,
    personId: null,
    leadId: null,
    commentId: null,
    enrollmentIds: [],
    smsIds: [],
    reachIds: [],
    commentIds: [],
    emails: [],
    mail: null,
  };
  const email = async (eventId: number) => {
    const [e] = await rowsOf(
      db,
      sql`select te.from_address, te.enrollment_id, e.person_id, e.lead_id, e.to_email,
          coalesce(nullif(concat_ws(' ', pe.first_name, pe.last_name), ''), pe.full_name,
            te.from_address) who
        from thread_events te
        left join enrollments e on e.id = te.enrollment_id
        left join people pe on pe.id = e.person_id
        where te.id = ${eventId}`,
    );
    if (!e) return false;
    p.who = str(e.who);
    p.personId = e.person_id == null ? null : Number(e.person_id);
    p.leadId = e.lead_id == null ? null : Number(e.lead_id);
    if (e.enrollment_id != null) p.enrollmentIds.push(Number(e.enrollment_id));
    for (const a of [e.from_address, e.to_email]) if (a) p.emails.push(String(a).toLowerCase());
    return true;
  };
  if (type === "dm") {
    const [c] = await rowsOf(
      db,
      sql`select id, person_id, coalesce(name, handle) who from reach_contacts where id = ${n}`,
    );
    if (!c) return null;
    p.who = str(c.who);
    p.personId = c.person_id == null ? null : Number(c.person_id);
    p.reachIds.push(n);
  } else if (type === "comment") {
    const [c] = await rowsOf(
      db,
      sql`select c.id, c.contact_id, c.platform, c.author, rc.person_id from comments c
        left join reach_contacts rc on rc.id = c.contact_id where c.id = ${n}`,
    );
    if (!c) return null;
    p.who = str(c.author);
    p.commentId = n;
    p.commentIds.push(n);
    if (c.contact_id != null) p.reachIds.push(Number(c.contact_id));
    if (c.person_id != null) p.personId = Number(c.person_id);
    else Object.assign(p, await handlePerson(db, c.platform, c.author));
  } else if (type === "email") {
    const [i] = await rowsOf(db, sql`select thread_event_id from call_invites where id = ${n}`);
    if (!i || !(await email(Number(i.thread_event_id)))) return null;
  } else if (type === "reply") {
    if (!(await email(n))) return null;
  } else if (type === "text") {
    const [c] = await rowsOf(
      db,
      sql`select id, person_id, coalesce(name, e164) who, email from sms_contacts where id = ${n}`,
    );
    if (!c) return null;
    p.who = str(c.who);
    p.personId = c.person_id == null ? null : Number(c.person_id);
    p.smsIds.push(n);
    if (c.email) p.emails.push(String(c.email).toLowerCase());
  } else if (type === "mail") {
    const [m] = await rowsOf(
      db,
      sql`select id, mailbox, thread_id, from_address,
          coalesce(nullif(from_name, ''), from_address) who
        from watch.mail where id = ${n} and reader = 'mail'`,
    );
    if (!m) return null;
    p.who = str(m.who);
    p.mail = { id: n, mailbox: String(m.mailbox), threadId: String(m.thread_id) };
    p.emails.push(String(m.from_address).toLowerCase());
  } else if (type === "activity") {
    const [a] = await rowsOf(db, sql`select platform, actor from social_activity where id = ${n}`);
    if (!a) return null;
    p.who = str(a.actor);
    Object.assign(p, await handlePerson(db, a.platform, a.actor));
  } else return null;

  if (p.personId === null && p.leadId !== null) {
    const [l] = await rowsOf(db, sql`select person_id from leads where id = ${p.leadId}`);
    if (l?.person_id != null) p.personId = Number(l.person_id);
  }
  const person = p.personId;
  if (person !== null) {
    const [rc, sc, en] = await Promise.all([
      rowsOf(db, sql`select id from reach_contacts where person_id = ${person}`),
      rowsOf(db, sql`select id, email from sms_contacts where person_id = ${person}`),
      rowsOf(
        db,
        sql`select id, to_email from enrollments where person_id = ${person}
          or lead_id in (select id from leads where person_id = ${person})`,
      ),
    ]);
    p.reachIds.push(...ids(rc));
    p.smsIds.push(...ids(sc));
    p.enrollmentIds.push(...ids(en));
    for (const r of [...sc, ...en]) {
      const a = r.email ?? r.to_email;
      if (a) p.emails.push(String(a).toLowerCase());
    }
  }
  p.reachIds = uniq(p.reachIds);
  p.smsIds = uniq(p.smsIds);
  p.enrollmentIds = uniq(p.enrollmentIds);
  if (p.reachIds.length) {
    const cs = await rowsOf(
      db,
      sql`select id from comments where contact_id in ${list(p.reachIds)}`,
    );
    p.commentIds = uniq([...p.commentIds, ...ids(cs)]);
  }
  if (person !== null) {
    // Their comments under a handle linked to them, with no reach contact.
    const cs = await rowsOf(
      db,
      sql`select c.id from comments c join social_handles h
        on h.platform = c.platform and lower(h.handle) = lower(c.author)
        where h.person_id = ${person}`,
    );
    p.commentIds = uniq([...p.commentIds, ...ids(cs)]);
  }
  if (p.enrollmentIds.length) {
    const from = await rowsOf(
      db,
      sql`select distinct lower(from_address) a from thread_events
        where enrollment_id in ${list(p.enrollmentIds)} and from_address is not null`,
    );
    p.emails.push(...from.map((r) => String(r.a)));
  }
  p.emails = uniq(p.emails);
  return p;
}

/** Where a timeline line came from. */
export type EntryChannel = InboxChannel | "booking" | "touch" | "note";

export interface Entry {
  id: string;
  at: string;
  channel: EntryChannel;
  /** Theirs, ours, or a note of the team's (never sent). */
  direction: "in" | "out" | "note";
  /** The site, for a DM, a comment or a touch. */
  platform: string | null;
  /** Who said it: them, the account or inbox that sent ours, the note's writer. */
  who: string | null;
  body: string;
  subject?: string | null;
  /** queued, sent, failed; `asked` waits in To approve. */
  state?: string | null;
  /** Teammates `@`ed in a note. */
  mentions?: string[];
  /** A booking's call time, ISO: the page says it in the viewer's time. */
  start?: string;
}

/** How many lines a conversation carries: the newest. */
export const TIMELINE_MAX = 200;

/** Everything with this person, oldest first; the newest `TIMELINE_MAX`. */
export async function timelineOf(db: Queryable, p: Party): Promise<Entry[]> {
  const out: Entry[] = [];
  const [inMail, outMail, texts, dms, comments, bookings, asked] = await Promise.all([
    p.enrollmentIds.length
      ? rowsOf(
          db,
          sql`select id, coalesce(received_at, created_at) at, subject,
              coalesce(body_text, snippet) body, from_address
            from thread_events where enrollment_id in ${list(p.enrollmentIds)}
              and kind = 'reply'`,
        )
      : [],
    p.enrollmentIds.length
      ? rowsOf(
          db,
          sql`select m.id, m.sent_at at, m.subject, m.body, m.state, e.sender
            from messages m join enrollments e on e.id = m.enrollment_id
            where m.enrollment_id in ${list(p.enrollmentIds)} and m.sent_at is not null`,
        )
      : [],
    p.smsIds.length
      ? rowsOf(
          db,
          sql`select id, direction, body, state, coalesce(received_at, sent_at, created_at) at
            from sms_messages where contact_id in ${list(p.smsIds)} and state <> 'skipped'`,
        )
      : [],
    p.reachIds.length
      ? rowsOf(
          db,
          sql`select m.id, m.direction, m.kind, m.body, m.state,
              coalesce(m.sent_at, m.created_at) at, c.platform, a.handle account
            from reach_messages m join reach_contacts c on c.id = m.contact_id
            left join reach_accounts a on a.id = m.account_id
            where m.contact_id in ${list(p.reachIds)} and m.state not in ('proposed', 'skipped')`,
        )
      : [],
    p.commentIds.length
      ? rowsOf(
          db,
          sql`select id, platform, author, body, at, answer, answered_at, post_title, state
            from comments where id in ${list(p.commentIds)}`,
        )
      : [],
    p.emails.length || p.enrollmentIds.length
      ? rowsOf(
          db,
          sql`select id, state, start, coalesce(booked_at, created_at) at, name
            from call_bookings
            where enrollment_id in ${list(p.enrollmentIds)}
              or lower(email) in ${list(p.emails)}`,
        )
      : [],
    rowsOf(
      db,
      sql`select id, channel, body, asked_by, asked_at at from inbox_replies
        where thread = ${p.thread} and state = 'waiting'`,
    ),
  ]);
  for (const e of inMail)
    out.push({
      id: `te:${e.id}`,
      at: iso(e.at),
      channel: "email",
      direction: "in",
      platform: null,
      who: str(e.from_address) ?? p.who,
      body: String(e.body ?? ""),
      subject: str(e.subject),
    });
  for (const m of outMail)
    out.push({
      id: `m:${m.id}`,
      at: iso(m.at),
      channel: "email",
      direction: "out",
      platform: null,
      who: str(m.sender),
      body: String(m.body ?? ""),
      subject: str(m.subject),
      state: str(m.state),
    });
  for (const t of texts)
    out.push({
      id: `sms:${t.id}`,
      at: iso(t.at),
      channel: "text",
      direction: t.direction === "in" ? "in" : "out",
      platform: null,
      who: t.direction === "in" ? p.who : null,
      body: String(t.body ?? ""),
      state: str(t.state),
    });
  for (const d of dms)
    out.push({
      id: `rm:${d.id}`,
      at: iso(d.at),
      channel: "dm",
      direction: d.direction === "in" ? "in" : "out",
      platform: str(d.platform),
      who: d.direction === "in" ? p.who : str(d.account),
      body: String(d.body ?? "") || (d.kind === "connect" ? "Sent an invite." : ""),
      state: str(d.state),
    });
  for (const c of comments) {
    out.push({
      id: `c:${c.id}`,
      at: iso(c.at),
      channel: "comment",
      direction: "in",
      platform: str(c.platform),
      who: str(c.author),
      body: String(c.body ?? ""),
      subject: str(c.post_title),
    });
    if (c.answer && c.answered_at)
      out.push({
        id: `ca:${c.id}`,
        at: iso(c.answered_at),
        channel: "comment",
        direction: "out",
        platform: str(c.platform),
        who: null,
        body: String(c.answer),
        subject: str(c.post_title),
        state: "sent",
      });
  }
  for (const b of bookings)
    out.push({
      id: `bk:${b.id}`,
      at: iso(b.at),
      channel: "booking",
      direction: "in",
      platform: null,
      who: str(b.name) ?? p.who,
      body: b.state === "cancelled" ? "Cancelled the call." : "Booked a call.",
      state: str(b.state),
      ...(b.start ? { start: iso(b.start) } : {}),
    });
  // Touches the lines above don't already carry: follows, likes, posts of theirs we commented on.
  const seen = new Set(out.map((e) => e.id));
  if (p.personId !== null || p.leadId !== null) {
    const touches = await rowsOf(
      db,
      sql`select t.id, t.ref, h.platform, h.handle, t.kind, t.direction, t.text, t.at, t.account
        from touches t join social_handles h on h.id = t.handle_id
        where ${p.personId === null ? sql`false` : sql`h.person_id = ${p.personId}`}
          or ${p.leadId === null ? sql`false` : sql`h.lead_id = ${p.leadId}`}
        order by t.at desc limit ${TIMELINE_MAX}`,
    );
    for (const t of touches) {
      if (seen.has(String(t.ref))) continue;
      const ours = t.direction === "ours";
      out.push({
        id: `t:${t.id}`,
        at: iso(t.at),
        channel: "touch",
        direction: ours ? "out" : "in",
        platform: str(t.platform),
        who: ours ? str(t.account) : str(t.handle),
        body: String(t.text ?? "") || touchWords(String(t.kind), ours),
      });
    }
  }
  if (p.mail) out.push(...(await mailLines(db, p.mail)));
  for (const n of await inboxNotesOf(db, { threads: [p.thread], personId: p.personId }))
    out.push({
      id: `note:${n.id}`,
      at: n.at.toISOString(),
      channel: "note",
      direction: "note",
      platform: null,
      who: n.by,
      body: n.body,
      mentions: atEmails(n.body),
    });
  for (const a of asked)
    out.push({
      id: `ask:${a.id}`,
      at: iso(a.at),
      channel: a.channel as InboxChannel,
      direction: "out",
      platform: null,
      who: str(a.asked_by),
      body: String(a.body),
      state: "asked",
    });
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-TIMELINE_MAX);
}

/**
 * A mailbox thread's lines: theirs as triage kept them (the summary, never a body) and our replies
 * from the Inbox (`watch.mail_sent`).
 */
async function mailLines(db: Queryable, m: MailThread): Promise<Entry[]> {
  const [ins, outs] = await Promise.all([
    rowsOf(
      db,
      sql`select id, at, subject, coalesce(summary, snippet, '') body,
          coalesce(nullif(from_name, ''), from_address) who
        from watch.mail where mailbox = ${m.mailbox} and thread_id = ${m.threadId}
          and reader = 'mail'`,
    ),
    rowsOf(
      db,
      sql`select id, coalesce(sent_at, created_at) at, subject, body, state, mailbox
        from watch.mail_sent where mailbox = ${m.mailbox} and thread_id = ${m.threadId}`,
    ),
  ]);
  return [
    ...ins.map(
      (e): Entry => ({
        id: `wm:${e.id}`,
        at: iso(e.at),
        channel: "email",
        direction: "in",
        platform: null,
        who: str(e.who),
        body: String(e.body),
        subject: str(e.subject),
      }),
    ),
    ...outs.map(
      (e): Entry => ({
        id: `ws:${e.id}`,
        at: iso(e.at),
        channel: "email",
        direction: "out",
        platform: null,
        who: str(e.mailbox),
        body: String(e.body),
        subject: str(e.subject),
        state: str(e.state),
      }),
    ),
  ];
}

/** A touch with no words, said plainly. */
function touchWords(kind: string, ours: boolean): string {
  const said: Record<string, [string, string]> = {
    follow: ["We followed them.", "They followed us."],
    connect: ["We sent an invite.", "They sent an invite."],
    like: ["We liked their post.", "They liked our post."],
    comment: ["We commented.", "They commented."],
    reply: ["We replied.", "They replied."],
    dm: ["We sent a DM.", "They sent a DM."],
    mention: ["We mentioned them.", "They mentioned us."],
  };
  const pair = said[kind];
  return pair ? pair[ours ? 0 : 1] : ours ? `Our ${kind}.` : `Their ${kind}.`;
}

/** A channel a reply can take: its path's id, and why it can't, when it can't. */
export interface ReplyOption {
  channel: InboxChannel;
  /**
   * The path's own id: `<contact>` for DMs and texts, `<comment>`, `invite:<id>`, `reply:<id>` or
   * `mail:<id>` (the newest of theirs in a mailbox thread).
   */
  target: string;
  label: string;
  platform: string | null;
  /** The thread's own channel: the box starts on it. */
  own: boolean;
  /** Why it can't send there (opted out); null when it can. */
  off: string | null;
  /**
   * What fixes it: `social`, a client connects that platform's account on Account → Social;
   * `mail`, it connects the mailbox on Account → Mail.
   */
  fix?: "social" | "mail" | null;
  /** Mail to a client's mailbox: the mailbox the reply goes out from. */
  from?: string | null;
}

const SITE: Record<string, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  x: "X",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Business Profile",
};

/**
 * Every channel a reply to this person can take, the thread's own first. Email answers in their
 * newest email thread: we never start one from the Inbox.
 */
export async function optionsOf(db: Queryable, p: Party): Promise<ReplyOption[]> {
  const out: ReplyOption[] = [];
  const [type] = typed(p.thread);
  if (p.commentId !== null) {
    const [c] = await rowsOf(db, sql`select platform from comments where id = ${p.commentId}`);
    out.push({
      channel: "comment",
      target: String(p.commentId),
      label: `Comment on ${SITE[String(c?.platform)] ?? "the post"}`,
      platform: str(c?.platform),
      own: true,
      off: null,
    });
  }
  if (p.reachIds.length) {
    const cs = await rowsOf(
      db,
      sql`select id, platform, state from reach_contacts where id in ${list(p.reachIds)}
        order by id`,
    );
    for (const c of cs)
      out.push({
        channel: "dm",
        target: String(c.id),
        label: `${SITE[String(c.platform)] ?? String(c.platform)} DM`,
        platform: str(c.platform),
        own: type === "dm" && p.thread === `dm:${c.id}`,
        off:
          c.state === "opted_out"
            ? "They opted out."
            : c.state === "blocked"
              ? "They blocked us."
              : null,
      });
  }
  if (p.smsIds.length) {
    const cs = await rowsOf(
      db,
      sql`select id, e164, state from sms_contacts where id in ${list(p.smsIds)} order by id`,
    );
    for (const c of cs)
      out.push({
        channel: "text",
        target: String(c.id),
        label: `Text ${String(c.e164)}`,
        platform: null,
        own: p.thread === `text:${c.id}`,
        off: c.state === "opted_out" ? "They texted STOP." : null,
      });
  }
  if (p.enrollmentIds.length) {
    // Their newest email to us; its call invite when one is open, so the yes books too.
    const [e] = await rowsOf(
      db,
      sql`select te.id, te.from_address, ci.id invite, ci.state invite_state
        from thread_events te left join call_invites ci on ci.thread_event_id = te.id
        where te.enrollment_id in ${list(p.enrollmentIds)} and te.kind = 'reply'
        order by coalesce(te.received_at, te.created_at) desc limit 1`,
    );
    if (e) {
      const open = e.invite != null && ["proposed", "needs_you"].includes(String(e.invite_state));
      const target = open ? `invite:${e.invite}` : `reply:${e.id}`;
      out.push({
        channel: "email",
        target,
        label: `Email ${String(e.from_address ?? "")}`.trim(),
        platform: null,
        own: type === "email" || type === "reply",
        off: null,
      });
    }
  }
  if (p.mail) {
    // Their newest in the mailbox thread: the reply answers it, from the mailbox it came to.
    const [m] = await rowsOf(
      db,
      sql`select id, from_address from watch.mail
        where mailbox = ${p.mail.mailbox} and thread_id = ${p.mail.threadId} and reader = 'mail'
        order by at desc, id desc limit 1`,
    );
    if (m)
      out.push({
        channel: "email",
        target: `mail:${m.id}`,
        label: `Email ${String(m.from_address)}`,
        platform: null,
        own: true,
        off: null,
        from: p.mail.mailbox,
      });
  }
  return out.sort((a, b) => Number(b.own) - Number(a.own));
}

/** The conversation's whole read: who, the timeline, the channels a reply can take. */
export async function conversationOf(db: Queryable, thread: string) {
  const p = await partyOf(db, thread);
  if (!p) return null;
  const [entries, options] = await Promise.all([timelineOf(db, p), optionsOf(db, p)]);
  return { thread, who: p.who, personId: p.personId, entries, options };
}
export type Conversation = NonNullable<Awaited<ReturnType<typeof conversationOf>>>;

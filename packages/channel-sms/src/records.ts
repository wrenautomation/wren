/**
 * The console's SMS records: a client's texting threads (O4) and its speed-to-lead runs, read
 * from its own database, and for the Marketing app texted contacts
 * (`marketing_text_contact_records`) and William's words.
 */
import { DIAL_OUTCOMES, outcomeStatus } from "@wren/core/calls";
import {
  date,
  defineRecord,
  duration,
  link,
  name,
  number,
  prose,
  rate,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { formatPhone } from "./phone.js";
import { reviewAsks, type SpeedRun, smsCalls, smsContacts, speedRuns } from "./schema.js";
import { listTemplates, slotsOf } from "./template-store.js";
import { type SmsSequence, sampleFields } from "./templates.js";
import { getThread, listThreads } from "./threads.js";

/** ponytail: rows, not a view: a client's desk holds hundreds of threads; a view past that. */
const THREAD_ROWS = 500;

export const threadRecord = defineRecord({
  id: "sms.thread",
  app: "texts",
  channel: "sms",
  name: { one: "thread", many: "threads" },
  rows: async (db) =>
    (await listThreads(db, { limit: THREAD_ROWS })).map((t) => ({
      id: t.contactId,
      who: t.name ?? t.display,
      company: t.company,
      state: t.state,
      last_at: t.lastAt,
      last_body: t.lastBody,
      direction: t.lastDirection,
      unread: t.unread,
      label: t.disposition,
    })),
  key: "id",
  title: "who",
  subtitle: "company",
  fields: {
    who: name("Who"),
    company: text("Company"),
    direction: status(
      {
        in: { label: "Their turn", tone: "warn" },
        out: { label: "Our turn done", tone: "neutral" },
      },
      "Last",
    ),
    lastBody: text("Last text"),
    lastAt: date("When"),
    unread: number("New"),
    label: status(
      {
        interested: { label: "Interested", tone: "good" },
        question: { label: "Question", tone: "warn" },
        not_interested: { label: "Not interested", tone: "neutral" },
        wrong_person: { label: "Wrong person", tone: "neutral" },
        opt_out: { label: "Opted out", tone: "bad" },
        other: { label: "Other", tone: "neutral" },
      },
      "Reply",
    ),
    state: status(
      {
        new: { label: "New", tone: "neutral" },
        enrolled: { label: "Texting", tone: "good" },
        replied: { label: "Replied", tone: "warn" },
        finished: { label: "Finished", tone: "neutral" },
        stopped: { label: "Stopped", tone: "neutral" },
        opted_out: { label: "Opted out", tone: "bad" },
        unreachable: { label: "Unreachable", tone: "bad" },
      },
      "State",
    ),
  },
  views: [
    {
      id: "waiting",
      label: "Their turn",
      where: { direction: "in" },
      sort: "-lastAt",
      at: "lastAt",
    },
    { id: "unread", label: "New", where: { unread: { gte: 1 } }, sort: "-lastAt", at: "lastAt" },
    { id: "all", label: "All", sort: "-lastAt", at: "lastAt" },
  ],
  actions: ["sms.reply"],
  /** The thread's texts, oldest first; the monthly count is the desk's, not shown here. */
  load: async (db, id) => {
    const t = await getThread(db, Number(id), { now: new Date(), cap: 0 });
    return t ? { messages: t.messages } : null;
  },
});

/** ponytail: rows, as threads: the newest few hundred leads; a view past that. */
const SPEED_ROWS = 500;

const runs = (db: Queryable, id?: number) =>
  db
    .select({ run: speedRuns, follow: smsContacts.state, followWhy: smsContacts.stateReason })
    .from(speedRuns)
    .leftJoin(smsContacts, eq(smsContacts.id, speedRuns.smsContactId))
    .where(id === undefined ? undefined : eq(speedRuns.id, id))
    .orderBy(desc(speedRuns.leadAt))
    .limit(SPEED_ROWS);

/**
 * The call column: an open "Call now" closes when the rep marks it done or the lead books; the
 * stored `call` keeps what the step did.
 */
const callState = (r: Pick<SpeedRun, "call" | "callDoneAt" | "bookedAt">) =>
  r.call !== "alerted" ? r.call : r.bookedAt ? "booked" : r.callDoneAt ? "done" : "alerted";

/**
 * Speed to lead (designs/2026-10-07-speed-to-lead.md): each lead from the door, with each step's
 * state: the first text and how long it took, the call (or "Call now" for the rep, open until
 * they mark it done or the lead books), the follow-up, a booking.
 */
export const speedRecord = defineRecord({
  id: "sms.speed",
  app: "texts",
  channel: "sms",
  name: { one: "lead", many: "leads" },
  rows: async (db) =>
    (await runs(db)).map(({ run: r, follow }) => ({
      id: r.id,
      who: r.name ?? r.email ?? r.phone ?? r.subject,
      phone: r.e164 ?? r.phone,
      tel: r.e164 ? `tel:${r.e164}` : null,
      email: r.email,
      source: r.source,
      lead_at: r.leadAt,
      first_touch: r.firstTouch,
      first_touch_in: r.firstTouchAt
        ? Math.max(0, Math.round((r.firstTouchAt.getTime() - r.leadAt.getTime()) / 1000))
        : null,
      call: callState(r),
      outcome: r.callOutcome,
      follow: r.bookedAt ? "booked" : (follow ?? null),
      booked_at: r.bookedAt,
    })),
  key: "id",
  title: "who",
  subtitle: "phone",
  fields: {
    who: name("Lead"),
    firstTouch: status(
      {
        queued: { label: "Queued", tone: "neutral" },
        sent: { label: "Sent", tone: "good" },
        would_send: { label: "Would send", tone: "neutral" },
        no_consent: { label: "No consent", tone: "warn" },
        no_phone: { label: "No phone", tone: "warn" },
        refused: { label: "Not sent", tone: "bad" },
      },
      "First text",
    ),
    firstTouchIn: duration("Took"),
    call: status(
      {
        alerted: { label: "Call now", tone: "warn" },
        done: { label: "Called", tone: "good" },
        booked: { label: "Booked", tone: "good" },
        dialed: { label: "Dialed", tone: "good" },
        skipped: { label: "Skipped", tone: "neutral" },
      },
      "Call",
    ),
    outcome: status(outcomeStatus(DIAL_OUTCOMES), "Outcome"),
    tel: link("Dial"),
    follow: status(
      {
        enrolled: { label: "Texting", tone: "neutral" },
        replied: { label: "Replied", tone: "good" },
        booked: { label: "Booked", tone: "good" },
        finished: { label: "Finished", tone: "neutral" },
        stopped: { label: "Stopped", tone: "neutral" },
        opted_out: { label: "Opted out", tone: "bad" },
        unreachable: { label: "Unreachable", tone: "bad" },
        new: { label: "Not started", tone: "neutral" },
      },
      "Follow-up",
    ),
    leadAt: date("Came in"),
    bookedAt: date("Booked"),
    source: text("Source"),
    phone: text("Phone"),
    email: text("Email"),
  },
  views: [
    { id: "call", label: "Call now", where: { call: "alerted" }, sort: "-leadAt", at: "leadAt" },
    { id: "done", label: "Done", where: { call: "done" }, sort: "-leadAt", at: "leadAt" },
    { id: "all", label: "All", sort: "-leadAt", at: "leadAt" },
    { id: "booked", label: "Booked", where: { bookedAt: { empty: false } }, sort: "-bookedAt" },
  ],
  actions: ["sms.callDone"],
  /** Each step's state and why, for the record's page. */
  load: async (db, id) => {
    const [got] = await runs(db, Number(id));
    if (!got) return null;
    const { run: r, follow, followWhy } = got;
    return {
      steps: [
        {
          step: "Came in",
          at: r.leadAt,
          said: r.consent ? "texts allowed" : "no texting consent",
          why: r.consentDetail,
        },
        { step: "First text", at: r.firstTouchAt, said: r.firstTouch, why: r.firstTouchDetail },
        { step: "Call", at: r.callAt, said: r.call, why: r.callDetail },
        ...(r.callDoneAt
          ? [
              {
                step: "Called",
                at: r.callDoneAt,
                said: r.callOutcome ?? "done",
                why: r.callDoneBy,
              },
            ]
          : []),
        { step: "Follow-up", at: null, said: follow, why: followWhy },
        { step: "Booked", at: r.bookedAt, said: r.bookedAt ? "booked" : null, why: null },
      ],
    };
  },
});

const CALL_ROWS = 500;

const calls = (db: Queryable, id?: number) =>
  db
    .select({ call: smsCalls, name: smsContacts.name, runBooked: speedRuns.bookedAt })
    .from(smsCalls)
    .leftJoin(smsContacts, eq(smsContacts.id, smsCalls.contactId))
    .leftJoin(
      speedRuns,
      and(
        eq(speedRuns.workflow, "speed_to_lead.steps"),
        eq(speedRuns.subject, sql`'call:' || ${smsCalls.id}`),
      ),
    )
    .where(id === undefined ? undefined : eq(smsCalls.id, id))
    .orderBy(desc(smsCalls.startedAt))
    .limit(CALL_ROWS);

const TEXT_BACK = {
  queued: { label: "Texted back", tone: "good" },
  would_send: { label: "Would send", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  refused: { label: "Not sent", tone: "bad" },
} as const;

/**
 * Missed-call text back (designs/2026-10-07-missed-call-and-reviews.md): each call to the
 * client's numbers, how it ended, the text back and why, a reply and a booking.
 */
export const missedCallRecord = defineRecord({
  id: "sms.call",
  app: "texts",
  channel: "sms",
  name: { one: "call", many: "calls" },
  rows: async (db) =>
    (await calls(db)).map(({ call: c, name: who, runBooked }) => ({
      id: c.id,
      who: who ?? formatPhone(c.fromE164),
      phone: c.fromE164,
      tel: /^\+\d{8,15}$/.test(c.fromE164) ? `tel:${c.fromE164}` : null,
      result: c.result,
      text_back: c.textBack,
      why: c.textBackDetail,
      caller: c.known === null ? null : c.known ? "known" : "new",
      started_at: c.startedAt,
      replied_at: c.repliedAt,
      booked_at: c.bookedAt ?? runBooked,
    })),
  key: "id",
  title: "who",
  subtitle: "phone",
  fields: {
    who: name("Caller"),
    result: status(
      {
        missed: { label: "Missed", tone: "warn" },
        busy: { label: "Busy", tone: "warn" },
        voicemail: { label: "Voicemail", tone: "warn" },
        answered: { label: "Answered", tone: "good" },
      },
      "Call",
    ),
    textBack: status(TEXT_BACK, "Text back"),
    why: text("Why not"),
    caller: status(
      { known: { label: "Known", tone: "neutral" }, new: { label: "New", tone: "neutral" } },
      "Caller",
    ),
    startedAt: date("Called"),
    repliedAt: date("Replied"),
    bookedAt: date("Booked"),
    tel: link("Call back"),
    phone: text("Phone"),
  },
  views: [
    {
      id: "missed",
      label: "Missed",
      where: { result: ["missed", "busy", "voicemail"] },
      sort: "-startedAt",
      at: "startedAt",
    },
    {
      id: "texted",
      label: "Texted back",
      where: { textBack: "queued" },
      sort: "-startedAt",
      at: "startedAt",
    },
    {
      id: "replied",
      label: "Replied",
      where: { repliedAt: { empty: false } },
      sort: "-repliedAt",
      at: "repliedAt",
    },
    {
      id: "booked",
      label: "Booked",
      where: { bookedAt: { empty: false } },
      sort: "-bookedAt",
      at: "bookedAt",
    },
    { id: "all", label: "All", sort: "-startedAt", at: "startedAt" },
  ],
  actions: [],
  /** The call's steps, as speed to lead's. */
  load: async (db, id) => {
    const [got] = await calls(db, Number(id));
    if (!got) return null;
    const { call: c, runBooked } = got;
    const booked = c.bookedAt ?? runBooked;
    return {
      steps: [
        {
          step: "Called",
          at: c.startedAt,
          said: c.known ? "known caller" : "new caller",
          why: null,
        },
        { step: "Call", at: c.endedAt, said: c.result, why: c.cause },
        { step: "Text back", at: c.textBackAt, said: c.textBack, why: c.textBackDetail },
        { step: "Replied", at: c.repliedAt, said: c.repliedAt ? "replied" : null, why: null },
        { step: "Booked", at: booked, said: booked ? "booked" : null, why: null },
      ],
    };
  },
});

const REVIEW_ROWS = 500;

const asks = (db: Queryable, id?: number) =>
  db
    .select()
    .from(reviewAsks)
    .where(id === undefined ? undefined : eq(reviewAsks.id, id))
    .orderBy(desc(reviewAsks.askAt))
    .limit(REVIEW_ROWS);

/**
 * Review requests (designs/2026-10-07-missed-call-and-reviews.md): each customer asked, why
 * not when not, the reminder, whether they opened the link, and their private feedback.
 */
export const reviewRecord = defineRecord({
  id: "sms.review",
  app: "texts",
  channel: "sms",
  name: { one: "review ask", many: "review asks" },
  rows: async (db) =>
    (await asks(db)).map((a) => ({
      id: a.id,
      who: a.name ?? a.email ?? (a.e164 ? formatPhone(a.e164) : a.phone) ?? a.subject,
      phone: a.e164 ?? a.phone,
      source: a.source,
      ask: a.ask,
      why: a.askDetail ?? a.reminderDetail,
      reminder: a.reminder,
      clicks: a.clicks,
      clicked_at: a.clickedAt,
      feedback: a.feedback,
      ask_at: a.askAt,
    })),
  key: "id",
  title: "who",
  subtitle: "phone",
  fields: {
    who: name("Customer"),
    ask: status({ ...TEXT_BACK, queued: { label: "Asked", tone: "good" } }, "Ask"),
    why: text("Why not"),
    reminder: status({ ...TEXT_BACK, queued: { label: "Sent", tone: "good" } }, "Reminder"),
    clicks: number("Clicks"),
    clickedAt: date("Opened"),
    source: status(
      {
        won: { label: "Deal won", tone: "neutral" },
        done: { label: "Appointment", tone: "neutral" },
        paid: { label: "Paid", tone: "neutral" },
        hand: { label: "By hand", tone: "neutral" },
        door: { label: "Webhook", tone: "neutral" },
      },
      "From",
    ),
    feedback: prose("Feedback"),
    askAt: date("Asked"),
    phone: text("Phone"),
  },
  views: [
    { id: "asked", label: "Asked", where: { ask: "queued" }, sort: "-askAt", at: "askAt" },
    {
      id: "clicked",
      label: "Opened",
      where: { clickedAt: { empty: false } },
      sort: "-clickedAt",
      at: "clickedAt",
    },
    {
      id: "feedback",
      label: "Feedback",
      where: { feedback: { empty: false } },
      sort: "-askAt",
      at: "askAt",
    },
    { id: "all", label: "All", sort: "-askAt", at: "askAt" },
  ],
  actions: [],
  load: async (db, id) => {
    const [a] = await asks(db, Number(id));
    if (!a) return null;
    return {
      steps: [
        { step: "Asked", at: a.askAt, said: a.ask, why: a.askDetail },
        { step: "Reminder", at: a.reminderAt, said: a.reminder, why: a.reminderDetail },
        {
          step: "Opened the link",
          at: a.clickedAt,
          said: a.clicks ? `${a.clicks} ${a.clicks === 1 ? "time" : "times"}` : null,
          why: null,
        },
        { step: "Feedback", at: a.feedbackAt, said: a.feedback, why: null },
      ],
    };
  },
});

export const SMS_RECORDS = [threadRecord, speedRecord, missedCallRecord, reviewRecord];

const neutral = (label: string) => ({ label, tone: "neutral" as const });

export const textContactRecord = defineRecord({
  id: "marketing.text_contact",
  app: "marketing",
  channel: "sms",
  name: { one: "texted contact", many: "texted contacts" },
  view: "marketing_text_contact_records",
  key: "id",
  title: "name",
  subtitle: "lastText",
  fields: {
    name: name(),
    state: status({
      new: neutral("New"),
      enrolled: neutral("Texting"),
      replied: { label: "Replied", tone: "good" },
      opted_out: { label: "Opted out", tone: "warn" },
      finished: neutral("Finished"),
      stopped: neutral("Stopped"),
      unreachable: { label: "Unreachable", tone: "bad" },
    }),
    basis: status({ published: neutral("Published number"), opt_in: neutral("Opted in") }, "Base"),
    lastText: text("Last text"),
    lastAt: date("Last"),
    disposition: status(
      {
        interested: { label: "Interested", tone: "good" },
        not_interested: neutral("Not interested"),
        question: neutral("Question"),
        wrong_person: neutral("Wrong person"),
        opt_out: { label: "Opt-out", tone: "warn" },
        other: neutral("Other"),
      },
      "Reply",
    ),
    sent: number("Texts sent"),
    replies: number(),
    replyRate: rate("texted", "Replied", { from: "replied" }),
    waiting: status({ waiting: { label: "Unread", tone: "warn" }, read: neutral("Read") }, "Read"),
    enrolled: date("Started"),
  },
  views: [
    {
      id: "texted",
      label: "All texted",
      where: { sent: { gte: 1 } },
      sort: "-lastAt",
      at: "lastAt",
    },
    {
      id: "waiting",
      label: "Waiting",
      where: { waiting: "waiting" },
      sort: "-lastAt",
      at: "lastAt",
    },
    { id: "replied", label: "Replied", where: { state: "replied" }, sort: "-lastAt", at: "lastAt" },
    { id: "opted_out", label: "Opted out", where: { state: "opted_out" }, sort: "-lastAt" },
  ],
  actions: ["marketing.markRead"],
});

/** Every text William writes; the preview fills `{fields}` with `sender` and sample facts. */
export function textCopyRecord(sequences: Iterable<SmsSequence>, sender: string) {
  const slots = slotsOf(sequences);
  const sample = sampleFields(sender);
  return defineRecord({
    id: "marketing.text_copy",
    app: "marketing",
    channel: "sms",
    name: { one: "text template", many: "text templates" },
    rows: async (db) =>
      (await listTemplates(db, slots, sender)).map((v) => ({
        id: v.key,
        purpose: v.purpose,
        goes: v.goes ?? null,
        body: v.body,
        filled: v.body ? "filled" : "empty",
        parts: v.segments?.parts ?? null,
        fields: [
          ...v.fields.map((f) => `{${f}}`),
          ...(v.mustSayStop ? ["must say STOP"] : []),
          ...(v.mustUse ?? []).map((f) => `must say {${f}}`),
          ...(v.minLength > 1 ? [`at least ${v.minLength} characters`] : []),
        ].join(", "),
        updated_at: v.updatedAt,
        updated_by: v.updatedBy,
      })),
    key: "id",
    title: "purpose",
    subtitle: "body",
    fields: {
      purpose: text("Text"),
      goes: text("Goes"),
      body: prose("Your words"),
      filled: status(
        { filled: { label: "Written", tone: "good" }, empty: neutral("Empty: never goes") },
        "State",
      ),
      parts: number("Billed parts"),
      fields: text("Rules"),
      updatedAt: date("Saved"),
      updatedBy: text("By"),
    },
    // No sort: each sequence's steps, then reminders, then keyword replies.
    views: [
      { id: "all", label: "All" },
      { id: "empty", label: "Empty", where: { filled: "empty" } },
    ],
    actions: ["marketing.textCopy"],
    load: async () => ({ sample }),
  });
}

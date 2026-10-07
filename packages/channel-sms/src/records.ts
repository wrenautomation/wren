/**
 * The console's SMS records: a client's texting threads (O4), read from its own database, and
 * for the Marketing app texted contacts (`marketing_text_contact_records`) and William's words.
 */
import { date, defineRecord, name, number, prose, rate, status, text } from "@wren/core/records";
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

export const SMS_RECORDS = [threadRecord];

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

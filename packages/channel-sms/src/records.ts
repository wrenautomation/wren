/** The console's SMS records: a client's texting threads (O4), read from its own database. */
import { date, defineRecord, name, number, status, text } from "@wren/core/records";
import { getThread, listThreads } from "./threads.js";

/** ponytail: rows, not a view: a client's desk holds hundreds of threads; a view past that. */
const THREAD_ROWS = 500;

export const threadRecord = defineRecord({
  id: "sms.thread",
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

/**
 * The Monitor as console records, in the Inbox app: the mail it read, by where it shows, and the
 * rules it reads by. William's own mail: admins only. Feed items are Learn's.
 */
import { date, defineRecord, link, name, number, status, text } from "@wren/core/records";

const VERDICT = status(
  {
    show: { label: "Show", tone: "warn" },
    hold: { label: "Hold", tone: "neutral" },
    drop: { label: "Drop", tone: "neutral" },
  },
  "Verdict",
);

export const mailRecord = defineRecord({
  id: "watch.mail",
  app: "inbox",
  channel: null,
  needs: "team",
  name: { one: "email", many: "mail" },
  view: "watch.mail_records",
  key: "id",
  title: "subject",
  subtitle: "sender",
  fields: {
    sender: name("From"),
    fromAddress: text("Address"),
    subject: text(),
    summary: text(),
    queue: status({
      needs_you: { label: "Needs you", tone: "bad" },
      held: { label: "Held", tone: "neutral" },
      dropped: { label: "Dropped", tone: "neutral" },
      done: { label: "Done", tone: "good" },
    }),
    verdict: VERDICT,
    why: text("Why"),
    at: date("When"),
    mailbox: text("Inbox"),
    open: link("Open in Gmail"),
    held: number("Held from them"),
    others: link("Their held mail"),
  },
  views: [
    {
      id: "needs_you",
      label: "Needs you",
      where: { queue: "needs_you" },
      sort: "-at",
      at: "at",
    },
    { id: "held", label: "Held", where: { queue: "held" }, sort: "-at", at: "at" },
    { id: "done", label: "Done", where: { queue: "done" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["watch.done", "watch.hide", "watch.show", "watch.sort"],
});

export const ruleRecord = defineRecord({
  id: "watch.rule",
  app: "inbox",
  channel: null,
  needs: "team",
  name: { one: "rule", many: "rules" },
  view: "watch.rule_records",
  key: "id",
  title: "words",
  subtitle: "sender",
  fields: {
    words: text("Rule"),
    sender: text("Sender"),
    subject: text("Subject has"),
    verdict: VERDICT,
    settles: status(
      {
        code: { label: "Code, $0", tone: "good" },
        model: { label: "Model", tone: "neutral" },
      },
      "Settled by",
    ),
    by: text("By"),
    createdAt: date("Added"),
  },
  views: [{ id: "all", label: "All", sort: "-createdAt", at: "createdAt" }],
  actions: ["watch.addRule", "watch.removeRule"],
});

export const WATCH_RECORDS = [mailRecord, ruleRecord];

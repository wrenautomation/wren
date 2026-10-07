/**
 * The Monitor as console records, in the Inbox app: the mail it read, by where it shows, and the
 * rules it reads by; the feed items it scored, and the feeds. William's own mail: admins only.
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

const QUEUE = status({
  needs_you: { label: "Worth reading", tone: "bad" },
  held: { label: "Worth knowing", tone: "neutral" },
  dropped: { label: "Dropped", tone: "neutral" },
  waiting: { label: "Not scored", tone: "warn" },
  done: { label: "Done", tone: "good" },
});

export const itemRecord = defineRecord({
  id: "watch.item",
  app: "inbox",
  channel: null,
  needs: "team",
  name: { one: "feed item", many: "feed items" },
  view: "watch.item_records",
  key: "id",
  title: "title",
  subtitle: "feed",
  fields: {
    title: text(),
    feed: name("Feed"),
    score: number("Score"),
    summary: text(),
    changes: text("Would change"),
    why: text("Why"),
    queue: QUEUE,
    at: date("Published"),
    open: link("Read it"),
  },
  views: [
    {
      id: "needs_you",
      label: "Worth reading",
      where: { queue: "needs_you" },
      sort: "-score",
      at: "at",
    },
    { id: "held", label: "Worth knowing", where: { queue: "held" }, sort: "-at", at: "at" },
    { id: "waiting", label: "Not scored", where: { queue: "waiting" }, sort: "-at", at: "at" },
    { id: "done", label: "Done", where: { queue: "done" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["watch.itemDone"],
});

export const feedRecord = defineRecord({
  id: "watch.feed",
  app: "inbox",
  channel: null,
  needs: "team",
  name: { one: "feed", many: "feeds" },
  view: "watch.feed_records",
  key: "id",
  title: "name",
  subtitle: "url",
  fields: {
    name: name("Feed"),
    url: link("Address"),
    state: status({
      following: { label: "Following", tone: "good" },
      failing: { label: "Failing", tone: "bad" },
      stopped: { label: "Stopped", tone: "neutral" },
    }),
    items: number("Items"),
    shown: number("Worth reading"),
    fetchedAt: date("Read"),
    failure: text("Last error"),
    by: text("By"),
    createdAt: date("Followed"),
  },
  views: [
    { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
    { id: "failing", label: "Failing", where: { state: "failing" } },
  ],
  actions: ["watch.follow", "watch.unfollow"],
});

export const WATCH_RECORDS = [mailRecord, ruleRecord, itemRecord, feedRecord];

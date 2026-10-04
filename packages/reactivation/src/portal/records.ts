/**
 * Reactivation's record types: people, their emails, and what research found. Each reads one view
 * in `./record-views.ts`; `@wren/core/records/serve` answers list, get and export from these.
 */
import {
  cited,
  company,
  date,
  defineRecord,
  link,
  name,
  number,
  percent,
  type RecordType,
  score,
  status,
  text,
  verdict,
} from "@wren/core/records";
import { POINTS } from "../score.js";
import { portalEmails } from "./outbox.js";
import { portalPerson } from "./views.js";

const NOW = {
  moved: { label: "Moved", tone: "good" },
  hiring: { label: "Hiring", tone: "good" },
  there: { label: "Still there", tone: "neutral" },
  left: { label: "Left", tone: "warn" },
  unknown: { label: "Not found yet", tone: "neutral" },
} as const;

/** The most a contact can score: still there, firm hiring, placed and contacted lately. */
const TOP =
  POINTS.stillThere + POINTS.hiringThere + POINTS.placedRecently + POINTS.contactedRecently;

const NEXT = {
  reach_out: { label: "Reach out", tone: "good" },
  keep_warm: { label: "Keep warm", tone: "neutral" },
  none: { label: "Nothing to do", tone: "neutral" },
} as const;

export const person = defineRecord({
  id: "reactivation.person",
  name: { one: "person", many: "people" },
  view: "reactivation_people",
  key: "id",
  title: "name",
  subtitle: "title",
  fields: {
    name: name(),
    title: text(),
    company: company(undefined, { domain: "domain" }),
    now: status(NOW),
    score: score(undefined, { max: TOP }),
    nextStep: status(NEXT, "Next step"),
    lastContact: date("Last contact"),
    owner: name(),
    email: verdict(),
    brief: cited(),
  },
  views: [
    { id: "call", label: "Call first", where: { now: ["moved", "hiring"] }, sort: "-score" },
    { id: "all", label: "Everyone", sort: "-score" },
    { id: "warm", label: "Keep warm", where: { nextStep: ["keep_warm"] }, sort: "-score" },
  ],
  related: [
    { record: "reactivation.email", by: "person" },
    { record: "reactivation.finding", by: "person" },
  ],
  activity: { view: "reactivation_person_activity", by: "person" },
  async load(db, id) {
    const view = await portalPerson(db, Number(id));
    if (!view) return null;
    const { reasons, now, hiring, email } = view.row;
    return { reasons, now, hiring, email, brief: view.brief, sources: view.sources, crm: view.crm };
  },
});

const STATUS = {
  awaiting: { label: "To approve", tone: "warn" },
  approved: { label: "Approved", tone: "neutral" },
  sent: { label: "Sent", tone: "good" },
  skipped: { label: "Skipped", tone: "neutral" },
  stopped: { label: "Stopped", tone: "bad" },
} as const;
const STOPPED = {
  reply: { label: "Replied", tone: "good" },
  manual: { label: "Skipped", tone: "neutral" },
  opt_out: { label: "Opted out", tone: "warn" },
  bounce: { label: "Bounced", tone: "bad" },
  undeliverable: { label: "Undeliverable", tone: "bad" },
  complaint: { label: "Complaint", tone: "bad" },
} as const;

export const email = defineRecord({
  id: "reactivation.email",
  name: { one: "email", many: "emails" },
  view: "reactivation_emails",
  key: "id",
  title: "name",
  subtitle: "subject",
  fields: {
    name: name("To"),
    company: company(undefined, { domain: "domain" }),
    subject: text(),
    status: status(STATUS),
    stopReason: status(STOPPED, "Why it stopped"),
    sent: number("Steps sent"),
    approvedBy: text("Approved by"),
    written: date(),
    lastSent: date("Last sent"),
  },
  views: [
    { id: "approve", label: "To approve", where: { status: ["awaiting"] }, sort: "-written" },
    { id: "approved", label: "Approved", where: { status: ["approved"] }, sort: "-written" },
    { id: "sent", label: "Sent", where: { status: ["sent"] }, sort: "-lastSent" },
    { id: "skipped", label: "Skipped", where: { status: ["skipped"] }, sort: "-written" },
  ],
  actions: ["reactivation.approve", "reactivation.skip"],
  async load(db, id) {
    const [e] = (await portalEmails(db, { id: Number(id), approval: "first" })).rows;
    if (!e) return null;
    const { to, from, opener, followup, why, sources } = e;
    return { to, from, opener, followup, why, sources };
  },
});

const KIND = {
  job_change: { label: "Moved", tone: "good" },
  hiring: { label: "Hiring", tone: "good" },
  left: { label: "Left", tone: "warn" },
  still_there: { label: "Still there", tone: "neutral" },
  post: { label: "Post", tone: "neutral" },
  news: { label: "News", tone: "neutral" },
} as const;

export const finding = defineRecord({
  id: "reactivation.finding",
  name: { one: "finding", many: "findings" },
  view: "reactivation_findings",
  key: "id",
  title: "subject",
  subtitle: "title",
  fields: {
    subject: name("About"),
    kind: status(KIND),
    via: text(),
    title: text("Source"),
    url: link("Link"),
    confidence: percent("Sure"),
    observed: date("Seen"),
  },
  views: [
    { id: "all", label: "Everything", sort: "-observed" },
    { id: "moves", label: "Moves", where: { kind: ["job_change", "left"] }, sort: "-observed" },
    { id: "hiring", label: "Hiring", where: { kind: ["hiring"] }, sort: "-observed" },
  ],
});

export const REACTIVATION_RECORDS: readonly RecordType[] = [person, email, finding];

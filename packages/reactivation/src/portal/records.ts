/**
 * Reactivation's record types: people, their emails, the replies, and what research found. Each
 * reads one view in `./record-views.ts`; `@wren/core/records/serve` answers list, get and export
 * from these. Settings are built per client from what it plugged in.
 */

import type { Client } from "@wren/core/clients";
import {
  actor,
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
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { POINTS } from "../score.js";
import { personTouches } from "./journey.js";
import { portalEmails } from "./outbox.js";
import { portalSetup } from "./setup.js";
import { portalPerson } from "./views.js";

const NOW = {
  moved: { label: "Moved", tone: "good" },
  hiring: { label: "Hiring", tone: "good" },
  there: { label: "Still there", tone: "neutral" },
  left: { label: "Left", tone: "warn" },
  conflict: { label: "Sources disagree", tone: "warn" },
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
    reason: text("Why this score"),
    brief: cited("Why call now"),
  },
  views: [
    { id: "call", label: "Call first", where: { now: ["moved", "hiring"] }, sort: "-score" },
    { id: "all", label: "Everyone", sort: "-score" },
    { id: "warm", label: "Keep warm", where: { nextStep: ["keep_warm"] }, sort: "-score" },
    { id: "doubt", label: "Sources disagree", where: { now: ["conflict"] }, sort: "-score" },
  ],
  related: [
    { record: "reactivation.email", by: "person" },
    { record: "reactivation.finding", by: "person" },
  ],
  activity: { view: "reactivation_person_activity", by: "person" },
  actions: ["reactivation.called", "reactivation.settle"],
  async load(db, id) {
    const view = await portalPerson(db, Number(id));
    if (!view) return null;
    const { reasons, now, hiring, email, oldEmail } = view.row;
    return {
      reasons,
      now,
      hiring,
      email,
      oldEmail,
      brief: view.brief,
      sources: view.sources,
      crm: view.crm,
      touches: await personTouches(db, Number(id)),
    };
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
    approvedBy: actor("Approved by"),
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
    const { personId, to, from, opener, followup, why, sources } = e;
    return { personId, to, from, opener, followup, why, sources };
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

const REPLY = {
  warm: { label: "Interested", tone: "warn" },
  booked: { label: "Booked", tone: "good" },
  other: { label: "Other", tone: "neutral" },
} as const;
const SAID = {
  interested: { label: "Interested", tone: "good" },
  meeting_booked: { label: "Wants a meeting", tone: "good" },
  not_now: { label: "Not now", tone: "neutral" },
  referral: { label: "Referred someone", tone: "neutral" },
  wrong_person: { label: "Wrong person", tone: "neutral" },
  not_interested: { label: "Not interested", tone: "neutral" },
  other: { label: "Other", tone: "neutral" },
} as const;

export const reply = defineRecord({
  id: "reactivation.reply",
  name: { one: "reply", many: "replies" },
  view: "reactivation_replies",
  key: "id",
  title: "name",
  subtitle: "subject",
  fields: {
    name: name("From"),
    company: company(undefined, { domain: "domain" }),
    subject: text(),
    status: status(REPLY),
    disposition: status(SAID, "They said"),
    handedTo: text("Passed to"),
    received: date(),
    booked: date("Meeting booked"),
  },
  views: [
    { id: "warm", label: "Interested", where: { status: ["warm"] }, sort: "-received" },
    { id: "booked", label: "Booked", where: { status: ["booked"] }, sort: "-booked", at: "booked" },
    { id: "all", label: "All replies", sort: "-received", at: "received" },
  ],
  actions: ["reactivation.book"],
  async load(db, id) {
    const [r] = await db.execute<{ text: string | null; from_address: string | null }>(sql`
      select coalesce(body_text, snippet, '') "text", from_address
      from thread_events where id = ${Number(id)} and kind = 'reply'`);
    return r ? { text: r.text ?? "", from: r.from_address } : null;
  },
});

const PART = {
  crm: { label: "Your CRM", tone: "neutral" },
  emails: { label: "Emails", tone: "neutral" },
  recruiters: { label: "Recruiters", tone: "neutral" },
  research: { label: "Research", tone: "neutral" },
  sending: { label: "Sending", tone: "neutral" },
} as const;

/** The profile lines a client may reword; sending rules stay Wren's to change. */
export const EDITABLE = ["emails.sells", "emails.voice", "emails.signature"] as const;

/** "bullhorn" -> "Bullhorn"; the names people know these by. */
const NAMES: Record<string, string> = { linkedin: "LinkedIn", bullhorn: "Bullhorn", csv: "CSV" };
const named = (id: string) => NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
const day = (at: string | null | undefined) =>
  at
    ? new Date(at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
const num = (n: number) => n.toLocaleString("en-US");

/** What a client plugged in, a row per setting, for Setup. Ids sort in the page's order. */
async function settingRows(db: Queryable, client: Client) {
  const s = await portalSetup(db, client);
  const p = s.profile;
  const rows: [string, keyof typeof PART, string, string][] = [
    ["crm.format", "crm", "Format", s.crm ? `${named(s.crm.format)}, ${num(s.crm.rows)} rows` : ""],
    ["crm.loaded", "crm", "Loaded", day(s.crm?.importedAt)],
    ["crm.taken", "crm", "Taken on", day(s.crm?.asOf)],
    ["emails.sells", "emails", "What you place", p?.sells ?? ""],
    ["emails.signature", "emails", "Signature", p?.signature ?? ""],
    ["emails.voice", "emails", "Voice", p?.voice ?? ""],
    ...(p?.recruiters ?? []).map((r, i): [string, keyof typeof PART, string, string] => [
      `recruiters.${i}`,
      "recruiters",
      r.name,
      r.email,
    ]),
    ["research.public", "research", "Public pages", "Company sites and job posts"],
    ...s.research.map((site): [string, keyof typeof PART, string, string] => [
      `research.${site}`,
      "research",
      named(site),
      `A ${named(site)} research account`,
    ]),
    [
      "sending.approval",
      "sending",
      "Your OK",
      s.sending.approval === "first"
        ? "You approve the first batch. After that, new drafts go out on their own."
        : "You approve every batch before it goes out.",
    ],
    ["sending.drafts", "sending", "New drafts", `Up to ${num(s.sending.perDay)} a day`],
    ["sending.live", "sending", "Sending", s.sending.live ? "On" : "Off until you say go"],
    [
      "sending.senders",
      "sending",
      "Sends from",
      s.sending.senders.map((x) => `${x.name} <${x.address}>`).join(", "),
    ],
  ];
  return rows
    .filter(([, , , value]) => value)
    .map(([id, part, label, value]) => ({ id, part, label, value }));
}

/** Setup's rows for one client: its rows read the client, so the type is made per request. */
export const settingOf = (client: Client) =>
  defineRecord({
    id: "reactivation.setting",
    name: { one: "setting", many: "settings" },
    rows: (db) => settingRows(db, client),
    key: "id",
    title: "label",
    fields: {
      label: text("Setting"),
      value: text(),
      part: status(PART, "Part"),
    },
    views: [{ id: "all", label: "Setup" }],
    actions: ["reactivation.change"],
  });

export const REACTIVATION_RECORDS: readonly RecordType[] = [person, email, reply, finding];

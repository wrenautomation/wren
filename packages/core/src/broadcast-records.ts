/**
 * Broadcasts as console records (designs/2026-10-14-customerio-audit.md, B6), the People app's:
 * each broadcast with how far it got (`people.broadcast`), and each person it went to
 * (`people.recipient`). Changes go through PeopleConsole's broadcast handlers. Views in
 * `./broadcasts-schema.ts`; the logic in `./broadcasts.ts`.
 */
import type { Queryable } from "@wren/db";
import { type BroadcastResults, broadcastById, broadcastResults } from "./broadcasts.js";
import {
  cued,
  date,
  defineRecord,
  link,
  name,
  number,
  prose,
  SYSTEM,
  status,
  text,
} from "./records.js";

export const BROADCAST_CHANNEL_STATES = cued({
  email: { label: "Email", tone: "neutral" },
  sms: { label: "Text", tone: "neutral" },
} as const);

export const BROADCAST_STATE_STATES = cued({
  draft: { label: "Draft", tone: "neutral" },
  waiting: { label: "To approve", tone: "warn" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
  canceled: { label: "Canceled", tone: "neutral" },
} as const);

export const RECIPIENT_STATE_STATES = cued({
  due: { label: "Due", tone: "neutral" },
  held: { label: "Held by cap", tone: "warn" },
  sending: { label: "Sending", tone: "neutral" },
  queued: { label: "Handed to texts", tone: "neutral" },
  sent: { label: "Sent", tone: "good" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
} as const);

/** What a broadcast's page shows past the row: its results on the sent log's ladder. */
export interface BroadcastDetail {
  results: BroadcastResults | null;
}

export async function broadcastDetail(db: Queryable, id: string): Promise<BroadcastDetail | null> {
  const b = await broadcastById(db, Number(id));
  if (!b) return null;
  return { results: b.startedAt ? await broadcastResults(db, b.id) : null };
}

/** The handlers a broadcast's buttons call; Save is its editor's. */
export const BROADCAST_ACTIONS = [
  "people.broadcastSave",
  "people.broadcastTest",
  "people.broadcastAsk",
  "people.broadcastApprove",
  "people.broadcastDecline",
  "people.broadcastCancel",
  "people.broadcastRestore",
] as const;

export const broadcastRecord = defineRecord({
  id: "people.broadcast",
  app: "people",
  channel: { field: "channel" },
  name: { one: "broadcast", many: "broadcasts" },
  view: "broadcast_records",
  key: "id",
  title: "name",
  subtitle: "segment",
  fields: {
    name: name("Name"),
    channel: status(BROADCAST_CHANNEL_STATES, "Channel"),
    state: status(BROADCAST_STATE_STATES, "State"),
    segment: text("Segment"),
    topic: text("Topic"),
    when: date("When"),
    people: number("People"),
    sent: number("Sent"),
    waiting: number("Waiting"),
    skipped: number("Skipped"),
    failed: number("Failed", { listed: false }),
    subject: text("Subject", { listed: false }),
    body: prose("Words", { listed: false }),
    sendAt: date("Picked time", { listed: false }),
    zone: text("Time zone", { listed: false }),
    note: text("Note", { listed: false }),
    by: text("Made by", { listed: false }),
    decidedBy: text("Approved by", { listed: false }),
    testedTo: text("Last test to", { listed: false }),
    testedAt: date("Last test", { listed: false }),
    sentLog: link("In the sent log"),
    recipients: link("Its people", { listed: false }),
    segmentId: number("Segment id", { listed: false, group: SYSTEM }),
    createdAt: date("Made", { listed: false }),
  },
  quick: ["state", "channel"],
  views: [
    { id: "all", label: "All", sort: "-when", at: "when" },
    {
      id: "upcoming",
      label: "Upcoming",
      where: { state: ["draft", "waiting", "scheduled", "sending"] },
      sort: "when",
      at: "when",
    },
    { id: "sent", label: "Sent", where: { state: "sent" }, sort: "-when", at: "when" },
  ],
  actions: BROADCAST_ACTIONS,
  load: broadcastDetail,
});

export const recipientRecord = defineRecord({
  id: "people.recipient",
  app: "people",
  channel: { field: "channel" },
  name: { one: "recipient", many: "recipients" },
  view: "broadcast_recipient_records",
  key: "id",
  title: "name",
  subtitle: "broadcast",
  fields: {
    name: name("Person"),
    broadcast: text("Broadcast"),
    channel: status(BROADCAST_CHANNEL_STATES, "Channel", { listed: false }),
    address: text("To"),
    state: status(RECIPIENT_STATE_STATES, "State"),
    why: text("Why"),
    dueAt: date("Due"),
    sentAt: date("Sent"),
    zone: text("Their zone", { listed: false }),
    profileLink: link("Profile"),
    broadcastId: number("Broadcast id", { listed: false }),
    profileId: number("Profile id", { listed: false }),
  },
  quick: ["state"],
  views: [{ id: "all", label: "All", sort: "dueAt" }],
});

/** The People app's broadcast records. */
export const BROADCAST_RECORDS = [broadcastRecord, recipientRecord];

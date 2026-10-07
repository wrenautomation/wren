/**
 * Opt-in marketing as console records (`./records.ts`): subscribers and topics. Views in
 * `./marketing-views.ts`; the writers in `./marketing.ts`. No action marks anyone as consented.
 */
import { actor, date, defineRecord, number, rate, status, text } from "./records.js";

const CHANNELS = {
  email: { label: "Email", tone: "neutral" },
  sms: { label: "SMS", tone: "neutral" },
} as const;

export const subscriberRecord = defineRecord({
  id: "marketing.subscriber",
  app: "marketing",
  channel: "email",
  name: { one: "subscriber", many: "subscribers" },
  view: "marketing_subscriber_records",
  key: "id",
  title: "address",
  subtitle: "canSend",
  fields: {
    address: text(),
    channel: status(CHANNELS),
    topics: text(),
    state: status({
      confirmed: { label: "Confirmed", tone: "good" },
      pending: { label: "Pending", tone: "neutral" },
      paused: { label: "Paused", tone: "neutral" },
      lapsed: { label: "Never confirmed", tone: "neutral" },
      withdrawn: { label: "Withdrawn", tone: "warn" },
      off: { label: "Off everything", tone: "bad" },
    }),
    source: status({
      lander_form: { label: "Lander form", tone: "neutral" },
      meta_lead_form: { label: "Meta lead form", tone: "neutral" },
      sms_keyword: { label: "Text keyword", tone: "neutral" },
      calcom_booking: { label: "Cal.com booking", tone: "neutral" },
      preference_center: { label: "Preference center", tone: "neutral" },
    }),
    canSend: text("Can send"),
    since: date(),
    lastSent: date("Last sent"),
    frequency: status(
      {
        as_sent: { label: "As sent", tone: "neutral" },
        weekly: { label: "Weekly at most", tone: "neutral" },
        monthly: { label: "Monthly at most", tone: "neutral" },
      },
      "Cap",
    ),
    actor: actor("Last change by"),
  },
  views: [
    {
      id: "confirmed",
      label: "Confirmed",
      where: { state: "confirmed" },
      sort: "-since",
      at: "since",
    },
    { id: "pending", label: "Pending", where: { state: "pending" }, sort: "-since", at: "since" },
    {
      id: "withdrawn",
      label: "Withdrawn",
      where: { state: ["withdrawn", "off", "lapsed"] },
      sort: "-since",
    },
    { id: "paused", label: "Paused", where: { state: "paused" }, sort: "-since" },
    { id: "all", label: "All", sort: "-since", at: "since" },
  ],
  activity: { view: "marketing_subscriber_activity", by: "subscriber" },
});

export const topicRecord = defineRecord({
  id: "marketing.topic",
  app: "marketing",
  channel: "email",
  name: { one: "topic", many: "topics" },
  view: "marketing_topic_records",
  key: "id",
  title: "publicName",
  subtitle: "internal",
  fields: {
    publicName: text("Public name"),
    internal: text("Internal name", { from: "id" }),
    channel: status(CHANNELS),
    cadence: text(),
    shown: status(
      {
        shown: { label: "In preference center", tone: "good" },
        hidden: { label: "Hidden", tone: "neutral" },
      },
      "Preference center",
    ),
    confirmed: number(),
    netWeek: number("Net this week"),
    confirms: rate("signups", "Confirm rate"),
    signups: number(),
    leaves: rate("sends", "Unsubscribes per send"),
    sends: number(),
    lastSent: date("Last send"),
  },
  views: [{ id: "all", label: "All", sort: "-confirmed" }],
});

export const MARKETING_RECORDS = [subscriberRecord, topicRecord];

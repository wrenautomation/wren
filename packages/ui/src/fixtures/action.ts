/**
 * Actions and form boxes for the action stories and tests: the actions a record offers, the form
 * fields of every type, and a `Call` that answers, never answers or fails. Synthetic data only.
 */
import type { Action, Call, FormField } from "../action.js";
import { later } from "./load.js";
import { WORST } from "./worst.js";

/** Asks why before it runs: the text box, empty. */
export const PAUSE: Action = {
  id: "pause",
  label: "Pause",
  handler: "email/pause",
  ask: { field: "reason", label: "Why?" },
};

/** Runs at once, with ten seconds to undo. */
export const APPROVE: Action = {
  id: "approve",
  label: "Approve",
  handler: "demo/approve",
  undo: "demo/unapprove",
  done: () => "Approved.",
};

/** No undo and it does not set a record aside: it asks first. */
export const CLOSE: Action = {
  id: "close",
  label: "Close",
  handler: "demo/close",
  confirm: "Close these leads?",
  done: () => "Closed.",
};

/** The form action: it makes a record, so it asks for its fields. */
export const INVITE: Action = {
  id: "invite",
  label: "Add lead",
  handler: "demo/add",
  form: [
    { field: "name", label: "Name" },
    {
      field: "city",
      label: "City",
      type: "combo",
      choices: { handler: "demo/cities", list: (a) => a as string[] },
    },
    { field: "note", label: "Note", type: "long", optional: true },
  ],
};

/** The four, as a record's page offers them. */
export const ACTIONS: readonly Action[] = [APPROVE, CLOSE, PAUSE, INVITE];

/** Long label and confirm sentence, for the dialog's worst case. */
export const WORST_CLOSE: Action = {
  ...CLOSE,
  label: WORST.longLabel,
  confirm: `${WORST.longText.slice(0, 160)}?`,
};

/** A form's fields as a person types them: one of most types, nested, optional and required. */
export const FORM_FIELDS: FormField[] = [
  { field: "day", label: "Day", type: "date" },
  { field: "note", label: "Note", optional: true },
  { field: "limit", label: "Limit", type: "number", optional: true },
  { field: "dryRun", label: "Dry run", type: "switch" },
  { field: "ids", label: "Ids", type: "lines", optional: true },
  { field: "personIds", label: "Person ids", type: "numbers", optional: true },
  { field: "recheck.olderThanDays", label: "Recheck.Days", type: "number", optional: true },
  { field: "extra", label: "Extra", type: "json", optional: true },
];

/** The types `FORM_FIELDS` leaves out. */
export const MORE_FIELDS: FormField[] = [
  { field: "body", label: "Body", type: "long", hint: "Plain words; no markup." },
  { field: "site", label: "Site", type: "url" },
  { field: "photo", label: "Photo", type: "file", optional: true },
  {
    field: "kind",
    label: "Kind",
    type: "select",
    options: ["post", "reply"],
    labels: { post: "A new post", reply: "A reply" },
  },
  {
    field: "days",
    label: "Days",
    type: "pick",
    options: ["mon", "tue", "wed"],
    labels: { mon: "Mon", tue: "Tue", wed: "Wed" },
  },
  {
    field: "city",
    label: "City",
    type: "combo",
    choices: { handler: "demo/cities", list: (a) => a as string[] },
  },
];

/** Values for the boxes above, as typed. */
export const FORM_VALUES: Record<string, string> = {
  day: "2026-10-09",
  note: "Call back on Tuesday.",
  limit: "25",
  dryRun: "true",
  ids: "lead-1\nlead-2",
  personIds: "1\n2",
  "recheck.olderThanDays": "30",
  extra: '{"keep":[1,2]}',
  body: "Thanks for the quick reply.",
  site: "https://example.com/pricing",
  kind: "reply",
  days: "mon,wed",
  city: "Leeds",
};

/** Boxes with the longest labels, hints and choices anything can give them. */
export const WORST_FIELDS: FormField[] = [
  { field: "a", label: WORST.longLabel, hint: WORST.longText },
  { field: "b", label: WORST.nonLatin, type: "long", hint: WORST.rtl },
  {
    field: "c",
    label: WORST.emoji,
    type: "select",
    options: [WORST.longName, WORST.email, WORST.url],
  },
  {
    field: "d",
    label: WORST.longName,
    type: "pick",
    options: ["one", "two", "three", "four"],
    labels: { one: WORST.longLabel, two: WORST.nonLatin, three: WORST.emoji, four: WORST.email },
  },
  { field: "e", label: WORST.longLabel, type: "switch" },
];

/** What the combos read: cities, from `demo/cities`. */
export const CITIES = ["Bath", "Bristol", "Leeds", "York"];

export type Reply = "ok" | "pending" | "fails";

/**
 * A `Call` for a story: answers after `ms` (`done` the ids it was sent, `demo/cities` the cities),
 * never answers, or fails the way a down server does.
 */
export function fakeCall(how: Reply = "ok", ms = 300): Call {
  return (handler, input) => {
    if (how === "pending") return new Promise(() => {});
    if (how === "fails")
      return Promise.reject(
        Object.assign(new Error("The server could not answer."), { status: 500 }),
      );
    const data = handler === "demo/cities" ? CITIES : { done: input.ids ?? [] };
    return later(data, ms);
  };
}

/**
 * Logic nodes and triggers (designs/2026-10-06-workflow-editor.md, Edit like n8n): parts every
 * workflow may add on the canvas, outside the Shop. Each takes any event kind, set by its `kind`
 * setting, so its ports follow what it's wired to. If asks the rule model; Switch reads a field;
 * Wait holds what leaves it; Split sends a fixed share each way by subject; Merge joins two
 * wires. A hook trigger is the door into a node. Pure, so the web reads it too.
 */
import type { Effect, EventKind, Port } from "./components.js";
import { type FieldMap, fieldMapOfWith, fieldMapProblems, HOOK_PRESETS } from "./door.js";
import type { SpineEvent, Step } from "./spine.js";
import { canonicalZone, wallClock, zonedInstant } from "./time.js";
import {
  bodyProblem,
  fillText,
  headersOf,
  keepOf,
  urlProblem,
  WEBHOOK_METHODS,
} from "./webhook-events.js";
import type { WorkflowNode } from "./workflows.js";

/** Every event kind, as `EVENT_KINDS` names them (a test keeps the two the same). */
export const KINDS = [
  "firm",
  "person",
  "lead",
  "reply",
  "call",
  "form",
  "post",
  "video",
  "client",
  "invoice",
  "mail",
  "comment",
  "item",
  "account",
  "deal",
] as const satisfies readonly EventKind[];

/** One setting on a logic node: a line he types, a few lines, a number, or one of a few. */
export interface LogicSetting {
  field: string;
  label: string;
  type: "text" | "long" | "number" | "choice";
  options?: readonly string[];
  /** A choice's words, by option; the option itself when unset. */
  labels?: Readonly<Record<string, string>>;
  hint?: string;
  /** What a new node starts with. */
  start?: string | number;
  /** Shown only while these settings hold: "until" only when the mode is until. */
  shows?: Readonly<Record<string, string>>;
}

export interface LogicPart {
  /** "logic.if", "trigger.hook". */
  id: string;
  name: string;
  blurb: string;
  icon: string;
  /** Actions reach outside Wren: Send webhook. */
  group: "logic" | "trigger" | "action";
  /** Runs on the spine. Not yet: drawn faded, "In development", and publishing refuses it. */
  ready: boolean;
  /** What it does outside Wren, as a part's effects: publishing one is William's yes. */
  effects?: readonly Effect[];
  settings: readonly LogicSetting[];
  ports(w: Readonly<Record<string, string | number>>): { in: Port[]; out: Port[] };
  /** What a node of it says on the canvas, from its settings. */
  says(w: Readonly<Record<string, string | number>>): string;
}

const kindOf = (w: Readonly<Record<string, string | number>>, or: EventKind = "lead"): EventKind =>
  (KINDS as readonly string[]).includes(String(w.kind)) ? (w.kind as EventKind) : or;
const KIND: LogicSetting = {
  field: "kind",
  label: "Event kind",
  type: "choice",
  options: KINDS,
  start: "lead",
};
const one = (id: string, label: string, kind: EventKind): Port => ({ id, label, kind });
const text = (v: unknown) => String(v ?? "").trim();

/** "Booked, Not now" as port ids and labels: up to 6 cases, each once. */
export function casesOf(raw: unknown): { id: string; label: string }[] {
  const seen = new Set<string>();
  return text(raw)
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 6)
    .flatMap((label) => {
      const id =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^[^a-z]+|_+$/g, "")
          .slice(0, 30) || "case";
      if (seen.has(id) || id === "other") return [];
      seen.add(id);
      return [{ id, label }];
    });
}

/** A share of 1 to 99 percent for Split's `a` side; 50 when unread. */
export const shareOf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 50;
};

/** A trigger: no inputs, one output of `kind`, entered by the spine when its event happens. */
const trigger = (
  id: string,
  name: string,
  blurb: string,
  icon: string,
  kind: EventKind,
  settings: readonly LogicSetting[],
  says: (w: Readonly<Record<string, string | number>>) => string,
): LogicPart => ({
  id: `trigger.${id}`,
  name,
  blurb,
  icon,
  group: "trigger",
  ready: true,
  settings,
  ports: () => ({ in: [], out: [one("out", name.toLowerCase(), kind)] }),
  says,
});

/** A schedule's zone when it names none: clients keep no zone yet. */
export const SCHEDULE_ZONE = "America/New_York";
const HH_MM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** Every N hours: 1 to 168. */
const hoursOf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 168 ? n : null;
};

/**
 * A schedule's next slot strictly after `after`, or null when its settings don't read. Every day
 * at HH:MM in its zone, or every N hours on the hour (counted from midnight UTC).
 */
export function nextSlot(w: Readonly<Record<string, string | number>>, after: Date): Date | null {
  if (text(w.every) === "hours") {
    const n = hoursOf(w.hours);
    if (!n) return null;
    const step = n * 3_600_000;
    return new Date((Math.floor(after.getTime() / step) + 1) * step);
  }
  const hm = HH_MM.exec(text(w.at) || "09:00");
  const zone = canonicalZone(text(w.zone) || SCHEDULE_ZONE);
  if (!hm || !zone) return null;
  const day = wallClock(zone, after);
  // Today's slot, else tomorrow's (a calendar day on, so DST never skips or doubles one).
  for (let d = 0; d < 3; d++) {
    const on = new Date(Date.UTC(day.year, day.month - 1, day.day + d));
    const at = zonedInstant(
      zone,
      on.getUTCFullYear(),
      on.getUTCMonth() + 1,
      on.getUTCDate(),
      Number(hm[1]),
      Number(hm[2]),
    );
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** What each fired trigger's event is about, and which nodes hear it (`triggerHears`). */
export type TriggerFacts =
  | { trigger: "trigger.reply"; channel: "email" | "sms" | "dm" }
  | { trigger: "trigger.booking"; change: "booked" | "cancelled" }
  | { trigger: "trigger.flag"; change: "raised" | "cleared"; side: "risk" | "opportunity" }
  | { trigger: "trigger.payment"; change: "paid" }
  | { trigger: "trigger.deal"; change: "moved" | "won" | "lost"; stage: string };

/** A Reply or Booking node hears this event by its settings. */
export function triggerHears(n: WorkflowNode, f: TriggerFacts): boolean {
  if (n.uses !== f.trigger) return false;
  const w = n.with ?? {};
  if (f.trigger === "trigger.reply") {
    const on = text(w.channel) || "any";
    return on === "any" || on === f.channel;
  }
  if (f.trigger === "trigger.payment") return true;
  if (f.trigger === "trigger.deal") {
    const on = text(w.on) || "any";
    const stage = text(w.stage);
    return (on === "any" || on === f.change) && (!stage || stage === f.stage);
  }
  if (f.trigger === "trigger.flag") {
    const on = text(w.on) || "raised";
    const side = text(w.side) || "any";
    return (on === "any" || on === f.change) && (side === "any" || side === f.side);
  }
  const on = text(w.on) || "booked";
  return on === "any" || on === f.change;
}

/** What a Wait may wait until: an event fired at the spine about the same subject. */
export const UNTILS = ["reply", "booking", "answer", "cancelled"] as const;
export type Until = (typeof UNTILS)[number];
/** What a Wait may wait until, as its panel offers it. */
export const UNTIL_LABELS: Record<Until, string> = {
  reply: "A reply",
  booking: "A booking",
  answer: "A reply or a booking",
  cancelled: "A cancelled call",
};
/** "a reply": what a Wait waits until, in a sentence. */
export const UNTIL_WORDS: Record<Until, string> = {
  reply: "a reply",
  booking: "a booking",
  answer: "an answer",
  cancelled: "a cancelled call",
};
const UNTIL_PORT: Record<Until, string> = {
  reply: "replied",
  booking: "booked",
  answer: "answered",
  cancelled: "cancelled",
};
/** The waits a fired event lets go: its own, and "a reply or a booking" for either of those. */
export const untilsFreedBy = (fired: Until): Until[] =>
  fired === "reply" || fired === "booking" ? [fired, "answer"] : [fired];
export const isUntil = (v: unknown): v is Until =>
  (UNTILS as readonly string[]).includes(String(v));
/** A Wait's until, when its mode is until; null for a timed one. */
const untilSet = (w: Readonly<Record<string, string | number>>): Until | null =>
  text(w.mode) === "until" ? (isUntil(w.until) ? w.until : "reply") : null;

/** What a fired event is, as a Wait waits until it; null when no Wait waits for it (a flag). */
export const untilOfFacts = (f: TriggerFacts): Until | null =>
  f.trigger === "trigger.reply"
    ? "reply"
    : f.trigger === "trigger.flag" ||
        f.trigger === "trigger.payment" ||
        f.trigger === "trigger.deal"
      ? null
      : f.change === "booked"
        ? "booking"
        : "cancelled";

/**
 * What a subject is about, so an event about the same thing finds it: the subject past its kind,
 * lower case. A text lead `lead:sms:42` and its reply `reply:sms:42` are both `sms:42`, as
 * `replyFired` and the channels' touch steps say them.
 */
export const aboutOf = (subject: string): string =>
  subject.slice(subject.indexOf(":") + 1).toLowerCase();

const CHANNEL_WORDS: Record<string, string> = {
  any: "any channel",
  email: "email",
  sms: "texts",
  dm: "DMs",
};

export const LOGIC: readonly LogicPart[] = [
  {
    id: "logic.if",
    name: "If",
    blurb: "Sends each event yes or no by a rule in plain words.",
    icon: "split",
    group: "logic",
    ready: true,
    settings: [
      { field: "when", label: "Rule", type: "text", hint: "They asked about price" },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [one("yes", "yes", kindOf(w)), one("no", "no", kindOf(w))],
    }),
    says: (w) => (text(w.when) ? `If ${text(w.when)}` : "Set a rule"),
  },
  {
    id: "logic.switch",
    name: "Switch",
    blurb: "Sends each event down the case its field matches, else other.",
    icon: "split",
    group: "logic",
    ready: true,
    settings: [
      { field: "field", label: "Field", type: "text", hint: "data.stage" },
      { field: "cases", label: "Cases", type: "text", hint: "Booked, Not now" },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [
        ...casesOf(w.cases).map((c) => one(c.id, c.label, kindOf(w))),
        one("other", "other", kindOf(w)),
      ],
    }),
    says: (w) => (text(w.field) ? `By ${text(w.field)}` : "Set a field"),
  },
  {
    id: "logic.wait",
    name: "Wait",
    blurb: "Holds each event for a time, or until a reply or a booking, then sends it on.",
    icon: "clock",
    group: "logic",
    ready: true,
    settings: [
      {
        field: "mode",
        label: "Wait for",
        type: "choice",
        options: ["time", "until"],
        labels: { time: "A time", until: "Until something happens" },
        start: "time",
      },
      {
        field: "for",
        label: "How long",
        type: "text",
        hint: "2 days",
        start: "1 day",
        shows: { mode: "time" },
      },
      {
        field: "until",
        label: "Until",
        type: "choice",
        options: UNTILS,
        labels: UNTIL_LABELS,
        start: "reply",
        shows: { mode: "until" },
      },
      {
        field: "most",
        label: "At most",
        type: "text",
        hint: "3 days",
        start: "3 days",
        shows: { mode: "until" },
      },
      KIND,
    ],
    ports: (w) => {
      const kind = kindOf(w);
      const until = untilSet(w);
      return until
        ? {
            in: [one("in", "in", kind)],
            out: [one("out", UNTIL_PORT[until], kind), one("timeout", "time ran out", kind)],
          }
        : { in: [one("in", "in", kind)], out: [one("out", "after", kind)] };
    },
    says: (w) => {
      const until = untilSet(w);
      return until
        ? `Until ${UNTIL_WORDS[until]} or ${text(w.most) || "3 days"}`
        : `Wait ${text(w.for) || "1 day"}`;
    },
  },
  {
    id: "logic.split",
    name: "Split",
    blurb: "Sends a fixed share of subjects each way, the same way every time: an A/B test.",
    icon: "split",
    group: "logic",
    ready: true,
    settings: [{ field: "a", label: "Share to A (%)", type: "number", start: 50 }, KIND],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [
        one("a", `A ${shareOf(w.a)}%`, kindOf(w)),
        one("b", `B ${100 - shareOf(w.a)}%`, kindOf(w)),
      ],
    }),
    says: (w) => `${shareOf(w.a)} / ${100 - shareOf(w.a)}`,
  },
  {
    id: "logic.merge",
    name: "Merge",
    blurb: "Joins two wires into one. A subject passes once.",
    icon: "merge",
    group: "logic",
    ready: true,
    settings: [KIND],
    ports: (w) => ({
      in: [one("a", "a", kindOf(w)), one("b", "b", kindOf(w))],
      out: [one("out", "out", kindOf(w))],
    }),
    says: () => "Either way in",
  },
  {
    id: "logic.webhook",
    name: "Send webhook",
    blurb: "Posts the event to any URL, with your headers and body, and keeps the answer.",
    icon: "external",
    group: "action",
    ready: true,
    // It posts the event's data out of Wren.
    effects: ["sends"],
    settings: [
      { field: "url", label: "URL", type: "text", hint: "https://api.example.com/leads" },
      {
        field: "method",
        label: "Method",
        type: "choice",
        options: WEBHOOK_METHODS,
        start: "POST",
      },
      {
        field: "headers",
        label: "Headers, one per line",
        type: "long",
        hint: "Authorization: Bearer {{data.key}}",
      },
      {
        field: "body",
        label: "Body (JSON, empty sends the event)",
        type: "long",
        hint: '{"email": "{{data.lead.email}}"}',
      },
      { field: "keep", label: "Keep from the answer", type: "text", hint: "id=body.id" },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [one("answered", "answered", kindOf(w)), one("refused", "refused", kindOf(w))],
    }),
    says: (w) => {
      const url = text(w.url);
      if (!url) return "Set a URL";
      try {
        return `${text(w.method) || "POST"} to ${new URL(fillText(url, {})).host}`;
      } catch {
        return "Set a URL";
      }
    },
  },
  {
    id: "trigger.hook",
    name: "Webhook",
    blurb: "Events posted to a door URL enter here.",
    icon: "link",
    group: "trigger",
    ready: true,
    settings: [
      { field: "subject", label: "Who it's about (payload field)", type: "text", hint: "email" },
      KIND,
    ],
    ports: (w) => ({ in: [], out: [one("out", "posted", kindOf(w))] }),
    says: (w) => `POST /hooks/<token>, about ${text(w.subject) || "a field"}`,
  },
  trigger(
    "schedule",
    "Schedule",
    "Starts on a schedule: every day at a time, or every few hours.",
    "clock",
    "item",
    [
      {
        field: "every",
        label: "Every",
        type: "choice",
        options: ["day", "hours"],
        labels: { day: "Day, at a time", hours: "Few hours" },
        start: "day",
      },
      { field: "at", label: "At (24h)", type: "text", hint: "09:00", start: "09:00" },
      { field: "hours", label: "Every how many hours", type: "number", hint: "4" },
      {
        field: "zone",
        label: "Time zone",
        type: "text",
        hint: SCHEDULE_ZONE,
        start: SCHEDULE_ZONE,
      },
    ],
    (w) =>
      text(w.every) === "hours"
        ? `Every ${hoursOf(w.hours) ?? "?"} hours`
        : `Every day at ${text(w.at) || "09:00"}, ${text(w.zone) || SCHEDULE_ZONE}`,
  ),
  trigger(
    "form",
    "Form",
    "Starts when a form is filled: its own door URL, or a known form's.",
    "form",
    "form",
    [
      {
        field: "form",
        label: "Form",
        type: "choice",
        options: ["any", ...Object.keys(HOOK_PRESETS)],
        labels: { any: "Any form (by email)", site: "Our site's forms" },
        start: "any",
      },
    ],
    (w) => (text(w.form) === "site" ? "Our site's forms" : "Any form, by email"),
  ),
  trigger(
    "reply",
    "Reply",
    "Starts when a lead replies by email, text or DM. Once per lead.",
    "mail",
    "reply",
    [
      {
        field: "channel",
        label: "Channel",
        type: "choice",
        options: ["any", "email", "sms", "dm"],
        labels: { any: "Any", email: "Email", sms: "Texts", dm: "DMs" },
        start: "any",
      },
    ],
    (w) => `A reply by ${CHANNEL_WORDS[text(w.channel) || "any"] ?? "any channel"}`,
  ),
  trigger(
    "booking",
    "Booking",
    "Starts when a call is booked on cal.com, moved, or cancelled.",
    "calendar",
    "call",
    [
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["booked", "cancelled", "any"],
        labels: { booked: "Booked or moved", cancelled: "Cancelled", any: "Either" },
        start: "booked",
      },
    ],
    (w) =>
      text(w.on) === "cancelled"
        ? "A call cancelled"
        : text(w.on) === "any"
          ? "A call booked or cancelled"
          : "A call booked",
  ),
  trigger(
    "payment",
    "Payment",
    "Starts when someone pays a pay link sent by text or email.",
    "money",
    "invoice",
    [],
    () => "A pay link paid",
  ),
  trigger(
    "deal",
    "Deal",
    "Starts when a deal moves stage on the Opportunities board, or is won or lost.",
    "board",
    "deal",
    [
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["any", "moved", "won", "lost"],
        labels: { any: "Any move", moved: "Moved to an open stage", won: "Won", lost: "Lost" },
        start: "any",
      },
      { field: "stage", label: "Only into stage (its key)", type: "text", hint: "quoted" },
    ],
    (w) => {
      const on = text(w.on) || "any";
      const what = on === "won" ? "A deal won" : on === "lost" ? "A deal lost" : "A deal moved";
      return text(w.stage) ? `${what} into ${text(w.stage)}` : what;
    },
  ),
  trigger(
    "flag",
    "Client flag",
    "Starts when a client's risk or opportunity is raised or clears.",
    "flag",
    "client",
    [
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["raised", "cleared", "any"],
        labels: { raised: "Raised", cleared: "Cleared", any: "Either" },
        start: "raised",
      },
      {
        field: "side",
        label: "Which",
        type: "choice",
        options: ["any", "risk", "opportunity"],
        labels: { any: "Either", risk: "Risks", opportunity: "Opportunities" },
        start: "any",
      },
    ],
    (w) => {
      const side = text(w.side) || "any";
      const what =
        side === "risk" ? "A risk" : side === "opportunity" ? "An opportunity" : "A flag";
      const on = text(w.on) || "raised";
      return `${what} ${on === "cleared" ? "cleared" : on === "any" ? "raised or cleared" : "raised"}`;
    },
  ),
];

const BY_ID = new Map(LOGIC.map((l) => [l.id, l]));
export const logicOf = (id: string | null | undefined): LogicPart | undefined =>
  id ? BY_ID.get(id) : undefined;

/** A node's settings with each one's start filled in where it's unset. */
export const startWith = (l: LogicPart): Record<string, string | number> =>
  Object.fromEntries(
    l.settings.flatMap((s) => (s.start === undefined ? [] : [[s.field, s.start]])),
  );

const WAIT_FOR = /^\d+ (minute|hour|day|week)s?$/;

/** Why a logic node's settings won't run, as readable lines; empty when sound. */
export function logicProblems(at: string, n: WorkflowNode): string[] {
  const l = logicOf(n.uses);
  if (!l) return [];
  const w = n.with ?? {};
  const out: string[] = [];
  if (!l.ready) out.push(`${at}: ${l.name} triggers are in development`);
  if (w.kind !== undefined && !(KINDS as readonly string[]).includes(String(w.kind)))
    out.push(`${at}: ${w.kind} is no event kind`);
  if (l.id === "logic.if" && !text(w.when)) out.push(`${at}: If needs a rule`);
  if (l.id === "logic.switch") {
    if (!/^data(\.[A-Za-z0-9_]+)+$/.test(text(w.field)))
      out.push(`${at}: Switch reads a field like data.stage`);
    if (!casesOf(w.cases).length) out.push(`${at}: Switch needs a case`);
  }
  if (l.id === "logic.wait") {
    if (w.mode !== undefined && text(w.mode) !== "time" && text(w.mode) !== "until")
      out.push(`${at}: a Wait waits a time or until something happens`);
    if (text(w.mode) === "until") {
      if (w.until !== undefined && !isUntil(w.until))
        out.push(`${at}: a Wait can't wait until ${text(w.until)}`);
      if (!WAIT_FOR.test(text(w.most) || "3 days")) out.push(`${at}: at most reads like "3 days"`);
    } else if (!WAIT_FOR.test(text(w.for) || "1 day"))
      out.push(`${at}: a wait reads like "2 days"`);
  }
  if (l.id === "logic.split" && w.a !== undefined && shareOf(w.a) !== Number(w.a))
    out.push(`${at}: Split's share is 1 to 99`);
  if (l.id === "logic.webhook") {
    // Slots may fill the URL's path and query; its host must read as written.
    const url = urlProblem(fillText(text(w.url), {}, true));
    if (url) out.push(`${at}: ${url}`);
    if (w.method !== undefined && !(WEBHOOK_METHODS as readonly string[]).includes(text(w.method)))
      out.push(`${at}: ${text(w.method)} is no method`);
    const body = bodyProblem(w.body);
    if (body) out.push(`${at}: ${body}`);
    out.push(...headersOf(w.headers, {}).problems.map((p) => `${at}: ${p}`));
    out.push(...keepOf(w.keep).problems.map((p) => `${at}: ${p}`));
  }
  if (l.id === "trigger.hook" && !/^[A-Za-z0-9_.]+$/.test(text(w.subject)))
    out.push(`${at}: a webhook names the payload field it's about`);
  if (l.id === "trigger.hook" || l.id === "trigger.form")
    out.push(...fieldMapProblems(fieldMapOfWith(w)).map((p) => `${at}: ${p}`));
  if (
    l.id === "trigger.form" &&
    w.form !== undefined &&
    text(w.form) !== "any" &&
    !HOOK_PRESETS[text(w.form)]
  )
    out.push(`${at}: no form called ${text(w.form)}`);
  if (l.id === "trigger.schedule") {
    if (text(w.every) === "hours") {
      if (!hoursOf(w.hours)) out.push(`${at}: every 1 to 168 hours`);
    } else {
      if (!HH_MM.test(text(w.at) || "09:00")) out.push(`${at}: a time reads like 09:00`);
      if (!canonicalZone(text(w.zone) || SCHEDULE_ZONE))
        out.push(`${at}: ${text(w.zone)} is no time zone (like America/Chicago)`);
    }
  }
  return out;
}

/** Triggers that enter by a door URL: Publish makes each one's hook. */
export const DOOR_TRIGGERS: ReadonlySet<string> = new Set(["trigger.hook", "trigger.form"]);

/** A node's door: the payload field it's about and its field map; null when it has none. */
export function doorOf(n: WorkflowNode): { subject: string; fields: FieldMap } | null {
  const w = n.with ?? {};
  if (n.uses === "trigger.hook") return { subject: text(w.subject), fields: fieldMapOfWith(w) };
  if (n.uses === "trigger.form") {
    // A known form posts its own shape; any other is read by its map, and is about its email.
    const preset = HOOK_PRESETS[text(w.form)];
    if (preset) return { subject: preset.subject, fields: preset.fields };
    const fields = fieldMapOfWith(w);
    return { subject: fields.email ?? "email", fields };
  }
  return null;
}

/** A timed Wait node's hold on what leaves it; undefined for any other node. */
export const holdOf = (n: WorkflowNode | undefined): string | undefined =>
  n?.uses === "logic.wait" && !untilSet(n.with ?? {}) ? text(n.with?.for) || "1 day" : undefined;

/**
 * A Wait until an event: what it waits for and its most, as words ("3 days"). The walker holds
 * the subject at the node; that event about it sends it out by `out`, else time does by
 * `timeout`. Undefined for any other node.
 */
export function untilOf(
  n: { uses?: string | null; with?: WorkflowNode["with"] | undefined } | undefined,
): { until: Until; most: string } | undefined {
  const until = n?.uses === "logic.wait" ? untilSet(n.with ?? {}) : null;
  return until ? { until, most: text(n?.with?.most) || "3 days" } : undefined;
}

/** "Waits for a reply": what a hold row waits for, in words; null for a timed hold. */
export const untilText = (until: string | null | undefined): string | null =>
  isUntil(until) ? `Waits for ${UNTIL_WORDS[until]}` : null;

/** A payload's value at a dotted path. */
export function dig(v: unknown, path: string): unknown {
  for (const k of path.split("."))
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

/** The same subject and node land on the same side every time: FNV-1a over both, 0 to 99. */
export function bucketOf(subject: string, node: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${node}|${subject}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Each logic node's step. If asks `rule`, the same model a wire's `when` asks. */
export function logicSteps(
  rule: (when: string, e: SpineEvent, client?: string | null) => Promise<boolean>,
) {
  const pass = (port: string, e: SpineEvent) => [{ port, event: e }];
  const steps: Record<string, Step> = {
    "logic.if": async (_p, e, at) =>
      pass((await rule(text(at.with.when), e, at.client)) ? "yes" : "no", e),
    "logic.switch": async (_p, e, at) => {
      const v = text(dig(e, String(at.with.field ?? ""))).toLowerCase();
      const hit = casesOf(at.with.cases).find((c) => c.label.toLowerCase() === v || c.id === v);
      return pass(hit?.id ?? "other", e);
    },
    // The walker holds what leaves a Wait (`holdOf`); its step passes it on.
    "logic.wait": async (_p, e) => pass("out", e),
    "logic.split": async (_p, e, at) =>
      pass(bucketOf(e.subject, at.node) < shareOf(at.with.a) ? "a" : "b", e),
    "logic.merge": async (_p, e) => pass("out", e),
  };
  return steps;
}

/** Steps that change nothing outside the walk: a dry test runs them for real. */
export const PURE_STEPS: ReadonlySet<string> = new Set([
  "logic.switch",
  "logic.wait",
  "logic.split",
  "logic.merge",
]);

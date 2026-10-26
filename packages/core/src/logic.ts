/**
 * Logic nodes and triggers (designs/2026-10-06-workflow-editor.md, Edit like n8n): parts every
 * workflow may add on the canvas, outside the Shop. Each takes any event kind, set by its `kind`
 * setting, so its ports follow what it's wired to. If asks the rule model; Switch reads a field;
 * Wait holds what leaves it; Split sends a fixed share each way by subject; Merge joins two
 * wires. A hook trigger is the door into a node. Pure, so the web reads it too.
 */
import type { Effect, EventKind, Port } from "./components.js";
import { type FieldMap, fieldMapOfWith, fieldMapProblems, HOOK_PRESETS } from "./door.js";
import type { ExecutorEvent, Step } from "./executor.js";
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
  "document",
  "journey",
  "doc",
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

interface LogicPart {
  /** "logic.if", "trigger.hook". */
  id: string;
  name: string;
  blurb: string;
  icon: string;
  /** Actions reach outside Wren: Send webhook. */
  group: "logic" | "trigger" | "action";
  /** Runs on the executor. Not yet: drawn faded, "In development", and publishing refuses it. */
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

/** A trigger: no inputs, one output of `kind`, entered by the executor when its event happens. */
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
  | { trigger: "trigger.payment"; change: PayChange }
  | { trigger: "trigger.touch"; kind: string; direction: string; platform: string }
  | { trigger: "trigger.document"; change: DocChange; kind: string }
  | {
      trigger: "trigger.journey";
      /** The shape node the journey entered, skipped or was dropped at. */
      node: string;
      change: JourneyChange;
      /** The node entered is an offer node: a deal was won (`deal.won` out). */
      sale?: true;
    }
  | { trigger: "trigger.app"; app: string; change: AppChange }
  | { trigger: "trigger.segment"; segment: number; change: SegmentChange }
  | { trigger: "trigger.source"; source: string }
  /**
   * A content line found a document: the hunt or his save gave it the SOP's tag, or the study read
   * it. One of the two names the line.
   */
  | { trigger: "trigger.found"; sop?: string; study?: string }
  /** A job ended at a content station: the document is ready for the next one. */
  | { trigger: "trigger.station"; station: string }
  | { trigger: "trigger.trait"; key: string; value: string | null }
  | { trigger: "trigger.date"; key: string; offset: number; every: DateEvery };

/** What a journey tells the executor: it entered a node, passed over one, or was dropped. */
const JOURNEY_CHANGES = {
  entered: "Enters a node",
  skipped: "Skips a node",
  dropped: "Is dropped",
} as const;
type JourneyChange = keyof typeof JOURNEY_CHANGES;
/**
 * The node a Journey trigger names: `node`, else the `stage` an older save wrote. The `funnel` it
 * also wrote is ignored: there is one shape per workspace.
 */
const journeyNodeOf = (w: Record<string, unknown>): string => text(w.node) || text(w.stage);
/** A node id, as the pipeline keeps them. */
const JOURNEY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
/** A sourced list's id: `import:<batch number>`. */
export const SOURCE_ID = /^import:[1-9][0-9]{0,9}$/;
/** An SOP's folder name, as `wren sop ls` prints it and the hunt tags its finds. */
export const SOP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A study's slug: `wren study new <slug>`. */
export const STUDY_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;

/**
 * What a touch trigger may name. Copies of `touches-schema`'s lists, kept here because this file
 * is pure and the web reads it; a test keeps them equal.
 */
export const TOUCH_ON_KINDS = [
  "follow",
  "connect",
  "comment",
  "reply",
  "dm",
  "like",
  "mention",
] as const;
export const TOUCH_ON_DIRECTIONS = ["ours", "theirs"] as const;
export const TOUCH_ON_PLATFORMS = [
  "linkedin",
  "reddit",
  "youtube",
  "x",
  "instagram",
  "facebook",
  "tiktok",
  "google_business",
] as const;

/** A profile entering or leaving a group (designs/2026-10-14-customerio-audit.md, B5). */
const SEGMENT_CHANGES = { entered: "Enters", left: "Leaves" } as const;
type SegmentChange = keyof typeof SEGMENT_CHANGES;
/**
 * A Group trigger's repeat: a person enters the workflow once, or each time they enter (or leave)
 * the group. A journey source in the shape takes each time: a person who comes back to the group
 * starts a new journey.
 */
const SEGMENT_REPEAT = { once: "Once per person", each: "Each time" } as const;
type SegmentRepeat = keyof typeof SEGMENT_REPEAT;
/** A Group trigger's repeat: each time, else once. */
export const segmentRepeatOf = (v: unknown): SegmentRepeat =>
  String(v ?? "") === "each" ? "each" : "once";
/** A date trait's trigger: on that date once, or on its day each year (a birthday). */
const DATE_EVERY = { once: "On the date", yearly: "Every year" } as const;
export type DateEvery = keyof typeof DATE_EVERY;
/** A trait key, as profiles keep them. */
const TRAIT_KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** A Date trigger's offset in whole days, -365 to 365; 0 when unread. */
export const offsetOf = (v: unknown): number => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) && Math.abs(n) <= 365 ? n : 0;
};
/** A Date trigger's repeat: yearly, else once. */
export const everyOf = (v: unknown): DateEvery =>
  String(v ?? "") === "yearly" ? "yearly" : "once";

/** What a sent document tells the executor (designs/2026-10-09-documents.md). */
const DOC_CHANGES = {
  viewed: "Opened",
  signed: "Signed",
  declined: "Declined",
} as const;
type DocChange = keyof typeof DOC_CHANGES;

/**
 * What a payment tells the executor, each once (designs/2026-10-07-forms-and-pay.md). A pay link
 * says paid, refunded and failed; Wren's own invoice also says invoiced and late.
 */
export const PAY_CHANGES = {
  paid: "Paid",
  refunded: "Refunded or a dispute lost",
  failed: "A bank payment failed",
  invoiced: "An invoice issued",
  late: "An invoice past due",
} as const;
export type PayChange = keyof typeof PAY_CHANGES;

/** What a connected app tells the executor (designs/2026-10-09-connectors.md). */
const APP_CHANGES = {
  contact_added: "A contact added",
  invoice_paid: "An invoice paid",
  job_done: "A job done",
} as const;
export type AppChange = keyof typeof APP_CHANGES;
/** The apps a client connects on Account → Connectors. */
export const CONNECTOR_APP_NAMES = {
  hubspot: "HubSpot",
  quickbooks: "QuickBooks",
  jobber: "Jobber",
} as const;

/** A Reply or Booking node hears this event by its settings. */
export function triggerHears(n: WorkflowNode, f: TriggerFacts): boolean {
  if (n.uses !== f.trigger) return false;
  const w = n.with ?? {};
  if (f.trigger === "trigger.reply") {
    const on = text(w.channel) || "any";
    return on === "any" || on === f.channel;
  }
  if (f.trigger === "trigger.payment") {
    const on = text(w.on) || "paid";
    return on === "any" || on === f.change;
  }
  if (f.trigger === "trigger.touch") {
    const kind = text(w.kind) || "any";
    const direction = text(w.direction) || "any";
    const platform = text(w.platform) || "any";
    return (
      (kind === "any" || kind === f.kind) &&
      (direction === "any" || direction === f.direction) &&
      (platform === "any" || platform === f.platform)
    );
  }
  if (f.trigger === "trigger.document") {
    const kind = text(w.kind) || "any";
    const on = text(w.on) || "signed";
    return (kind === "any" || kind === f.kind) && (on === "any" || on === f.change);
  }
  if (f.trigger === "trigger.app") {
    const app = text(w.app) || "any";
    const on = text(w.on) || "any";
    return (app === "any" || app === f.app) && (on === "any" || on === f.change);
  }
  if (f.trigger === "trigger.journey") {
    const on = text(w.on) || "entered";
    const node = journeyNodeOf(w);
    return (on === "any" || on === f.change) && (!node || node === f.node);
  }
  if (f.trigger === "trigger.segment") {
    const on = text(w.on) || "entered";
    return Number(w.segment) === f.segment && (on === "any" || on === f.change);
  }
  if (f.trigger === "trigger.source") return text(w.source) === f.source;
  if (f.trigger === "trigger.found")
    return f.study ? text(w.study) === f.study : !!f.sop && text(w.sop) === f.sop;
  if (f.trigger === "trigger.station") return text(w.station) === f.station;
  if (f.trigger === "trigger.trait") {
    const to = text(w.to);
    return text(w.trait) === f.key && (!to || to.toLowerCase() === (f.value ?? "").toLowerCase());
  }
  if (f.trigger === "trigger.date")
    return (
      text(w.trait) === f.key && offsetOf(w.offset) === f.offset && everyOf(w.every) === f.every
    );
  if (f.trigger === "trigger.flag") {
    const on = text(w.on) || "raised";
    const side = text(w.side) || "any";
    return (on === "any" || on === f.change) && (side === "any" || side === f.side);
  }
  const on = text(w.on) || "booked";
  return on === "any" || on === f.change;
}

/** What a Wait may wait until: an event fired at the executor about the same subject. */
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
        f.trigger === "trigger.touch" ||
        f.trigger === "trigger.document" ||
        f.trigger === "trigger.journey" ||
        f.trigger === "trigger.app" ||
        f.trigger === "trigger.segment" ||
        f.trigger === "trigger.source" ||
        f.trigger === "trigger.found" ||
        f.trigger === "trigger.station" ||
        f.trigger === "trigger.trait" ||
        f.trigger === "trigger.date"
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
    id: "logic.code",
    name: "Code",
    blurb:
      "Runs a few lines of JavaScript on each event. Return an object to add its fields to data and pass it on; return null to skip.",
    icon: "code",
    group: "logic",
    ready: true,
    settings: [
      {
        field: "code",
        label: "Code (a function body; sees event and now)",
        type: "long",
        hint: 'const [first] = event.data.name.split(" ");\nreturn { first };',
      },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [one("out", "out", kindOf(w)), one("skip", "skip", kindOf(w))],
    }),
    says: (w) =>
      text(w.code)
        .split("\n")
        .find((l) => l.trim())
        ?.trim()
        .slice(0, 48) || "Write the code",
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
    id: "logic.message",
    name: "Send message",
    blurb:
      "Emails or texts the person, if they said yes to the topic. The same gate as a broadcast: consent, do-not-contact, the frequency cap.",
    icon: "mail",
    group: "action",
    ready: true,
    effects: ["sends"],
    settings: [
      {
        field: "channel",
        label: "Send by",
        type: "choice",
        options: ["email", "sms"],
        labels: { email: "Email", sms: "Text" },
        start: "email",
      },
      { field: "topic", label: "Topic they said yes to", type: "text", hint: "newsletter" },
      {
        field: "subject",
        label: "Subject",
        type: "text",
        hint: "Thanks, {first_name|there}",
        shows: { channel: "email" },
      },
      {
        field: "body",
        label: "Message",
        type: "long",
        hint: "Hi {first_name|there}, ...",
      },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [one("sent", "sent", kindOf(w)), one("skipped", "skipped", kindOf(w))],
    }),
    says: (w) => {
      const by = text(w.channel) === "sms" ? "Text" : "Email";
      return text(w.topic) ? `${by} on ${text(w.topic)}` : `${by}: pick a topic`;
    },
  },
  {
    id: "logic.notify",
    name: "Notify me",
    blurb: "Sends Wren's team one line, with a link to the run. Nothing reaches the person.",
    icon: "flag",
    group: "action",
    ready: true,
    settings: [
      {
        field: "line",
        label: "What it says",
        type: "text",
        hint: "New lead: {{data.lead.name}}",
      },
      KIND,
    ],
    ports: (w) => ({ in: [one("in", "in", kindOf(w))], out: [one("out", "out", kindOf(w))] }),
    says: (w) => (text(w.line) ? `Ping: ${text(w.line).slice(0, 40)}` : "Ping the team"),
  },
  {
    id: "logic.set_field",
    name: "Set field",
    blurb:
      "Sets one of your custom fields on the record the event is about, such as a journey. Others leave by skip.",
    icon: "edit",
    group: "action",
    ready: true,
    settings: [
      { field: "field", label: "Field key", type: "text", hint: "roof_age" },
      {
        field: "value",
        label: "Value (empty clears it)",
        type: "text",
        hint: "{{data.answers.roof_age}}",
      },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [one("out", "out", kindOf(w)), one("skip", "skip", kindOf(w))],
    }),
    says: (w) => (text(w.field) ? `Set ${text(w.field)}` : "Pick a field"),
  },
  {
    id: "logic.segment",
    name: "In group",
    blurb:
      "Checks if the person is in a People group now. A live one is checked by its rule. No person found leaves by skip.",
    icon: "people",
    group: "logic",
    ready: true,
    settings: [
      { field: "segment", label: "Group (its number in People → Groups)", type: "number" },
      KIND,
    ],
    ports: (w) => ({
      in: [one("in", "in", kindOf(w))],
      out: [
        one("yes", "yes", kindOf(w)),
        one("no", "no", kindOf(w)),
        one("skip", "skip", kindOf(w)),
      ],
    }),
    says: (w) => `In group ${text(w.segment) || "?"}?`,
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
    "Starts when someone pays a pay link sent by text or email, or the payment is refunded or fails.",
    "money",
    "invoice",
    [
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["paid", "refunded", "failed", "invoiced", "late", "any"],
        labels: { ...PAY_CHANGES, any: "Any of these" },
        start: "paid",
      },
    ],
    (w) => {
      const on = text(w.on) || "paid";
      if (on === "refunded") return "A payment refunded";
      if (on === "failed") return "A bank payment failed";
      if (on === "invoiced") return "An invoice issued";
      if (on === "late") return "An invoice past due";
      if (on === "any") return "A payment paid, refunded, failed, invoiced or late";
      return "A payment received";
    },
  ),
  trigger(
    "touch",
    "Touch",
    "Starts when a follow, connect, comment, reply, DM, like or mention happens on a social platform, ours or theirs. Once per touch.",
    "chat",
    "person",
    [
      {
        field: "kind",
        label: "Kind",
        type: "choice",
        options: ["any", ...TOUCH_ON_KINDS],
        labels: { any: "Any kind" },
        start: "any",
      },
      {
        field: "direction",
        label: "From",
        type: "choice",
        options: ["any", ...TOUCH_ON_DIRECTIONS],
        labels: { any: "Either side", ours: "Us", theirs: "Them" },
        start: "theirs",
      },
      {
        field: "platform",
        label: "Platform",
        type: "choice",
        options: ["any", ...TOUCH_ON_PLATFORMS],
        labels: { any: "Any platform" },
        start: "any",
      },
    ],
    (w) => {
      const kind = text(w.kind) || "any";
      const direction = text(w.direction) || "any";
      const platform = text(w.platform) || "any";
      const what = kind === "any" ? "A touch" : `A ${kind}`;
      const from = direction === "ours" ? " from us" : direction === "theirs" ? " from them" : "";
      return `${what}${from}${platform === "any" ? "" : ` on ${platform}`}`;
    },
  ),
  trigger(
    "document",
    "Document",
    "Starts when someone opens, signs or declines a contract, proposal or estimate you sent.",
    "note",
    "document",
    [
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["signed", "viewed", "declined", "any"],
        labels: { ...DOC_CHANGES, any: "Any of these" },
        start: "signed",
      },
      {
        field: "kind",
        label: "Kind",
        type: "choice",
        options: ["any", "contract", "proposal", "estimate"],
        labels: {
          any: "Any kind",
          contract: "Contract",
          proposal: "Proposal",
          estimate: "Estimate",
        },
        start: "any",
      },
    ],
    (w) => {
      const on = text(w.on) || "signed";
      const kind = text(w.kind) || "any";
      const what = kind === "any" ? "A document" : `A ${kind}`.replace("A estimate", "An estimate");
      if (on === "any") return `${what} opened, signed or declined`;
      return `${what} ${(DOC_CHANGES[on as DocChange] ?? on).toLowerCase()}`;
    },
  ),
  trigger(
    "app",
    "Connected app",
    "Starts when a connected app (HubSpot, QuickBooks, Jobber) adds a contact, gets an invoice paid or finishes a job.",
    "link",
    "person",
    [
      {
        field: "app",
        label: "App",
        type: "choice",
        options: ["any", ...Object.keys(CONNECTOR_APP_NAMES)],
        labels: { any: "Any app", ...CONNECTOR_APP_NAMES },
        start: "any",
      },
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["any", ...Object.keys(APP_CHANGES)],
        labels: { any: "Anything", ...APP_CHANGES },
        start: "any",
      },
    ],
    (w) => {
      const on = text(w.on) || "any";
      const app = text(w.app) || "any";
      const what = on === "any" ? "Anything" : (APP_CHANGES[on as AppChange] ?? on);
      const where =
        app === "any"
          ? "a connected app"
          : (CONNECTOR_APP_NAMES[app as keyof typeof CONNECTOR_APP_NAMES] ?? app);
      return `${what} in ${where}`;
    },
  ),
  trigger(
    "journey",
    "Journey",
    "Starts when someone enters, skips or leaves a node of the shape. Once per person and node.",
    "board",
    "journey",
    [
      { field: "node", label: "Only this node (its id)", type: "text", hint: "signed" },
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["entered", "skipped", "dropped", "any"],
        labels: { ...JOURNEY_CHANGES, any: "Any of these" },
        start: "entered",
      },
    ],
    (w) => {
      const on = text(w.on) || "entered";
      const what = on === "any" ? "A journey moves" : (JOURNEY_CHANGES[on as JourneyChange] ?? on);
      const node = journeyNodeOf(w);
      return node ? `${what} ${node}` : `${what} in the shape`;
    },
  ),
  trigger(
    "segment",
    "Group",
    "Starts when someone enters or leaves a group in People. Once per person, or each time with Repeat.",
    "people",
    "lead",
    [
      { field: "segment", label: "Group (its number in People → Groups)", type: "number" },
      {
        field: "on",
        label: "When",
        type: "choice",
        options: ["entered", "left", "any"],
        labels: { ...SEGMENT_CHANGES, any: "Either" },
        start: "entered",
      },
      {
        field: "repeat",
        label: "Repeat",
        type: "choice",
        options: ["once", "each"],
        labels: SEGMENT_REPEAT,
        start: "once",
      },
    ],
    (w) => {
      const on = text(w.on) || "entered";
      const what = on === "left" ? "Leaves" : on === "any" ? "Enters or leaves" : "Enters";
      const again = segmentRepeatOf(w.repeat) === "each" ? ", each time" : "";
      return `${what} group ${text(w.segment) || "?"}${again}`;
    },
  ),
  trigger(
    "source",
    "Source",
    "Starts when someone is added to a sourced list (an import batch). Once per person.",
    "people",
    "lead",
    [{ field: "source", label: "List (its id)", type: "text", hint: "import:12" }],
    (w) => `Added to ${text(w.source) || "a list"}`,
  ),
  trigger(
    "found",
    "Found",
    "Starts when a content line finds a document: the hunt or a save tags it with the line's SOP, or the line's study reads it. Once per document and line.",
    "search",
    "doc",
    [
      { field: "sop", label: "SOP (its folder name)", type: "text", hint: "launch-films" },
      { field: "study", label: "Study (its slug)", type: "text", hint: "recruiting-offers" },
    ],
    (w) =>
      text(w.study) ? `Found for study ${text(w.study)}` : `Found for ${text(w.sop) || "an SOP"}`,
  ),
  trigger(
    "station",
    "Station done",
    "Starts when the job at a content station ends for a document: read, extracted or called.",
    "check",
    "doc",
    [{ field: "station", label: "Station (its id)", type: "text", hint: "extract" }],
    (w) => `Done at ${text(w.station) || "a station"}`,
  ),
  trigger(
    "trait",
    "Trait changed",
    "Starts when a person's trait changes, or changes to one value. Once per person.",
    "edit",
    "lead",
    [
      { field: "trait", label: "Trait key", type: "text", hint: "plan" },
      { field: "to", label: "Only when it becomes", type: "text", hint: "Any value when empty" },
    ],
    (w) =>
      text(w.to)
        ? `${text(w.trait) || "A trait"} becomes ${text(w.to)}`
        : `${text(w.trait) || "A trait"} changes`,
  ),
  trigger(
    "date",
    "Date",
    "Starts on a date a person's trait holds, like a renewal or a birthday, a few days before or after.",
    "calendar",
    "lead",
    [
      { field: "trait", label: "Date trait key", type: "text", hint: "renewal_date" },
      {
        field: "offset",
        label: "Days from it (-7 is a week before)",
        type: "number",
        start: 0,
      },
      {
        field: "every",
        label: "Repeat",
        type: "choice",
        options: ["once", "yearly"],
        labels: DATE_EVERY,
        start: "once",
      },
    ],
    (w) => {
      const n = offsetOf(w.offset);
      const when = n === 0 ? "On" : n < 0 ? `${-n} days before` : `${n} days after`;
      const yearly = everyOf(w.every) === "yearly" ? ", every year" : "";
      return `${when} ${text(w.trait) || "a date trait"}${yearly}`;
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

export const CODE_MOST = 10_000;

/**
 * Why a Code node's code won't run: empty, too long, or a syntax error. Parsing only (the body
 * never runs here); where the page's policy forbids parsing, the server's check stands.
 */
export function codeProblems(code: string): string[] {
  if (!code.trim()) return ["Code needs a few lines"];
  if (code.length > CODE_MOST)
    return [`Code is over ${CODE_MOST.toLocaleString("en-US")} characters`];
  try {
    new Function("event", "now", code);
  } catch (err) {
    if (err instanceof SyntaxError) return [`Code doesn't parse: ${err.message}`];
  }
  return [];
}

const WAIT_FOR = /^\d+ (minute|hour|day|week)s?$/;

/** Why a logic node's settings won't run, as readable lines; empty when sound. */
export function logicProblems(at: string, n: WorkflowNode): string[] {
  const l = logicOf(n.uses);
  if (!l) return [];
  const w = n.with ?? {};
  const out: string[] = [];
  if (!l.ready) out.push(`${at}: ${l.name} triggers are in development`);
  // A trigger's own `kind` (a document's, a touch's) is no event kind.
  if (
    l.group !== "trigger" &&
    w.kind !== undefined &&
    !(KINDS as readonly string[]).includes(String(w.kind))
  )
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
  if (l.id === "logic.set_field" && !/^[a-z][a-z0-9_]{0,39}$/.test(text(w.field)))
    out.push(`${at}: Set field names a field key, like roof_age`);
  if (
    l.id === "logic.segment" &&
    !(Number.isSafeInteger(Number(w.segment)) && Number(w.segment) > 0)
  )
    out.push(`${at}: In group names a group's number`);
  if (l.id === "logic.code") out.push(...codeProblems(text(w.code)).map((p) => `${at}: ${p}`));
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
  if (l.id === "logic.message") {
    const sms = text(w.channel) === "sms";
    if (w.channel !== undefined && !sms && text(w.channel) !== "email")
      out.push(`${at}: Send message goes by email or text`);
    if (!text(w.topic)) out.push(`${at}: Send message names the topic they said yes to`);
    if (!text(w.body)) out.push(`${at}: Send message needs its words`);
    if (!sms && !text(w.subject)) out.push(`${at}: an email needs a subject`);
    if (sms && !/\bstop\b/i.test(text(w.body))) out.push(`${at}: a text says how to stop (STOP)`);
    if (sms && text(w.body).length > 459) out.push(`${at}: a text is at most 459 characters`);
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
  if (l.id === "trigger.journey") {
    const node = journeyNodeOf(w);
    if (node && !JOURNEY_KEY.test(node)) out.push(`${at}: Journey names a node id, like signed`);
    if (w.on !== undefined && !["entered", "skipped", "dropped", "any"].includes(text(w.on)))
      out.push(`${at}: Journey fires when a journey enters, skips or leaves a node`);
  }
  if (l.id === "trigger.touch") {
    if (w.kind !== undefined && !["any", ...TOUCH_ON_KINDS].includes(text(w.kind)))
      out.push(`${at}: Touch kind is one of ${TOUCH_ON_KINDS.join(", ")}, or any`);
    if (w.direction !== undefined && !["any", ...TOUCH_ON_DIRECTIONS].includes(text(w.direction)))
      out.push(`${at}: Touch is from us, from them or either`);
    if (w.platform !== undefined && !["any", ...TOUCH_ON_PLATFORMS].includes(text(w.platform)))
      out.push(`${at}: ${text(w.platform)} is no touch platform`);
  }
  if (l.id === "trigger.segment") {
    const n = Number(w.segment);
    if (!Number.isSafeInteger(n) || n < 1) out.push(`${at}: Group names a group's number`);
  }
  if (l.id === "trigger.source" && !SOURCE_ID.test(text(w.source)))
    out.push(`${at}: Source names a list's id, like import:12`);
  if (l.id === "trigger.found" && !SOP_NAME.test(text(w.sop)))
    out.push(`${at}: Found names an SOP's folder name, like launch-films`);
  if (l.id === "trigger.station" && !JOURNEY_KEY.test(text(w.station)))
    out.push(`${at}: Station done names a station id, like extract`);
  if ((l.id === "trigger.trait" || l.id === "trigger.date") && !TRAIT_KEY.test(text(w.trait)))
    out.push(`${at}: name a trait key, like renewal_date`);
  if (l.id === "trigger.date" && w.offset !== undefined && offsetOf(w.offset) !== Number(w.offset))
    out.push(`${at}: days from the date are -365 to 365`);
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

/** Every trigger component id: what a shape node's `advance` may name. */
export const TRIGGER_IDS: ReadonlySet<string> = new Set(
  LOGIC.filter((l) => l.group === "trigger").map((l) => l.id),
);

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
  rule: (when: string, e: ExecutorEvent, client?: string | null) => Promise<boolean>,
) {
  const pass = (port: string, e: ExecutorEvent) => [{ port, event: e }];
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

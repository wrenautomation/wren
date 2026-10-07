/**
 * Logic nodes and triggers (designs/2026-10-06-workflow-editor.md, Edit like n8n): parts every
 * workflow may add on the canvas, outside the Shop. Each takes any event kind, set by its `kind`
 * setting, so its ports follow what it's wired to. If asks the rule model; Switch reads a field;
 * Wait holds what leaves it; Split sends a fixed share each way by subject; Merge joins two
 * wires. A hook trigger is the door into a node. Pure, so the web reads it too.
 */
import type { EventKind, Port } from "./components.js";
import { type FieldMap, fieldMapOfWith, fieldMapProblems, HOOK_PRESETS } from "./door.js";
import type { SpineEvent, Step } from "./spine.js";
import { canonicalZone, wallClock, zonedInstant } from "./time.js";
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
] as const satisfies readonly EventKind[];

/** One setting on a logic node: a line he types, a number, or one of a few. */
export interface LogicSetting {
  field: string;
  label: string;
  type: "text" | "number" | "choice";
  options?: readonly string[];
  /** A choice's words, by option; the option itself when unset. */
  labels?: Readonly<Record<string, string>>;
  hint?: string;
  /** What a new node starts with. */
  start?: string | number;
}

export interface LogicPart {
  /** "logic.if", "trigger.hook". */
  id: string;
  name: string;
  blurb: string;
  icon: string;
  group: "logic" | "trigger";
  /** Runs on the spine. Not yet: drawn faded, "In development", and publishing refuses it. */
  ready: boolean;
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
  | { trigger: "trigger.booking"; change: "booked" | "cancelled" };

/** A Reply or Booking node hears this event by its settings. */
export function triggerHears(n: WorkflowNode, f: TriggerFacts): boolean {
  if (n.uses !== f.trigger) return false;
  const w = n.with ?? {};
  if (f.trigger === "trigger.reply") {
    const on = text(w.channel) || "any";
    return on === "any" || on === f.channel;
  }
  const on = text(w.on) || "booked";
  return on === "any" || on === f.change;
}

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
    blurb: "Holds each event, then sends it on.",
    icon: "clock",
    group: "logic",
    ready: true,
    settings: [{ field: "for", label: "Wait", type: "text", hint: "2 days", start: "1 day" }, KIND],
    ports: (w) => ({ in: [one("in", "in", kindOf(w))], out: [one("out", "after", kindOf(w))] }),
    says: (w) => `Wait ${text(w.for) || "1 day"}`,
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
    const f = text(w.for) || "1 day";
    if (f.startsWith("until ")) out.push(`${at}: waits until an event are in development`);
    else if (!WAIT_FOR.test(f)) out.push(`${at}: a wait reads like "2 days"`);
  }
  if (l.id === "logic.split" && w.a !== undefined && shareOf(w.a) !== Number(w.a))
    out.push(`${at}: Split's share is 1 to 99`);
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

/** A Wait node's hold on what leaves it; undefined for any other node. */
export const holdOf = (n: WorkflowNode | undefined): string | undefined =>
  n?.uses === "logic.wait" ? text(n.with?.for) || "1 day" : undefined;

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
export function logicSteps(rule: (when: string, e: SpineEvent) => Promise<boolean>) {
  const pass = (port: string, e: SpineEvent) => [{ port, event: e }];
  const steps: Record<string, Step> = {
    "logic.if": async (_p, e, at) => pass((await rule(text(at.with.when), e)) ? "yes" : "no", e),
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

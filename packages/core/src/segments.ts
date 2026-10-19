/**
 * Segments (designs/2026-10-14-customerio-audit.md, B5): who in a workspace matches a rule, kept
 * as rows. A rule is a group of conditions, all or any, groups nesting: a trait's value, a
 * timeline kind at least N times in the last D days, consent on a channel, a sent message's state,
 * and being in another segment. `compileRule` turns it into one SQL test on a profile, so a count,
 * a preview and a recompute are all one query.
 *
 * - `live`: recomputed on every pass (`./segments-pass.ts`) and on save; each entry and exit kept.
 * - `manual`: members added and removed by hand.
 * - `snapshot`: the rule's answer when taken; "take again" retakes it.
 *
 * `segmentMembers` is how a sender reads one (B6 broadcasts). Unused 90 days, a segment is
 * archived; restoring it is one click. "Describe" asks the model for a rule from plain words,
 * checked here before anyone sees it.
 */
import type { Queryable } from "@wren/db";
// The subpath, not the root: the portal web imports this file, and the root bundles postgres.js.
import { atomic } from "@wren/db/isolation";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { FUNNEL_STEP_NAMES, FUNNEL_STEPS, type FunnelStep } from "./channel-stats-schema.js";
import { TIMELINE_KIND_NAMES, TIMELINE_KINDS, type TimelineKind } from "./profiles-schema.js";
import { PortalRefusal, staleRefusal } from "./refusal.js";
import type { SegmentKind, SegmentState, SegmentUse } from "./segments-schema.js";

/** A trait key, as `./profiles.ts` keeps them. */
const TRAIT_KEY = /^[a-z][a-z0-9_]{0,63}$/;

// ---------------------------------------------------------------------------------------------
// The rule

/** How a trait is compared. Dates read `YYYY-MM-DD` at the value's start. */
export const TRAIT_OPS = {
  is: "is",
  contains: "contains",
  gt: "is more than",
  lt: "is less than",
  exists: "is set",
  before: "is before",
  after: "is after",
  in_next: "falls in the next (days)",
  in_last: "fell in the last (days)",
  one_of: "is one of",
} as const;
export type TraitOp = keyof typeof TRAIT_OPS;

/**
 * A message's state as a condition, and the ladder states that count for it (`SENT_STATES`). A
 * message sits at the furthest step it reached, so a reply counts as opened and clicked.
 */
export const MESSAGE_STATES = {
  sent: ["sent", "delivered", "opened", "clicked", "replied"],
  delivered: ["delivered", "opened", "clicked", "replied"],
  opened: ["opened", "clicked", "replied"],
  clicked: ["clicked", "replied"],
  replied: ["replied"],
  bounced: ["bounced"],
  failed: ["failed"],
} as const satisfies Record<string, readonly string[]>;
export type MessageState = keyof typeof MESSAGE_STATES;
const MESSAGE_STATE_KEYS = Object.keys(MESSAGE_STATES) as [MessageState, ...MessageState[]];

/** The channels a message condition may name; `any` is all of them. */
export const MESSAGE_CHANNELS = [
  "any",
  "email",
  "sms",
  "linkedin",
  "reddit",
  "x",
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
] as const;
export const CONSENT_CHANNELS = ["email", "sms"] as const;
/** A consent row's state, and a phone that texted STOP (`sms_contacts`). */
export const CONSENT_CONDITION_STATES = ["confirmed", "pending", "withdrawn", "opted_out"] as const;

/** The most a rule holds: conditions in all, and groups deep. */
export const RULE_MOST = { conditions: 30, depth: 4 } as const;

const not = z.boolean().optional();
/** At least this many; 0 only beside `atMost` ("at most 2", "never"). */
const count = z.number().int().min(0).max(100_000).default(1);
const most = z.number().int().min(0).max(100_000).optional();
/** Days back; null or left out is ever. */
const days = z.number().int().min(1).max(3650).nullable().default(null);
/** A channel as the timeline names it: email, sms, linkedin, site, calendar. */
export const CHANNEL_NAME = /^[a-z][a-z0-9_]{0,23}$/;
const channel = z.string().regex(CHANNEL_NAME, "a channel, like email or reddit").optional();
/** Words a line's summary or link holds: a subject, a post's address, a campaign. */
const words = z.string().trim().min(1).max(200).optional();
/** Another timeline line a count is read before or after: the person's first one. */
export const anchorSchema = z.strictObject({ event: z.enum(TIMELINE_KINDS), channel });
export type Anchor = z.infer<typeof anchorSchema>;

export const traitCondition = z.strictObject({
  kind: z.literal("trait"),
  key: z.string().regex(TRAIT_KEY, "a trait key, like plan or renewal_date"),
  op: z.enum(Object.keys(TRAIT_OPS) as [TraitOp, ...TraitOp[]]),
  value: z.union([z.string().max(200), z.number()]).optional(),
  not,
});
export const eventCondition = z.strictObject({
  kind: z.literal("event"),
  event: z.enum(TIMELINE_KINDS),
  channel,
  match: words,
  atLeast: count,
  atMost: most,
  days,
  after: anchorSchema.optional(),
  before: anchorSchema.optional(),
  not,
});
export const consentCondition = z.strictObject({
  kind: z.literal("consent"),
  channel: z.enum(CONSENT_CHANNELS),
  state: z.enum(CONSENT_CONDITION_STATES),
  not,
});
export const messageCondition = z.strictObject({
  kind: z.literal("message"),
  state: z.enum(MESSAGE_STATE_KEYS),
  channel: z.enum(MESSAGE_CHANNELS).default("any"),
  campaign: words,
  atLeast: count,
  atMost: most,
  days,
  not,
});
/** A funnel step on a channel, from `profile_steps` (designs/2026-10-15-channel-stats.md). */
export const stepCondition = z.strictObject({
  kind: z.literal("step"),
  step: z.enum(FUNNEL_STEPS),
  channel,
  source: words,
  days,
  not,
});
/** A journey's states (`pipeline.journeys.status`), and the clock a window counts back on. */
export const JOURNEY_STATUS_NAMES = ["open", "done", "dropped"] as const;
export const JOURNEY_CLOCKS = ["moved", "opened"] as const;
/** A node id or source id, as `@wren/pipeline` names them. */
export const JOURNEY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const journeyKey = z.string().regex(JOURNEY_KEY, "a node or source id, like organic").optional();
/**
 * The person holds a journey (`pipeline.journeys`): at a node (or `reached` it: the node is on
 * its trail or is where it sits), in a state, opened by a source, moved or opened in the last D
 * days. A rule saved before the shape named a funnel and a `stage`: the stage reads as the node
 * and the funnel is ignored (there is one shape per workspace).
 */
export const journeyCondition = z.preprocess(
  (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    const { funnel: _funnel, stage, ...rest } = v as Record<string, unknown>;
    return stage !== undefined && rest.node === undefined ? { ...rest, node: stage } : rest;
  },
  z.strictObject({
    kind: z.literal("journey"),
    node: journeyKey,
    reached: z.boolean().optional(),
    status: z.enum(JOURNEY_STATUS_NAMES).optional(),
    entry: journeyKey,
    /** Which clock `days` counts back on: the last move (default) or the opening. */
    window: z.enum(JOURNEY_CLOCKS).optional(),
    days,
    not,
  }),
);
export const segmentCondition = z.strictObject({
  kind: z.literal("segment"),
  segment: z.number().int().positive(),
  not,
});

export type TraitCondition = z.infer<typeof traitCondition>;
export type EventCondition = z.infer<typeof eventCondition>;
export type ConsentCondition = z.infer<typeof consentCondition>;
export type MessageCondition = z.infer<typeof messageCondition>;
export type StepCondition = z.infer<typeof stepCondition>;
export type SegmentCondition = z.infer<typeof segmentCondition>;
export type JourneyCondition = z.infer<typeof journeyCondition>;
export type Condition =
  | TraitCondition
  | EventCondition
  | ConsentCondition
  | MessageCondition
  | StepCondition
  | JourneyCondition
  | SegmentCondition;
export interface Group {
  kind: "group";
  match: "all" | "any";
  of: Node[];
  not?: boolean | undefined;
}
export type Node = Condition | Group;
/** A segment's rule: one group at the top. */
export type Rule = Group;

export const groupSchema: z.ZodType<Group> = z.lazy(() =>
  z.strictObject({
    kind: z.literal("group"),
    match: z.enum(["all", "any"]),
    of: z.array(nodeSchema).min(1).max(RULE_MOST.conditions),
    not,
  }),
);
export const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.union([
    traitCondition,
    eventCondition,
    consentCondition,
    messageCondition,
    stepCondition,
    journeyCondition,
    segmentCondition,
    groupSchema,
  ]),
);
export const ruleSchema = groupSchema;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown) =>
  typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isNum = (v: unknown) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));

function walk(n: Node, at: (c: Condition, depth: number) => void, depth = 1): number {
  if (n.kind !== "group") {
    at(n, depth);
    return depth;
  }
  let most = depth;
  for (const c of n.of) most = Math.max(most, walk(c, at, depth + 1));
  return most;
}

/** Every condition in a rule, groups flattened. */
export function conditionsOf(rule: Rule): Condition[] {
  const out: Condition[] = [];
  walk(rule, (c) => out.push(c));
  return out;
}

/** The data index rows (`people.datum` ids) a condition reads, for its "Used by". */
export function dataOf(c: Condition): string[] {
  switch (c.kind) {
    case "trait":
      return [`trait:${c.key}`];
    case "event":
      return [
        ...new Set(
          [c.event, c.after?.event, c.before?.event].flatMap((k) => (k ? [`event:${k}`] : [])),
        ),
      ];
    case "consent":
      return ["event:consent"];
    case "message":
      return c.channel === "email"
        ? ["event:email_sent"]
        : c.channel === "sms"
          ? ["event:text_sent"]
          : c.channel === "any"
            ? ["event:email_sent", "event:text_sent", "event:touch"]
            : ["event:touch"];
    case "step":
      return c.step === "booked"
        ? ["event:booking"]
        : c.step === "paid"
          ? ["event:payment"]
          : ["event:email_sent", "event:text_sent", "event:touch", "event:form"];
    case "journey":
      return ["event:journey"];
    case "segment":
      return [];
  }
}

/** The segments a rule reads. */
export const segmentsIn = (rule: Rule): number[] => [
  ...new Set(conditionsOf(rule).flatMap((c) => (c.kind === "segment" ? [c.segment] : []))),
];

/** Why a parsed rule won't run, as readable lines; empty when sound. */
export function ruleProblems(rule: Rule): string[] {
  const out: string[] = [];
  let n = 0;
  const depth = walk(rule, (c) => {
    n++;
    if (c.kind === "trait") {
      const v = c.value;
      const named = `"${c.key} ${TRAIT_OPS[c.op]}"`;
      if (c.op === "exists") {
        if (v !== undefined) out.push(`${named} takes no value`);
      } else if (v === undefined || String(v).trim() === "") out.push(`${named} needs a value`);
      else if ((c.op === "gt" || c.op === "lt") && !isNum(v)) out.push(`${named} needs a number`);
      else if ((c.op === "before" || c.op === "after") && !isDay(v))
        out.push(`${named} needs a date like 2026-12-31`);
      else if (c.op === "one_of" && !listOf(v).length) out.push(`${named} needs values`);
      else if (
        (c.op === "in_next" || c.op === "in_last") &&
        !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 3650)
      )
        out.push(`${named} needs 0 to 3650 days`);
    }
    if (c.kind === "event" || c.kind === "message") {
      const named = c.kind === "event" ? `"${c.event}"` : `"message ${c.state}"`;
      if (c.atMost === undefined && c.atLeast < 1) out.push(`${named}: at least 1, or say at most`);
      if (c.atMost !== undefined && c.atMost < c.atLeast)
        out.push(`${named}: at most is under at least`);
    }
    if (c.kind === "journey") {
      if (c.reached && !c.node) out.push('"reached" needs a node');
      if (c.window && c.days === null) out.push("a journey window needs days");
    }
    if (c.kind === "consent" && c.state === "opted_out" && c.channel !== "sms")
      out.push("only a phone opts out; email consent is withdrawn");
  });
  if (n > RULE_MOST.conditions) out.push(`at most ${RULE_MOST.conditions} conditions`);
  if (depth > RULE_MOST.depth + 1) out.push(`groups nest at most ${RULE_MOST.depth} deep`);
  return out;
}

/** A rule from anything (a request body, a model's answer): parsed and checked, or why not. */
export function readRule(raw: unknown): { rule: Rule } | { problems: string[] } {
  const got = ruleSchema.safeParse(raw);
  if (!got.success)
    return {
      problems: got.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "rule"}: ${i.message}`),
    };
  const problems = ruleProblems(got.data);
  return problems.length ? { problems } : { rule: got.data };
}

/** `YYYY-MM-DD` of `now` in UTC: the day a rule's dates count from. */
export const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const since = (now: Date, d: number | null) =>
  d === null ? null : new Date(now.getTime() - d * DAY_MS).toISOString();

const inList = (xs: readonly (string | number)[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

/** A comma list's values, trimmed, empties dropped: `one_of`'s value. */
export const listOf = (v: unknown): string[] =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** A trait's test on `t.value` (a `profile_traits` row). */
function traitTest(c: TraitCondition, now: Date): SQL {
  const v = c.value;
  const s = String(v ?? "");
  const today = dayOf(now);
  switch (c.op) {
    case "exists":
      return sql`true`;
    case "is":
      return sql`lower(t.value #>> '{}') = lower(${s})`;
    case "contains":
      return sql`strpos(lower(t.value #>> '{}'), lower(${s})) > 0`;
    case "gt":
      return sql`segment_number(t.value) > ${s}::numeric`;
    case "lt":
      return sql`segment_number(t.value) < ${s}::numeric`;
    case "before":
      return sql`segment_date(t.value) < ${s}::date`;
    case "after":
      return sql`segment_date(t.value) > ${s}::date`;
    case "in_next":
      return sql`segment_date(t.value) between ${today}::date and ${today}::date + ${Number(v)}::int`;
    case "in_last":
      return sql`segment_date(t.value) between ${today}::date - ${Number(v)}::int and ${today}::date`;
    case "one_of":
      return sql`lower(t.value #>> '{}') in (${inList(listOf(v).map((x) => x.toLowerCase()))})`;
  }
}

/** One condition as a test on `p.id`. */
function conditionSql(c: Condition, now: Date): SQL {
  if (c.kind === "trait")
    return sql`p.id in (select t.profile_id from profile_traits t
      where t.key = ${c.key} and ${traitTest(c, now)})`;
  if (c.kind === "event") {
    const from = since(now, c.days);
    const at = now.toISOString();
    const first = (a: Anchor) => sql`(select min(a.at) from profile_timeline a
      where a.profile_id = l.profile_id and a.kind = ${a.event} and a.at <= ${at}::timestamptz
        ${a.channel ? sql`and a.channel = ${a.channel}` : sql``})`;
    const lines = sql`select l.profile_id from profile_timeline l
      where l.kind = ${c.event} and l.at <= ${at}::timestamptz
        ${from ? sql`and l.at >= ${from}::timestamptz` : sql``}
        ${c.channel ? sql`and l.channel = ${c.channel}` : sql``}
        ${
          c.match
            ? sql`and (strpos(lower(coalesce(l.summary, '')), lower(${c.match})) > 0
              or strpos(lower(coalesce(l.link, '')), lower(${c.match})) > 0)`
            : sql``
        }
        ${c.after ? sql`and l.at > ${first(c.after)}` : sql``}
        ${c.before ? sql`and l.at < coalesce(${first(c.before)}, 'infinity'::timestamptz)` : sql``}
      group by l.profile_id`;
    return counted(lines, c.atLeast, c.atMost);
  }
  if (c.kind === "consent") {
    if (c.state === "opted_out")
      return sql`p.id in (select k.profile_id from profile_keys k
        join sms_contacts s on s.e164 = k.value
        where k.kind = 'phone' and s.state = 'opted_out')`;
    const keyKind = c.channel === "sms" ? "phone" : "email";
    return sql`p.id in (select k.profile_id from profile_keys k
      join consents c on c.address = k.value and c.channel = ${c.channel}
      where k.kind = ${keyKind} and c.state = ${c.state})`;
  }
  if (c.kind === "message") {
    const from = since(now, c.days);
    return counted(
      sql`select k.profile_id from profile_keys k
      join sent_records s on s.key_kind = k.kind and s.key_value = k.value
      where s.state in (${inList(MESSAGE_STATES[c.state])})
        ${c.channel === "any" ? sql`` : sql`and s.channel = ${c.channel}`}
        ${c.campaign ? sql`and strpos(lower(coalesce(s.campaign, '')), lower(${c.campaign})) > 0` : sql``}
        ${from ? sql`and s.at >= ${from}::timestamptz` : sql``}
      group by k.profile_id`,
      c.atLeast,
      c.atMost,
    );
  }
  if (c.kind === "step") return stepSql(c, now);
  if (c.kind === "journey") return journeySql(c, now);
  return sql`p.id in (select m.profile_id from segment_members m
    where m.segment_id = ${c.segment})`;
}

/**
 * Who has between `least` and `most` of `lines` (a select of `profile_id` grouped by it). At least
 * 0 is everyone but those past `most`, so "at most 0" is never.
 */
function counted(lines: SQL, least: number, most: number | undefined): SQL {
  if (least < 1) return sql`p.id not in (${lines} having count(*) > ${most ?? 0})`;
  return sql`p.id in (${lines} having count(*) >= ${least}
    ${most === undefined ? sql`` : sql`and count(*) <= ${most}`})`;
}

/**
 * A journey as a test on `p.id`, from `pipeline.journeys`. "Reached" reads the journey's own
 * trail (one `{ edge, from, to, at }` per crossing): the node is where it sits or an edge ended
 * there. A node a journey skipped is not on its trail.
 */
function journeySql(c: JourneyCondition, now: Date): SQL {
  const from = since(now, c.days);
  const clock = sql.raw(c.window === "opened" ? "j.opened_at" : "j.moved_at");
  const at = now.toISOString();
  return sql`p.id in (select j.profile_id from pipeline.journeys j
    where true
      ${c.node && !c.reached ? sql`and j.node = ${c.node}` : sql``}
      ${c.node && c.reached ? sql`and (j.node = ${c.node} or j.trail @> ${JSON.stringify([{ to: c.node }])}::jsonb)` : sql``}
      ${c.status ? sql`and j.status = ${c.status}` : sql``}
      ${c.entry ? sql`and j.entry = ${c.entry}` : sql``}
      ${from ? sql`and ${clock} >= ${from}::timestamptz and ${clock} <= ${at}::timestamptz` : sql``})`;
}

/**
 * A funnel step as a test on `p.id`. Booked and paid carry no channel: on one, it's a booking
 * after their first reach there (`any` attribution, as `channelStats` reads it by default).
 */
function stepSql(c: StepCondition, now: Date): SQL {
  const from = since(now, c.days);
  const at = now.toISOString();
  const window = sql`and s.at <= ${at}::timestamptz
    ${from ? sql`and s.at >= ${from}::timestamptz` : sql``}`;
  const where = (alias: string) => {
    const a = sql.raw(alias);
    return sql`${c.channel ? sql`and ${a}.channel = ${c.channel}` : sql``}
      ${c.source ? sql`and strpos(lower(${a}.source), lower(${c.source})) > 0` : sql``}`;
  };
  if (c.step !== "booked" && c.step !== "paid")
    return sql`p.id in (select s.profile_id from profile_steps s
      where s.step = ${c.step} ${window} ${where("s")})`;
  const reached =
    c.channel || c.source
      ? sql`and exists (select 1 from profile_steps r where r.profile_id = s.profile_id
          and r.step = 'reached' and r.at <= s.at ${where("r")})`
      : sql``;
  return sql`p.id in (select s.profile_id from profile_steps s
    where s.step = ${c.step} ${window} ${reached})`;
}

/**
 * A rule as one SQL test on a profile row aliased `p`. `now` is the moment its windows count
 * back from (tests pass a fixed one).
 */
export function compileRule(n: Node, now: Date): SQL {
  const body =
    n.kind === "group"
      ? sql`(${sql.join(
          n.of.map((c) => compileRule(c, now)),
          n.match === "all" ? sql` and ` : sql` or `,
        )})`
      : conditionSql(n, now);
  return n.not ? sql`not ${body}` : body;
}

/** The live profiles a rule matches, as a select of `id`. */
export const matchingSql = (rule: Rule, now: Date): SQL =>
  sql`select p.id from profiles p where p.merged_into is null and ${compileRule(rule, now)}`;

// ---------------------------------------------------------------------------------------------
// In words

const q = (s: string) => `"${s}"`;
/** One condition in words: `plan is "pro"`, `opened an email at least twice in 30 days`. */
export function conditionWords(c: Condition, names: ReadonlyMap<number, string> = new Map()) {
  const no = c.not ? "not " : "";
  const window = (d: number | null) => (d === null ? "ever" : `in the last ${d} days`);
  const times = (n: number, m?: number) =>
    m === undefined
      ? n === 1
        ? ""
        : ` at least ${n} times`
      : m === 0
        ? " never"
        : n > 0
          ? ` ${n} to ${m} times`
          : ` at most ${m} times`;
  const on = (ch?: string) => (ch ? ` on ${ch}` : "");
  /** "never ever" reads as just "never". */
  const span = (m: number | undefined, d: number | null) =>
    m === 0 && d === null ? "" : ` ${window(d)}`;
  if (c.kind === "trait") {
    if (c.op === "exists") return `${c.key} is ${no}set`;
    const v = typeof c.value === "number" ? String(c.value) : q(String(c.value ?? ""));
    return `${c.key} ${c.not ? "not " : ""}${TRAIT_OPS[c.op]} ${v}`;
  }
  if (c.kind === "event") {
    const name = (k: string) => TIMELINE_KIND_NAMES[k as TimelineKind].toLowerCase();
    const anchor = (w: string, a?: Anchor) => (a ? ` ${w} ${name(a.event)}${on(a.channel)}` : "");
    const matching = c.match ? ` matching ${q(c.match)}` : "";
    return `${c.not ? "no " : ""}${name(c.event)}${on(c.channel)}${matching}${times(c.atLeast, c.atMost)}${span(c.atMost, c.days)}${anchor("after", c.after)}${anchor("before", c.before)}`;
  }
  if (c.kind === "consent")
    return c.state === "opted_out"
      ? `${no}opted out of texts`
      : `${c.channel === "sms" ? "text" : "email"} consent ${no}${c.state}`;
  if (c.kind === "message") {
    const campaign = c.campaign ? ` in campaign ${q(c.campaign)}` : "";
    return `${c.not ? "no " : ""}${c.channel === "any" ? "message" : c.channel} ${c.state}${campaign}${times(c.atLeast, c.atMost)}${span(c.atMost, c.days)}`;
  }
  if (c.kind === "step") {
    const source = c.source ? ` from ${q(c.source)}` : "";
    return `${c.not ? "not " : ""}${FUNNEL_STEP_NAMES[c.step as FunnelStep].toLowerCase()}${on(c.channel)}${source} ${window(c.days)}`;
  }
  if (c.kind === "journey") {
    const node = c.node ? ` ${c.reached ? "through" : "at"} ${c.node}` : "";
    const status = c.status ? ` ${c.status}` : "";
    const entry = c.entry ? ` from ${c.entry}` : "";
    const clock = c.window === "opened" ? "opened" : "moved";
    const when = c.days === null ? "" : ` ${clock} ${window(c.days)}`;
    return `${c.not ? "no" : "a"}${status} journey${node}${entry}${when}`;
  }
  return `${no}in ${q(names.get(c.segment) ?? `segment ${c.segment}`)}`;
}

/** A rule in one line: `all of: plan is "pro", (any of: ...)`. */
export function ruleWords(n: Node, names: ReadonlyMap<number, string> = new Map()): string {
  if (n.kind !== "group") return conditionWords(n, names);
  const inner = n.of.map((c) =>
    c.kind === "group" ? `(${ruleWords(c, names)})` : ruleWords(c, names),
  );
  const head = n.of.length === 1 ? "" : `${n.match === "all" ? "all" : "any"} of: `;
  return `${n.not ? "not " : ""}${head}${inner.join(", ")}`;
}

// ---------------------------------------------------------------------------------------------
// Rows

export interface Segment {
  id: number;
  name: string;
  kind: SegmentKind;
  rule: Rule | null;
  words: string | null;
  state: SegmentState;
  size: number;
  computedAt: string | null;
  uses: SegmentUse[];
  usedAt: string;
  archivedAt: string | null;
  by: string;
  createdAt: string;
  /** Its last save, archive or restore: the version an editor saves over. */
  updatedAt: string;
  /** Saves so far (`segmentVersions`). */
  version: number;
}

type Row = Record<string, unknown>;
/** A timestamp as ISO, whichever way the driver hands it back. */
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const segmentOf = (r: Row): Segment => ({
  id: Number(r.id),
  name: String(r.name),
  kind: r.kind as SegmentKind,
  rule: (r.rule as Rule | null) ?? null,
  words: (r.words as string | null) ?? null,
  state: r.state as SegmentState,
  size: Number(r.size),
  computedAt: iso(r.computed_at),
  uses: (r.uses as SegmentUse[] | null) ?? [],
  usedAt: iso(r.used_at) as string,
  archivedAt: iso(r.archived_at),
  by: String(r.by),
  createdAt: iso(r.created_at) as string,
  updatedAt: iso(r.updated_at) as string,
  version: Number(r.version ?? 1),
});
const rows = async (db: Queryable, q: SQL) => (await db.execute(q)) as unknown as Row[];
const COLS = sql.raw(
  "id, name, kind, rule, words, state, size, computed_at, uses, used_at, archived_at, by, created_at, updated_at, version",
);

export async function segmentById(db: Queryable, id: number): Promise<Segment | null> {
  if (!Number.isSafeInteger(id)) return null;
  const [r] = await rows(db, sql`select ${COLS} from segments where id = ${id}`);
  return r ? segmentOf(r) : null;
}

/** Every segment, or those in one state, by name. */
export async function listSegments(db: Queryable, state?: SegmentState): Promise<Segment[]> {
  return (
    await rows(
      db,
      sql`select ${COLS} from segments ${state ? sql`where state = ${state}` : sql``} order by name`,
    )
  ).map(segmentOf);
}

/** Each segment's name by id, for a rule's words. */
export async function segmentNames(db: Queryable): Promise<Map<number, string>> {
  const got = await rows(db, sql`select id, name from segments`);
  return new Map(got.map((r) => [Number(r.id), String(r.name)]));
}

// ---------------------------------------------------------------------------------------------
// Members

export interface MembershipChange {
  segment: number;
  entered: number[];
  left: number[];
  size: number;
}

/**
 * Members set to `members` (a select of profile `id`s) in one statement: who is new enters, who is
 * gone leaves, and each change is kept. Two passes at once can't both say one entry: the second's
 * insert finds the row and its delete finds none.
 */
async function setMembers(
  db: Queryable,
  id: number,
  members: SQL,
  now: Date,
): Promise<MembershipChange> {
  const at = now.toISOString();
  const changed = await rows(
    db,
    sql`with wanted as (${members}),
      gone as (
        delete from segment_members m where m.segment_id = ${id}
          and not exists (select 1 from wanted w where w.id = m.profile_id)
        returning m.profile_id),
      came as (
        insert into segment_members (segment_id, profile_id, since)
        select ${id}::int, w.id, ${at}::timestamptz from wanted w
        on conflict do nothing
        returning profile_id)
    insert into segment_member_events (segment_id, profile_id, change, at)
    select ${id}::int, profile_id, 'left', ${at}::timestamptz from gone
    union all
    select ${id}::int, profile_id, 'entered', ${at}::timestamptz from came
    returning profile_id, change`,
  );
  const [size] = await rows(
    db,
    sql`update segments set size = (select count(*)::int from segment_members where segment_id = ${id}),
      computed_at = ${at}::timestamptz where id = ${id} returning size`,
  );
  return {
    segment: id,
    entered: changed.filter((r) => r.change === "entered").map((r) => Number(r.profile_id)),
    left: changed.filter((r) => r.change === "left").map((r) => Number(r.profile_id)),
    size: Number(size?.size ?? 0),
  };
}

/** A live segment's members made its rule's answer now; a snapshot's taken again. */
export async function recompute(
  db: Queryable,
  id: number,
  now: Date,
): Promise<MembershipChange | null> {
  const s = await segmentById(db, id);
  if (!s?.rule || s.kind === "manual") return null;
  return atomic(db, (tx) => setMembers(tx, id, matchingSql(s.rule as Rule, now), now));
}

/**
 * The order live segments recompute in: one read by another's rule first, so a pass sees its
 * fresh members. A cycle can't be saved (`saveSegment`); one found anyway is left to the end.
 */
export function recomputeOrder(live: readonly Pick<Segment, "id" | "rule">[]): number[] {
  const byId = new Map(live.map((s) => [s.id, s]));
  const done = new Set<number>();
  const out: number[] = [];
  const visit = (id: number, path: Set<number>) => {
    if (done.has(id) || path.has(id)) return;
    const s = byId.get(id);
    if (!s) return;
    path.add(id);
    for (const dep of s.rule ? segmentsIn(s.rule) : []) visit(dep, path);
    path.delete(id);
    done.add(id);
    out.push(id);
  };
  for (const s of live) visit(s.id, new Set());
  return out;
}

/** Every active live segment recomputed, dependencies first. */
export async function recomputeLive(db: Queryable, now: Date): Promise<MembershipChange[]> {
  const live = (await listSegments(db, "active")).filter((s) => s.kind === "live");
  const out: MembershipChange[] = [];
  for (const id of recomputeOrder(live)) {
    const c = await recompute(db, id, now);
    if (c) out.push(c);
  }
  return out;
}

/** Profiles added to a manual segment by hand; only live ones, each kept as an entry. */
export async function addMembers(
  db: Queryable,
  id: number,
  profileIds: readonly number[],
  now: Date,
): Promise<MembershipChange> {
  const s = await manualOf(db, id);
  const ids = [...new Set(profileIds.filter(Number.isSafeInteger))];
  return atomic(db, (tx) =>
    setMembers(
      tx,
      s.id,
      sql`select m.profile_id id from segment_members m where m.segment_id = ${s.id}
        union select p.id from profiles p where p.merged_into is null
          and p.id in (${ids.length ? inList(ids) : sql`null`})`,
      now,
    ),
  );
}

/**
 * The group a person said: an id, or a name in any case. A name that matches none is a new manual
 * group (`make`). A live or snapshot group follows its rule, so it refuses.
 */
export function pickGroup(
  groups: readonly Pick<Segment, "id" | "name" | "kind">[],
  said: string | number | null | undefined,
): { group: Pick<Segment, "id" | "name" | "kind"> } | { make: string } {
  const text = String(said ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) throw new PortalRefusal("pick a group or type a new name");
  const low = text.toLowerCase();
  const group = groups.find((g) => String(g.id) === low || g.name.toLowerCase() === low);
  if (!group) return { make: text };
  if (group.kind !== "manual")
    throw new PortalRefusal(`${group.name} follows a rule: only manual groups take people by hand`);
  return { group };
}

/** People put in a manual group by hand, named by id or name; a new name makes the group. */
export async function addToGroup(
  db: Queryable,
  said: string | number | null | undefined,
  profileIds: readonly number[],
  by: string,
  now: Date,
): Promise<{ group: Segment; made: boolean; change: MembershipChange }> {
  const got = pickGroup(await listSegments(db), said);
  const made = "make" in got;
  const id = made
    ? (await saveSegment(db, { name: got.make, kind: "manual" }, by, now)).segment.id
    : got.group.id;
  const change = await addMembers(db, id, profileIds, now);
  return { group: (await segmentById(db, id)) as Segment, made, change };
}

/** Profiles taken out of a manual segment. */
export async function removeMembers(
  db: Queryable,
  id: number,
  profileIds: readonly number[],
  now: Date,
): Promise<MembershipChange> {
  const s = await manualOf(db, id);
  const ids = [...new Set(profileIds.filter(Number.isSafeInteger))];
  return atomic(db, (tx) =>
    setMembers(
      tx,
      s.id,
      sql`select m.profile_id id from segment_members m where m.segment_id = ${s.id}
        ${ids.length ? sql`and m.profile_id not in (${inList(ids)})` : sql``}`,
      now,
    ),
  );
}

async function manualOf(db: Queryable, id: number): Promise<Segment> {
  const s = await segmentById(db, id);
  if (!s) throw new PortalRefusal("no such group", 404);
  if (s.kind !== "manual") throw new PortalRefusal("only a manual group takes people by hand");
  if (s.state === "archived") throw new PortalRefusal("restore it first", 409);
  return s;
}

/** One member as a sender reads them: their name and every email and phone they go by. */
export interface SegmentMember {
  profileId: number;
  name: string | null;
  emails: string[];
  phones: string[];
}

/**
 * A segment's members, the read B6 broadcasts send from: by profile id, `after` the last one a
 * page ended on, at most `limit` (1000). Counts as a use, so a segment a broadcast reads isn't
 * archived. Throws when there's no such segment.
 */
export async function segmentMembers(
  db: Queryable,
  segmentId: number,
  o: { after?: number; limit?: number; now?: Date } = {},
): Promise<SegmentMember[]> {
  const s = await segmentById(db, segmentId);
  if (!s) throw new PortalRefusal("no such group", 404);
  const limit = Math.min(Math.max(1, o.limit ?? 1000), 1000);
  const got = await rows(
    db,
    sql`select p.id, p.name,
        coalesce(array(select k.value from profile_keys k where k.profile_id = p.id
          and k.kind = 'email' order by k.id), '{}') emails,
        coalesce(array(select k.value from profile_keys k where k.profile_id = p.id
          and k.kind = 'phone' order by k.id), '{}') phones
      from segment_members m join profiles p on p.id = m.profile_id
      where m.segment_id = ${segmentId} and p.merged_into is null and m.profile_id > ${o.after ?? 0}
      order by m.profile_id limit ${limit}`,
  );
  await markUsed(db, [segmentId], o.now ?? new Date());
  return got.map((r) => ({
    profileId: Number(r.id),
    name: (r.name as string | null) ?? null,
    emails: (r.emails as string[]) ?? [],
    phones: (r.phones as string[]) ?? [],
  }));
}

/** Segments just used (heard by a trigger, read by a sender): not archived for 90 days more. */
export async function markUsed(db: Queryable, ids: readonly number[], now: Date): Promise<void> {
  if (!ids.length) return;
  await db.execute(sql`update segments set used_at = greatest(used_at, ${now.toISOString()}::timestamptz)
    where id in (${inList([...new Set(ids)])})`);
}

// ---------------------------------------------------------------------------------------------
// Saving

export interface SegmentInput {
  /** Left out: a new one. */
  id?: number | null;
  name: string;
  kind: SegmentKind;
  /** A live or snapshot segment's rule; a manual one has none. */
  rule?: unknown;
  words?: string | null;
  /** The version the editor opened on; a change since refuses the save. */
  expect?: string | null;
}

/** Why `rule`, saved on segment `id`, would read itself; null when it wouldn't. */
async function cycleOf(db: Queryable, id: number | null, rule: Rule): Promise<string | null> {
  const all = await listSegments(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const ref of segmentsIn(rule)) {
    if (!byId.has(ref)) return `no group ${ref}`;
    if (ref === id) return "a group can't be in its own rule";
  }
  if (id === null) return null;
  // Does anything this rule reads read `id`, however far down?
  const seen = new Set<number>();
  const reads = (s: number): boolean => {
    if (s === id) return true;
    if (seen.has(s)) return false;
    seen.add(s);
    const r = byId.get(s)?.rule;
    return !!r && byId.get(s)?.kind === "live" && segmentsIn(r).some(reads);
  };
  const back = segmentsIn(rule).find(reads);
  return back ? `${byId.get(back)?.name ?? back} already reads this group` : null;
}

/**
 * A segment made or changed, checked, and its members worked out: a live one's now, a new
 * snapshot's taken. A segment's kind stays what it was made as.
 */
export async function saveSegment(
  db: Queryable,
  input: SegmentInput,
  by: string,
  now: Date,
): Promise<{ segment: Segment; change: MembershipChange | null }> {
  const name = String(input.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 120) throw new PortalRefusal("a name of 1 to 120 characters");
  const kind = input.kind;
  if (!["live", "manual", "snapshot"].includes(kind))
    throw new PortalRefusal("live, manual or snapshot");
  let rule: Rule | null = null;
  if (kind !== "manual") {
    const got = readRule(input.rule);
    if ("problems" in got) throw new PortalRefusal(`the rule: ${got.problems.join("; ")}`, 422);
    rule = got.rule;
  }
  const id = input.id ?? null;
  const was = id === null ? null : await segmentById(db, id);
  if (id !== null && !was) throw new PortalRefusal("no such group", 404);
  if (was && was.kind !== kind) throw new PortalRefusal("a group keeps its kind; make a new one");
  if (was?.state === "archived") throw new PortalRefusal("restore it first", 409);
  const expect = input.expect ? new Date(input.expect) : null;
  if (expect && Number.isNaN(expect.getTime()))
    throw new PortalRefusal("expect is a version", 400, "expect");
  if (was && expect && was.updatedAt !== expect.toISOString()) throw staleRefusal("group");
  if (rule) {
    const cycle = await cycleOf(db, id, rule);
    if (cycle) throw new PortalRefusal(cycle, 422);
  }
  const clash = await rows(
    db,
    sql`select id from segments where name = ${name} ${id === null ? sql`` : sql`and id <> ${id}`}`,
  );
  if (clash.length) throw new PortalRefusal(`there's a group called ${name} already`, 409);
  const at = now.toISOString();
  const words = input.words?.trim().slice(0, 2000) || null;
  const ruleJson = rule ? JSON.stringify(rule) : null;
  const [row] =
    id === null
      ? await rows(
          db,
          sql`insert into segments (name, kind, rule, words, by, used_at, created_at, updated_at)
            values (${name}, ${kind}, ${ruleJson}::jsonb, ${words}, ${by}, ${at}::timestamptz,
              ${at}::timestamptz, ${at}::timestamptz) returning id`,
        )
      : await rows(
          db,
          sql`update segments set name = ${name}, rule = ${ruleJson}::jsonb,
              words = ${words}, used_at = ${at}::timestamptz, updated_at = ${at}::timestamptz,
              version = version + 1
            where id = ${id} and date_trunc('milliseconds', updated_at) = ${was?.updatedAt}::timestamptz
            returning id`,
        );
  if (!row) throw staleRefusal("group");
  const sid = Number(row?.id);
  await db.execute(sql`insert into segment_versions (segment_id, version, name, kind, rule, words, by, at)
    select id, version, name, kind, rule, words, ${by}, ${at}::timestamptz from segments
    where id = ${sid}`);
  // A snapshot is taken once, when made; "take again" retakes it.
  const change =
    kind === "live" || (kind === "snapshot" && id === null) ? await recompute(db, sid, now) : null;
  return { segment: (await segmentById(db, sid)) as Segment, change };
}

export interface SegmentVersion {
  version: number;
  name: string;
  kind: SegmentKind;
  rule: Rule | null;
  words: string | null;
  by: string;
  at: string;
}

/** A segment's saves, newest first. */
export async function segmentVersions(db: Queryable, id: number): Promise<SegmentVersion[]> {
  if (!Number.isSafeInteger(id)) return [];
  const got = await rows(
    db,
    sql`select version, name, kind, rule, words, by, at from segment_versions
      where segment_id = ${id} order by version desc limit 200`,
  );
  return got.map((r) => ({
    version: Number(r.version),
    name: String(r.name),
    kind: r.kind as SegmentKind,
    rule: (r.rule as Rule | null) ?? null,
    words: (r.words as string | null) ?? null,
    by: String(r.by),
    at: iso(r.at) as string,
  }));
}

/** A snapshot taken again now. */
export async function retake(db: Queryable, id: number, now: Date): Promise<MembershipChange> {
  const s = await segmentById(db, id);
  if (!s) throw new PortalRefusal("no such group", 404);
  if (s.kind !== "snapshot") throw new PortalRefusal("only a snapshot is taken again");
  if (s.state === "archived") throw new PortalRefusal("restore it first", 409);
  return (await recompute(db, id, now)) as MembershipChange;
}

/** The active segments whose rule reads `id`. */
async function readersOf(db: Queryable, id: number): Promise<Segment[]> {
  return (await listSegments(db, "active")).filter(
    (s) => s.id !== id && s.rule && segmentsIn(s.rule).includes(id),
  );
}

/**
 * A segment archived: off every pass, its members kept as they were. Refused while a workflow or
 * an active segment uses it.
 */
export async function archiveSegment(db: Queryable, id: number, now: Date): Promise<Segment> {
  const s = await segmentById(db, id);
  if (!s) throw new PortalRefusal("no such group", 404);
  if (s.state === "archived") return s;
  const readers = await readersOf(db, id);
  const used = [
    ...s.uses.filter((u) => u.kind !== "segment").map((u) => u.name),
    ...readers.map((r) => r.name),
  ];
  if (used.length) throw new PortalRefusal(`it's used by ${used.join(", ")}`, 409);
  await db.execute(sql`update segments set state = 'archived', archived_at = ${now.toISOString()}::timestamptz,
    updated_at = ${now.toISOString()}::timestamptz where id = ${id}`);
  return (await segmentById(db, id)) as Segment;
}

/** One click back: active again, counted as used today, a live one recomputed. */
export async function restoreSegment(
  db: Queryable,
  id: number,
  now: Date,
): Promise<{ segment: Segment; change: MembershipChange | null }> {
  const s = await segmentById(db, id);
  if (!s) throw new PortalRefusal("no such group", 404);
  const at = now.toISOString();
  await db.execute(sql`update segments set state = 'active', archived_at = null,
    used_at = ${at}::timestamptz, updated_at = ${at}::timestamptz where id = ${id}`);
  const change = s.kind === "live" ? await recompute(db, id, now) : null;
  return { segment: (await segmentById(db, id)) as Segment, change };
}

/** Unused this long, a segment is archived. */
export const ARCHIVE_AFTER_DAYS = 90;

/**
 * Segments nothing used for 90 days, archived: no workflow or active segment uses them, and
 * nothing read or changed them since. Returns their ids.
 */
export async function archiveUnused(db: Queryable, now: Date): Promise<number[]> {
  const cut = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY_MS).toISOString();
  const active = await listSegments(db, "active");
  const read = new Set(active.flatMap((s) => (s.rule ? segmentsIn(s.rule) : [])));
  const stale = active.filter(
    (s) => s.usedAt < cut && !read.has(s.id) && !s.uses.some((u) => u.kind !== "segment"),
  );
  if (!stale.length) return [];
  const ids = stale.map((s) => s.id);
  await db.execute(sql`update segments set state = 'archived', archived_at = ${now.toISOString()}::timestamptz
    where id in (${inList(ids)}) and state = 'active'`);
  return ids;
}

/**
 * What uses each segment, written on its row: the workflows given (their Segment triggers) and
 * the active segments whose rule reads it. Something using a segment counts as using it today.
 */
export async function setUses(
  db: Queryable,
  workflows: ReadonlyMap<number, readonly SegmentUse[]>,
  now: Date,
): Promise<void> {
  const all = await listSegments(db);
  const uses = new Map<number, SegmentUse[]>(
    all.map((s) => [s.id, [...(workflows.get(s.id) ?? [])]]),
  );
  for (const s of all)
    if (s.state === "active" && s.rule)
      for (const ref of segmentsIn(s.rule))
        uses.get(ref)?.push({ kind: "segment", id: String(s.id), name: s.name });
  for (const s of all) {
    const next = uses.get(s.id) ?? [];
    if (!next.length && !s.uses.length) continue;
    await db.execute(sql`update segments set uses = ${JSON.stringify(next)}::jsonb
      ${next.length ? sql`, used_at = greatest(used_at, ${now.toISOString()}::timestamptz)` : sql``}
      where id = ${s.id}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Preview

export interface Preview {
  size: number;
  /** Up to 20 of them, by name. */
  sample: { id: number; name: string }[];
  words: string;
}

/** How many a rule matches now, and a few of them: what the editor shows before a save. */
export async function previewRule(db: Queryable, raw: unknown, now: Date): Promise<Preview> {
  const got = readRule(raw);
  if ("problems" in got) throw new PortalRefusal(got.problems.join("; "), 422);
  const names = await segmentNames(db);
  for (const ref of segmentsIn(got.rule))
    if (!names.has(ref)) throw new PortalRefusal(`no group ${ref}`, 422);
  const m = matchingSql(got.rule, now);
  const [n] = await rows(db, sql`select count(*)::int n from (${m}) x`);
  const sample = await rows(
    db,
    sql`select p.id, coalesce(p.name, '#' || p.id) "name" from profiles p
      where p.id in (${m}) order by p.last_seen desc limit 20`,
  );
  return {
    size: Number(n?.n ?? 0),
    sample: sample.map((r) => ({ id: Number(r.id), name: String(r.name) })),
    words: ruleWords(got.rule, names),
  };
}

// ---------------------------------------------------------------------------------------------
// Describe

/** The model seam, by shape: `@wren/llm`'s client, metered or not. */
/**
 * Is this person in the segment now? A merged profile answers as the one it merged into. A live
 * segment (or a bare rule) is checked by its rule, for this one person, at `now`; a manual or
 * snapshot one by its members. The spine's In segment step asks this.
 */
export async function inSegment(
  db: Queryable,
  profileId: number,
  of: number | Segment | Rule,
  now: Date,
): Promise<boolean> {
  if (!Number.isSafeInteger(profileId)) return false;
  const [who] = await rows(
    db,
    sql`with recursive up(id, next, n) as (
        select id, merged_into, 0 from profiles where id = ${profileId}
        union all select p.id, p.merged_into, up.n + 1 from profiles p join up on p.id = up.next
          where up.n < 20)
      select id from up where next is null limit 1`,
  );
  if (!who) return false;
  const id = Number(who.id);
  const seg = typeof of === "number" ? await segmentById(db, of) : of.kind !== "group" ? of : null;
  if (typeof of === "number" && !seg) return false;
  const rule: Rule | null = seg ? (seg.kind === "live" ? seg.rule : null) : (of as Rule);
  if (seg && !rule) {
    const [m] = await rows(
      db,
      sql`select 1 from segment_members where segment_id = ${seg.id} and profile_id = ${id}`,
    );
    return !!m;
  }
  if (!rule) return false;
  const [hit] = await rows(
    db,
    sql`select 1 from profiles p where p.id = ${id} and p.merged_into is null
      and ${compileRule(rule, now)}`,
  );
  return !!hit;
}

export interface SegmentModel {
  complete(
    prompt: string,
    opts?: { maxTokens?: number; system?: string },
  ): Promise<{ text: string }>;
}

/**
 * The shape as a journey condition picks from it: the newest version's nodes that hold people
 * (by depth, then name) and its source ids. Empty when the workspace has no shape yet.
 */
export interface JourneyShape {
  nodes: { id: string; name: string; kind: string; depth: number }[];
  sources: string[];
}

/** What the model is told the workspace has, so it names real traits and segments. */
export interface DescribeContext {
  traits: readonly string[];
  segments: readonly { id: number; name: string }[];
  /** The workspace's shape, for journey conditions. */
  shape?: JourneyShape;
  /** The day it's asked, for words like "this month". */
  today: string;
}

const SHAPE = `A rule is JSON: {"kind":"group","match":"all"|"any","of":[...]}. Each item in "of" is a group or one condition. Any item may have "not": true.
Conditions:
- {"kind":"trait","key":"<trait key>","op":"is"|"contains"|"one_of"|"gt"|"lt"|"exists"|"before"|"after"|"in_next"|"in_last","value":<string or number>}. "exists" has no value. one_of takes "a, b, c". gt/lt take a number. before/after take "YYYY-MM-DD". in_next/in_last take whole days.
- {"kind":"event","event":"<timeline kind>","channel":"<optional: email, sms, linkedin, reddit, x, site...>","match":"<optional words its line holds>","atLeast":<n>,"atMost":<optional n; 0 is never>,"days":<n or null for ever>,"after":<optional {"event":"<kind>","channel":"<optional>"}>,"before":<optional, same>}
- {"kind":"consent","channel":"email"|"sms","state":"confirmed"|"pending"|"withdrawn"|"opted_out"}. opted_out is sms only.
- {"kind":"message","state":"sent"|"delivered"|"opened"|"clicked"|"replied"|"bounced"|"failed","channel":"any"|"email"|"sms"|"linkedin"|"reddit"|"x"|"instagram"|"youtube"|"tiktok"|"facebook","campaign":"<optional words>","atLeast":<n>,"atMost":<optional n>,"days":<n or null>}
- {"kind":"step","step":"reached"|"saw"|"engaged"|"replied"|"booked"|"paid","channel":"<optional channel>","source":"<optional campaign, post or link words>","days":<n or null>}
- {"kind":"journey","node":"<optional node id>","reached":<optional true: the node is on its trail or where it sits>,"status":"open"|"done"|"dropped" (optional),"entry":"<optional source node id>","window":"moved"|"opened" (optional, which clock days counts on),"days":<n or null>}. Matches people who hold such a journey.
- {"kind":"segment","segment":<segment id>}`;

const shapeLine = (s: JourneyShape | undefined) =>
  s?.nodes.length
    ? `nodes by depth: ${s.nodes.map((n) => `${n.id} (${n.kind}, ${n.depth})`).join(", ")}; sources: ${s.sources.join(", ") || "none"}`
    : "none yet";

/** The prompt `describeSegment` sends: the shape, what the workspace has, and the words. */
export function describePrompt(words: string, c: DescribeContext): string {
  const kinds = TIMELINE_KINDS.map((k) => `${k} (${TIMELINE_KIND_NAMES[k]})`).join(", ");
  const segs = c.segments.length
    ? c.segments.map((s) => `${s.id} = ${s.name}`).join("; ")
    : "none yet";
  return [
    SHAPE,
    `Timeline kinds: ${kinds}.`,
    `Trait keys in this workspace: ${c.traits.length ? c.traits.join(", ") : "none yet"}.`,
    `Segments: ${segs}.`,
    `Shape: ${shapeLine(c.shape)}.`,
    `Today is ${c.today}.`,
    "",
    `Describe these people as a rule: ${words.trim()}`,
    "",
    'Answer with JSON only: {"rule": <the rule>, "name": "<a short name for the segment>"}. If the words ask for something no condition can say, answer {"error": "<why, in one sentence>"}.',
  ].join("\n");
}

const DESCRIBE_SYSTEM =
  "You turn a plain description of a group of people into a segment rule. Use only the condition shapes, trait keys, timeline kinds and segment ids given. Never invent a trait key.";

/** The JSON object in a model's answer: fenced or bare, the first `{` to the last `}`. */
export function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const a = fenced.indexOf("{");
  const b = fenced.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(fenced.slice(a, b + 1));
  } catch {
    return null;
  }
}

export type Described =
  | { rule: Rule; name: string; words: string; unknownTraits: string[] }
  | { error: string };

/**
 * Plain words as a rule, by the model: parsed and checked like any rule, never saved here. The
 * page shows it in words for a yes. A trait key the workspace doesn't have yet is named back
 * (`unknownTraits`), not refused: a rule may wait for data that's coming.
 */
export async function describeSegment(
  model: SegmentModel,
  words: string,
  c: DescribeContext,
): Promise<Described> {
  const said = words.trim();
  if (!said) return { error: "say who should be in it" };
  if (said.length > 1000) return { error: "say it in under 1000 characters" };
  const answer = await model.complete(describePrompt(said, c), {
    maxTokens: 1200,
    system: DESCRIBE_SYSTEM,
  });
  const raw = jsonIn(answer.text) as { rule?: unknown; name?: unknown; error?: unknown } | null;
  if (!raw || typeof raw !== "object")
    return { error: "the model's answer didn't read; try other words" };
  if (typeof raw.error === "string" && !raw.rule) return { error: raw.error.slice(0, 300) };
  const got = readRule(raw.rule);
  if ("problems" in got)
    return { error: `the model's rule didn't check: ${got.problems.join("; ")}` };
  const known = new Set(c.segments.map((s) => s.id));
  const missing = segmentsIn(got.rule).filter((s) => !known.has(s));
  if (missing.length) return { error: `the model named no group we have (${missing.join(", ")})` };
  const traits = new Set(c.traits);
  const unknownTraits = [
    ...new Set(
      conditionsOf(got.rule).flatMap((x) =>
        x.kind === "trait" && !traits.has(x.key) ? [x.key] : [],
      ),
    ),
  ];
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 120)
      : said.slice(0, 60);
  const names = new Map(c.segments.map((s) => [s.id, s.name]));
  return { rule: got.rule, name, words: ruleWords(got.rule, names), unknownTraits };
}

/** A workspace's shape at its newest version, for the editor and the model. */
export async function journeyShape(db: Queryable): Promise<JourneyShape> {
  const got = await rows(
    db,
    sql`select body, depths from pipeline.shape_versions order by number desc limit 1`,
  );
  const row = got[0];
  if (!row) return { nodes: [], sources: [] };
  const body = row.body as { nodes?: { id: string; name?: string; kind: string }[] };
  const depths = (row.depths ?? {}) as Record<string, number>;
  const all = body.nodes ?? [];
  return {
    nodes: all
      .filter((n) => n.kind !== "source")
      .map((n) => ({ id: n.id, name: n.name ?? n.id, kind: n.kind, depth: depths[n.id] ?? 0 }))
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)),
    sources: all.filter((n) => n.kind === "source").map((n) => n.id),
  };
}

/** The trait keys a workspace has, for the editor and the model. */
export async function traitKeys(db: Queryable): Promise<string[]> {
  return (await rows(db, sql`select distinct key from profile_traits order by key limit 500`)).map(
    (r) => String(r.key),
  );
}

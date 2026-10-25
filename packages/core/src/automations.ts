/**
 * Every automation in one list (designs/2026-10-14-automations.md): workflows (built-in and made),
 * loops by service, comment keyword DMs and auto-replies. Each row has its trigger in words, its
 * runs over 30 days, what failed and waits, its last and next run, its last error and whether it
 * is on. Read from what's already kept; nothing here writes.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { Component } from "./components.js";
import type { LoopRow } from "./console.js";
import { logicOf } from "./logic.js";
import { date, defineRecord, named, number, type RecordType, status, text } from "./records.js";
import { codeLabel } from "./template-labels.js";
import { isMade, type Made, type Workflow, type WorkflowEdits } from "./workflows.js";

const AUTOMATION = "console.automation";
/** Runs counted over this many days. */
const AUTOMATION_DAYS = 30;

export type AutomationKind = "workflow" | "made" | "loop" | "keyword" | "reply";
export type AutomationState = "on" | "off" | "draft" | "suggest" | "auto";

export interface AutomationRow {
  /** `workflow:<id>`, `loop:<service>`, `keyword:<id>`, `reply:<channel>`. */
  id: string;
  name: string;
  kind: AutomationKind;
  /** What starts it, in words. */
  trigger: string;
  state: AutomationState;
  health: "failing" | "ok";
  /** Subjects that entered in the last 30 days (a loop: keys running; a keyword: DMs caught). */
  runs: number | null;
  failed: number | null;
  waiting: number | null;
  lastAt: string | null;
  nextAt: string | null;
  error: string | null;
  /** The workflow id, loop service, keyword id or channel the row stands for. */
  ref: string;
}

/** One workflow's spine numbers, per subject the way `spine_executions` counts them. */
interface FlowStats {
  workflow: string;
  runs: number;
  failed: number;
  waiting: number;
  lastAt: string | null;
  nextAt: string | null;
  error: string | null;
}

/** A made workflow as its newest save has it, and whether its live save is switched off. */
interface MadeFlow {
  id: string;
  made: Made;
  live: boolean;
  draft: boolean;
  off: boolean;
  nodes: Workflow["nodes"];
}

interface KeywordRow {
  id: string;
  keyword: string;
  platform: string;
  state: string;
  caught: number;
  sent: number;
  failed: number;
  lastAt: string | null;
}

interface AutomationInput {
  workflows: readonly Workflow[];
  components: readonly Component[];
  stats: readonly FlowStats[];
  made: readonly MadeFlow[];
  /** Null when Restate's admin can't be read: no loop rows, never a wrong "off". */
  loops: readonly LoopRow[] | null;
  keywords: readonly KeywordRow[];
  replies: Readonly<Record<string, string>>;
}

const CHANNEL_WORDS: Record<string, string> = {
  email: "Email",
  text: "Texts",
  dm: "DMs",
  comment: "Comments",
  chat: "Site chat",
};

/** How someone writes in on each, for an auto-reply's trigger. */
const CHANNEL_IN: Record<string, string> = {
  email: "an email",
  text: "a text",
  dm: "a DM",
  comment: "a comment",
  chat: "site chat",
};

const NO_TRIGGER = "No trigger yet";
/** What starts a workflow: its trigger nodes in their own words, else what comes in. */
export function triggerWords(w: Pick<Workflow, "nodes" | "in">): string {
  const said = w.nodes.flatMap((n) => {
    const l = logicOf(n.uses);
    return l?.group === "trigger" ? [l.says(n.with ?? {})] : [];
  });
  if (said.length) return said.join("; ");
  if (w.in.length) return `Takes in ${w.in.map((p) => p.label).join(" and ")}`;
  return NO_TRIGGER;
}

const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const soonest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Every row, from what was read. Pure, so a test can give it anything. */
export function automationRows(i: AutomationInput): AutomationRow[] {
  const stats = new Map(i.stats.map((s) => [s.workflow, s]));
  const madeIds = new Set(i.made.map((m) => m.id));
  const flows: AutomationRow[] = i.workflows
    .filter(
      (w) =>
        w.kind !== "setup" &&
        w.id !== "wren" &&
        !madeIds.has(w.id) &&
        (w.for === "wren" || stats.has(w.id)),
    )
    .map((w) => {
      const s = stats.get(w.id);
      return {
        id: `workflow:${w.id}`,
        name: w.name,
        kind: "workflow",
        // Built in with no trigger node and nothing coming in: its loops feed it.
        trigger: triggerWords(w).replace(NO_TRIGGER, "Fed by its loops"),
        state: "on",
        health: s?.failed ? "failing" : "ok",
        runs: s?.runs ?? 0,
        failed: s?.failed ?? 0,
        waiting: s?.waiting ?? 0,
        lastAt: s?.lastAt ?? null,
        nextAt: s?.nextAt ?? null,
        error: s?.error ?? null,
        ref: w.id,
      };
    });
  const made: AutomationRow[] = i.made.map((m) => {
    const s = stats.get(m.id);
    return {
      id: `workflow:${m.id}`,
      name: m.made.name,
      kind: "made",
      trigger: triggerWords({ nodes: m.nodes, in: [] }),
      state: !m.live ? "draft" : m.off ? "off" : "on",
      health: s?.failed ? "failing" : "ok",
      runs: s?.runs ?? 0,
      failed: s?.failed ?? 0,
      waiting: s?.waiting ?? 0,
      lastAt: s?.lastAt ?? null,
      nextAt: s?.nextAt ?? null,
      error: s?.error ?? null,
      ref: m.id,
    };
  });
  const owner = new Map<string, Component>();
  for (const c of i.components) for (const l of c.provides.loops) owner.set(l, c);
  const services = new Map<string, LoopRow[]>();
  for (const l of i.loops ?? []) services.set(l.service, [...(services.get(l.service) ?? []), l]);
  const loops: AutomationRow[] = [...services].map(([service, keys]) => {
    const running = keys.filter((k) => k.running);
    const failing = running.filter((k) => k.failures > 0 || k.error !== null);
    const c = owner.get(service);
    const each = keys.length > 1 ? `, ${keys.length} keys` : "";
    return {
      id: `loop:${service}`,
      name: c ? `${c.name}: ${codeLabel(service)}` : codeLabel(service),
      kind: "loop",
      trigger: `Runs on its own, pass after pass${each}`,
      state: running.length ? "on" : "off",
      health: failing.length ? "failing" : "ok",
      runs: running.length,
      failed: failing.length,
      waiting: null,
      lastAt: keys.reduce<string | null>((a, k) => latest(a, k.lastAt), null),
      nextAt: running.reduce<string | null>((a, k) => soonest(a, k.nextAt), null),
      error: failing.find((k) => k.error)?.error ?? null,
      ref: service,
    };
  });
  const keywords: AutomationRow[] = i.keywords.map((k) => ({
    id: `keyword:${k.id}`,
    name: `Comment “${k.keyword}” → DM`,
    kind: "keyword",
    trigger: `Someone comments “${k.keyword}” on ${
      k.platform === "any" ? "Instagram or Facebook" : codeLabel(k.platform)
    }`,
    state: k.state === "on" ? "on" : "off",
    health: "ok",
    runs: k.caught,
    failed: k.failed,
    waiting: null,
    lastAt: k.lastAt,
    nextAt: null,
    error: null,
    ref: k.id,
  }));
  const replies: AutomationRow[] = Object.entries(i.replies).map(([channel, mode]) => ({
    id: `reply:${channel}`,
    name: `Auto-reply: ${CHANNEL_WORDS[channel] ?? codeLabel(channel)}`,
    kind: "reply",
    trigger: `Someone writes in: ${CHANNEL_IN[channel] ?? codeLabel(channel).toLowerCase()}`,
    state: mode === "off" ? "off" : mode === "auto" ? "auto" : "suggest",
    health: "ok",
    runs: null,
    failed: null,
    waiting: null,
    lastAt: null,
    nextAt: null,
    error: null,
    ref: channel,
  }));
  return [...made, ...flows, ...keywords, ...replies, ...loops];
}

const rowsOf = async <T>(db: Queryable, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Each workflow's numbers from `events`: one subject is one run. */
async function flowStats(db: Queryable): Promise<FlowStats[]> {
  const got = await rowsOf<Record<string, unknown>>(
    db,
    sql`select workflow,
        count(*) filter (where entered > now() - make_interval(days => ${AUTOMATION_DAYS}))::int runs,
        count(*) filter (where failed)::int failed,
        count(*) filter (where waiting and not failed)::int waiting,
        max(last_at) last_at,
        min(due) filter (where waiting and not failed) next_at,
        (array_agg(error order by last_at desc) filter (where failed))[1] error
      from (select workflow, subject, min(at) entered, max(coalesce(sent_at, at)) last_at,
          bool_or(error is not null) failed, bool_or(due is not null) waiting, min(due) due,
          max(error) error
        from events group by workflow, subject) x
      group by workflow`,
  );
  return got.map((r) => ({
    workflow: String(r.workflow),
    runs: Number(r.runs),
    failed: Number(r.failed),
    waiting: Number(r.waiting),
    lastAt: iso(r.last_at),
    nextAt: iso(r.next_at),
    error: (r.error as string | null) ?? null,
  }));
}

/** Wren's made workflows: the newest save's graph, live or not, and the live one's switch. */
async function madeFlows(db: Queryable): Promise<MadeFlow[]> {
  const got = await rowsOf<{ workflow: string; edits: WorkflowEdits | null; live: boolean }>(
    db,
    sql`select workflow, edits, live from workflow_saves
      where client is null and workflow like 'made.%' order by workflow, id desc`,
  );
  const out = new Map<string, MadeFlow>();
  for (const r of got) {
    if (!isMade(r.workflow)) continue;
    const had = out.get(r.workflow);
    if (had) {
      // Older rows: the first live one is the switch that counts.
      if (r.live && !had.live) Object.assign(had, { live: true, off: r.edits?.off === true });
      continue;
    }
    if (!r.edits?.made) continue;
    out.set(r.workflow, {
      id: r.workflow,
      made: r.edits.made,
      live: r.live,
      draft: !r.live,
      off: r.live && r.edits.off === true,
      nodes: r.edits.steps,
    });
  }
  return [...out.values()];
}

async function keywordRows(db: Queryable): Promise<KeywordRow[]> {
  const got = await rowsOf<Record<string, unknown>>(
    db,
    sql`select id, keyword, platform, state, caught, sent, failed, last_at
      from comment_keyword_records order by keyword`,
  );
  return got.map((r) => ({
    id: String(r.id),
    keyword: String(r.keyword),
    platform: String(r.platform),
    state: String(r.state),
    caught: Number(r.caught),
    sent: Number(r.sent),
    failed: Number(r.failed),
    lastAt: iso(r.last_at),
  }));
}

/** Each inbox channel's auto-reply mode; a channel with no row is Suggest. */
async function replyModes(db: Queryable): Promise<Record<string, string>> {
  const got = await rowsOf<{ channel: string; mode: string }>(
    db,
    sql`select channel, mode from auto_replies`,
  );
  const out: Record<string, string> = Object.fromEntries(
    Object.keys(CHANNEL_WORDS).map((c) => [c, "suggest"]),
  );
  for (const r of got) out[r.channel] = r.mode;
  return out;
}

const STATES = {
  on: { label: "On", tone: "good" },
  off: { label: "Off", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  suggest: { label: "Suggests", tone: "good" },
  auto: { label: "Auto (held)", tone: "good" },
} as const;

const KIND_STATES = {
  made: { label: "Made here", tone: "neutral" },
  workflow: { label: "Built in", tone: "neutral" },
  keyword: { label: "Keyword DM", tone: "neutral" },
  reply: { label: "Auto-reply", tone: "neutral" },
  loop: { label: "Loop", tone: "neutral" },
} as const;

/**
 * The record behind Workflows → All. Wren's workspace: its own database. `loops` reads Restate's
 * loop objects; without it (no admin here) there are no loop rows.
 */
export function automationRecord(o: {
  workflows: readonly Workflow[];
  components: readonly Component[];
  loops?: (() => Promise<LoopRow[]>) | null;
}): RecordType {
  return defineRecord({
    id: AUTOMATION,
    app: "workflows",
    channel: null,
    name: { one: "automation", many: "automations" },
    rows: async (db) => {
      const [stats, made, loops, keywords, replies] = await Promise.all([
        flowStats(db),
        madeFlows(db),
        o.loops ? o.loops().catch(() => null) : Promise.resolve(null),
        keywordRows(db),
        replyModes(db),
      ]);
      return automationRows({
        workflows: o.workflows,
        components: o.components,
        stats,
        made,
        loops,
        keywords,
        replies,
      }).map((r) => ({ ...r }));
    },
    key: "id",
    title: "name",
    subtitle: "trigger",
    fields: {
      name: text("Automation"),
      kind: status(KIND_STATES, "Kind"),
      trigger: text("Starts when"),
      state: status(STATES, "State"),
      health: status(
        { failing: { label: "Failing", tone: "bad" }, ok: { label: "OK", tone: "good" } },
        "Health",
      ),
      runs: number(`Runs, ${AUTOMATION_DAYS} days`),
      failed: number("Failed"),
      waiting: number("Waiting"),
      lastAt: date("Last run"),
      nextAt: date("Next"),
      error: text("Last error", { words: "reason" }),
      ref: named("Id", { listed: false }),
    },
    views: [
      { id: "all", label: "All", sort: "kind" },
      { id: "failing", label: "Failing", where: { health: "failing" }, sort: "-lastAt" },
      { id: "off", label: "Off", where: { state: ["off", "draft"] }, sort: "name" },
    ],
  });
}

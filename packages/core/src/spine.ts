/**
 * The spine (designs/2026-10-05-workflows.md): events move along a workflow's routed wires. An
 * event leaves a node's output, or the workflow's own input. Each routed wire from there passes
 * it on, after its rule and its wait, and it arrives at the next node's input. That node's step
 * runs, and what it returns leaves on its outputs in turn. A node whose part has no step yet
 * (planned, or moved by its own code) keeps the arrival and stops there. One walk is one Restate
 * call; every arrival is a row in `events`, so nothing enters a node twice.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Component, EventKind, LoopKey } from "./components.js";
import { type FieldMap, leadOf } from "./door.js";
import { hashToken, newToken } from "./doors.js";
import {
  dig,
  doorOf,
  holdOf,
  logicOf,
  logicSteps,
  nextSlot,
  type TriggerFacts,
  triggerHears,
} from "./logic.js";
import { hooks, type SentEvent, workflowInstalls, workflowSaves } from "./schema.js";
import { flowsWith, type Workflow, type WorkflowEdits, type WorkflowNode } from "./workflows.js";

export interface SpineEvent {
  /** Who or what it is about, unique per thing: "lead:42". */
  subject: string;
  kind: EventKind;
  data: Record<string, unknown>;
}

/** Where a step runs: whose database, which node, and that node's settings. */
export interface StepAt {
  client: string | null;
  workflow: string;
  /** Dotted from the top workflow. */
  node: string;
  with: Record<string, string | number>;
}

/** A part's code on the spine: an event at one of its inputs in, events on its outputs out. */
export type Step = (
  port: string,
  e: SpineEvent,
  at: StepAt,
) => Promise<Array<{ port: string; event: SpineEvent }>>;

/**
 * A touch given another channel's lead (a mixed cadence: a text between two emails) sends nothing
 * and passes the lead on as `sent`, so the cadence goes on. Reaching that lead on this channel
 * would need an enroll there, and who may be enrolled is a consent call. Null for its own lead.
 */
export const passOn = (e: SpineEvent, channel: "email" | "sms" | "reach") =>
  e.subject.startsWith(`lead:${channel}:`) ? null : [{ port: "sent", event: e }];

/** An event at a node's input: `node` is the dotted path from `workflow` down. */
export interface Arrival {
  workflow: string;
  node: string;
  port: string;
  event: SpineEvent;
  /** The wiring its subject entered on (`events.version`): a save's id, 0 the code's. */
  version?: number | null;
}

export interface SpineStore {
  /**
   * Keep an arrival, owned by `by`. Its id when new, or when `by` already owns it (a retry);
   * null when another call kept it first. With `due`, it waits on its wire until then.
   */
  claim(a: Arrival, by: string, due?: Date): Promise<string | null>;
  /**
   * The wiring `subject` entered `workflow` on: a save's id, 0 the code's, null from before
   * versions (it walks the live one), undefined when it never entered.
   */
  entered?(workflow: string, subject: string): Promise<number | null | undefined>;
  /** Take a waiting arrival for `by`; null when another call took it. */
  release(id: string, by: string): Promise<Arrival | null>;
  /** Its step failed past its retries: the event stops here, with why. */
  fail(a: Arrival, error: string): Promise<void>;
  /** Take a failed arrival for `by` to run again, its error cleared; null when it isn't failed. */
  retry(id: string, by: string): Promise<Arrival | null>;
  /** What the arrival's step sent on, kept for its execution's page. */
  sent?(id: string, outs: Array<{ port: string; event: SpineEvent }>): Promise<void>;
}

export interface Walk {
  flows: ReadonlyMap<string, Workflow>;
  /** The wiring this walk is on, kept on each arrival: a save's id, 0 the code's. */
  version?: number;
  /** A workflow's live wiring: its newest live save's id, 0 the code's. */
  liveOf?(workflow: string): number;
  /** The flows with `workflow` on an older wiring, for a subject that entered on it. */
  flowsAt?(workflow: string, version: number): Promise<ReadonlyMap<string, Workflow>>;
  parts: ReadonlyMap<string, Component>;
  /** By part id, or a custom step's registered name. */
  steps: Readonly<Record<string, Step>>;
  store: SpineStore;
  /** Whose database the store is in; null is Wren's. */
  client: string | null;
  /** This call's id: who owns what it claims. */
  by: string;
  /** Journaled once (ctx.run); `capped` gives up after a few tries with a TerminalError. */
  run<T>(name: string, fn: () => Promise<T>, capped?: boolean): Promise<T>;
  /** Release a waiting arrival after `ms`. */
  later(id: string, ms: number): void;
  /** Does the event pass a wire's rule, in words? */
  rule(when: string, e: SpineEvent): Promise<boolean>;
  /**
   * A test (`./dry.ts`): every node that would run a step runs this one's instead, and code
   * wires carry events as events wires do, as the parts' code would. Nothing leaves the walk.
   */
  dry?: (n: WorkflowNode) => Step;
}

export interface Tally {
  arrived: number;
  /** Already there: it entered before. */
  seen: number;
  waiting: number;
  failed: number;
  /** Left the top workflow by its own outputs. */
  out: number;
}

/** "in": the event arrives at `ref` (node.port, or out.port); else it leaves `ref` (node.port, or in.port). */
interface Move {
  arrive: boolean;
  /** Node ids down to the workflow the ref is in; [] is the top one. */
  at: string[];
  ref: string;
  e: SpineEvent;
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

/** A wire's wait in ms. "until <kind>" isn't built: nothing uses it yet. */
export function waitMs(wait: string): number {
  const m = /^(\d+) (minute|hour|day|week)s?$/.exec(wait);
  if (!m) throw new restate.TerminalError(`wait "${wait}" isn't built yet`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

/** The workflow a node opens into: a workflow it uses, or the one inside a part it uses. */
function innerOf(w: Walk, n: WorkflowNode): Workflow | undefined {
  if (!n.uses) return undefined;
  const inside = w.parts.get(n.uses)?.inside;
  return w.flows.get(inside ?? n.uses);
}

function flowAt(w: Walk, top: Workflow, at: string[]): Workflow {
  let f = top;
  for (const id of at) {
    const n = f.nodes.find((x) => x.id === id);
    const inner = n && innerOf(w, n);
    if (!inner) throw new restate.TerminalError(`${top.id}: no workflow at ${at.join(".")}`);
    f = inner;
  }
  return f;
}

/** A custom step at an https URL: POST `{port, event}`, answer `{out: [{port, event}]}`. */
const httpStep =
  (url: string): Step =>
  async (port, event) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ port, event }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = (await res.json()) as { out?: unknown };
    return Array.isArray(body.out) ? (body.out as Awaited<ReturnType<Step>>) : [];
  };

/** A part's step, a logic node's, or a custom step's. */
function stepOf(w: Walk, n: WorkflowNode): Step | undefined {
  const name = n.own?.run ?? n.uses;
  if (!name) return undefined;
  return name.startsWith("https://") ? httpStep(name) : w.steps[name];
}

async function walkMoves(w: Walk, workflow: string, queue: Move[]): Promise<Tally> {
  const top = w.flows.get(workflow);
  if (!top) throw new restate.TerminalError(`no workflow ${workflow}`);
  const tally: Tally = { arrived: 0, seen: 0, waiting: 0, failed: 0, out: 0 };
  const arrival = (m: Move): Arrival => {
    const [id, port] = m.ref.split(".") as [string, string];
    return {
      workflow,
      node: [...m.at, id].join("."),
      port,
      event: m.e,
      ...(w.version !== undefined ? { version: w.version } : {}),
    };
  };
  // A Merge passes a subject once, by whichever side it came: both sides claim one entry.
  const entry = (flow: Workflow, m: Move): Arrival => {
    const a = arrival(m);
    const id = m.ref.split(".")[0];
    return flow.nodes.find((n) => n.id === id)?.uses === "logic.merge" ? { ...a, port: "in" } : a;
  };

  for (let m = queue.shift(); m; m = queue.shift()) {
    const flow = flowAt(w, top, m.at);
    const [id, port] = m.ref.split(".") as [string, string];

    if (!m.arrive) {
      // What leaves a Wait node is held on every wire out of it, unless the wire says its own.
      const hold = holdOf(flow.nodes.find((n) => n.id === id));
      for (const wire of flow.wires) {
        // A part's code moves events on its code wires; a dry test plays those as wires too.
        if (wire.from !== m.ref || (wire.via !== "events" && !w.dry)) continue;
        const e = m.e;
        if (wire.when) {
          const when = wire.when;
          const pass = await w.run(`rule ${wire.from} ${e.subject}`, () => w.rule(when, e));
          if (!pass) continue;
        }
        const to: Move = { arrive: true, at: m.at, ref: wire.to, e };
        const wait = wire.wait ?? hold;
        if (!wait) {
          queue.push(to);
          continue;
        }
        const ms = waitMs(wait);
        const held = await w.run(`wait ${wire.to} ${e.subject}`, () =>
          w.store.claim(entry(flow, to), w.by, new Date(Date.now() + ms)),
        );
        if (held) {
          w.later(held, ms);
          tally.waiting++;
        } else tally.seen++;
      }
      continue;
    }

    if (id === "out") {
      const parent = m.at.at(-1);
      if (parent) {
        queue.push({ arrive: false, at: m.at.slice(0, -1), ref: `${parent}.${port}`, e: m.e });
        continue;
      }
      const a = arrival(m);
      const kept = await w.run(`out ${port} ${m.e.subject}`, () => w.store.claim(a, w.by));
      if (kept) tally.out++;
      else tally.seen++;
      continue;
    }

    const node = flow.nodes.find((n) => n.id === id);
    if (!node) throw new restate.TerminalError(`${flow.id}: no node ${id}`);
    const real = stepOf(w, node);
    const inner = real ? undefined : innerOf(w, node);
    if (inner) {
      queue.push({ arrive: false, at: [...m.at, id], ref: `in.${port}`, e: m.e });
      continue;
    }
    const step = w.dry ? w.dry(node) : real;
    const a = entry(flow, m);
    let outs: Awaited<ReturnType<Step>> | null;
    try {
      outs = await w.run(
        `${a.node}.${port} ${m.e.subject}`,
        async () => {
          const kept = await w.store.claim(a, w.by);
          if (!kept) return null;
          const at = { client: w.client, workflow, node: a.node, with: node.with ?? {} };
          const out = step ? await step(a.port, a.event, at) : [];
          await w.store.sent?.(kept, out);
          return out;
        },
        true,
      );
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      await w.run(`failed ${a.node}.${port} ${m.e.subject}`, () =>
        w.store.fail(a, err.message.slice(0, 2000)),
      );
      tally.failed++;
      continue;
    }
    if (!outs) {
      tally.seen++;
      continue;
    }
    tally.arrived++;
    for (const o of outs)
      queue.push({ arrive: false, at: m.at, ref: `${id}.${o.port}`, e: o.event });
  }
  return tally;
}

/** `w` on the wiring a subject entered on; the live one when it's new or from before versions. */
async function pinned(w: Walk, workflow: string, entered: number | null | undefined) {
  if (!w.liveOf) return w;
  const live = w.liveOf(workflow);
  const version = entered ?? live;
  if (version === live || !w.flowsAt) return { ...w, version: live };
  return { ...w, flows: await w.flowsAt(workflow, version), version };
}

const add = (a: Tally, b: Tally): Tally => ({
  arrived: a.arrived + b.arrived,
  seen: a.seen + b.seen,
  waiting: a.waiting + b.waiting,
  failed: a.failed + b.failed,
  out: a.out + b.out,
});

/**
 * Events leaving `from` ("node.port", or "in.port" for the workflow's own input). A subject
 * already in the workflow walks the wiring it entered on; a new one takes the live wiring.
 */
export async function walk(w: Walk, workflow: string, from: string, batch: SpineEvent[]) {
  const moves = (es: SpineEvent[]): Move[] =>
    es.map((e) => ({ arrive: false, at: [], ref: from, e }));
  const entered = w.store.entered;
  if (!entered || !w.liveOf) return walkMoves(w, workflow, moves(batch));
  const by = new Map<number | null, SpineEvent[]>();
  for (const e of batch) {
    const v = await w.run(`entered ${e.subject}`, () =>
      entered.call(w.store, workflow, e.subject).then((x) => x ?? null),
    );
    by.set(v, [...(by.get(v) ?? []), e]);
  }
  let tally: Tally = { arrived: 0, seen: 0, waiting: 0, failed: 0, out: 0 };
  for (const [v, es] of by)
    tally = add(tally, await walkMoves(await pinned(w, workflow, v), workflow, moves(es)));
  return tally;
}

/** A waiting arrival whose time came: it arrives now. */
export const resume = (w: Walk, id: string) =>
  arriveAgain(w, "release", () => w.store.release(id, w.by));

/** A failed arrival, run again at its node: an operator's retry once the cause is fixed. */
export const retry = (w: Walk, id: string) =>
  arriveAgain(w, "retry", () => w.store.retry(id, w.by));

async function arriveAgain(
  w: Walk,
  label: string,
  take: () => Promise<Arrival | null>,
): Promise<Tally | null> {
  const a = await w.run(label, take);
  if (!a) return null;
  const path = a.node.split(".");
  const last = path.pop() as string;
  return walkMoves(await pinned(w, a.workflow, a.version), a.workflow, [
    { arrive: true, at: path, ref: `${last}.${a.port}`, e: a.event },
  ]);
}

/** The most of one step's outputs an execution keeps; past it, the data is dropped. */
const SENT_MAX = 32_000;

/** A step's outputs as `events.sent` keeps them: each one's data dropped when they don't fit. */
export function sentOf(outs: ReadonlyArray<{ port: string; event: SpineEvent }>): SentEvent[] {
  const all = outs.map((o) => ({
    port: o.port,
    subject: o.event.subject,
    kind: o.event.kind,
    data: o.event.data,
  }));
  if (JSON.stringify(all).length <= SENT_MAX) return all;
  return all.map((o) => ({ ...o, data: { cut: "too big to keep" } }));
}

export function pgSpineStore(db: Db): SpineStore {
  type Row = {
    workflow: string;
    node: string;
    port: string;
    subject: string;
    kind: EventKind;
    data: Record<string, unknown>;
    version: number | null;
  };
  const arrivalOf = (r: Row | undefined): Arrival | null =>
    r
      ? {
          workflow: r.workflow,
          node: r.node,
          port: r.port,
          event: { subject: r.subject, kind: r.kind, data: r.data },
          version: r.version,
        }
      : null;
  return {
    async claim(a, by, due) {
      const e = pgSafe(a.event);
      const rows = (await db.execute(sql`
        INSERT INTO events (workflow, node, port, subject, kind, data, due, by, version)
        VALUES (${a.workflow}, ${a.node}, ${a.port}, ${e.subject}, ${e.kind},
          ${JSON.stringify(e.data)}::jsonb, ${due?.toISOString() ?? null}::timestamptz, ${by},
          ${a.version ?? null}::int)
        ON CONFLICT ON CONSTRAINT uq_events_entry DO UPDATE SET by = excluded.by
          WHERE events.by = excluded.by
        RETURNING id::text`)) as unknown as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    },
    async entered(workflow, subject) {
      const rows = (await db.execute(sql`
        SELECT version FROM events WHERE subject = ${subject} AND workflow = ${workflow}
        ORDER BY at LIMIT 1`)) as unknown as Array<{ version: number | null }>;
      return rows.length ? (rows[0]?.version ?? null) : undefined;
    },
    async release(id, by) {
      const rows = (await db.execute(sql`
        UPDATE events SET due = NULL, by = ${by}
        WHERE id = ${id}::uuid AND (due IS NOT NULL OR by = ${by})
        RETURNING workflow, node, port, subject, kind, data, version`)) as unknown as Row[];
      return arrivalOf(rows[0]);
    },
    async fail(a, error) {
      await db.execute(sql`
        UPDATE events SET error = ${pgSafe(error)}
        WHERE workflow = ${a.workflow} AND node = ${a.node} AND port = ${a.port}
          AND subject = ${a.event.subject}`);
    },
    async sent(id, outs) {
      await db.execute(sql`
        UPDATE events SET sent = ${JSON.stringify(pgSafe(sentOf(outs)))}::jsonb, sent_at = now()
        WHERE id = ${id}::uuid`);
    },
    async retry(id, by) {
      const rows = (await db.execute(sql`
        UPDATE events SET error = NULL, by = ${by}
        WHERE id = ${id}::uuid AND (error IS NOT NULL OR by = ${by})
        RETURNING workflow, node, port, subject, kind, data, version`)) as unknown as Row[];
      return arrivalOf(rows[0]);
    },
  };
}

// ---- The door: webhooks into a workflow's input ----

export interface HookAsk {
  name: string;
  client: string | null;
  workflow: string;
  input: string;
  subject: string;
  fields?: FieldMap;
  /** False: made shut, as a template's door until its workflow is approved. */
  open?: boolean;
}

/**
 * A new hook, its id and its token: kept as a hash for the door, and sealed when there's a key
 * (`./doors.ts`), else returned once.
 */
export async function makeHook(db: Queryable, h: HookAsk): Promise<{ id: string; token: string }> {
  const { token, tokenHash, sealed } = newToken();
  const [row] = await db
    .insert(hooks)
    .values({ ...h, tokenHash, sealed })
    .returning({ id: hooks.id });
  if (!row) throw new Error("the hook wasn't made");
  return { id: row.id, token };
}

/** A new hook; its token is returned once and kept only as a hash. */
export async function addHook(main: Db, h: HookAsk): Promise<string> {
  return (await makeHook(main, h)).token;
}

const PAYLOAD_MAX = 64_000;
/** What a post to a shut door hears. */
export const SHUT = "this door opens once its workflow is approved";

/**
 * A hook's payload as the event it enters with, and where it leaves from: the workflow's input
 * `input`, or the door trigger node of that id (Webhook or Form, out by `out`). Else the status
 * the sender gets.
 */
export function hookEvent(
  h: Pick<typeof hooks.$inferSelect, "workflow" | "input" | "subject">,
  flows: ReadonlyMap<string, Workflow>,
  payload: unknown,
): { from: string; event: SpineEvent } | { status: number; error: string } {
  const f = flows.get(h.workflow);
  const node = f?.nodes.find((n) => n.id === h.input && doorOf(n) !== null);
  const port = node
    ? logicOf(node.uses)?.ports(node.with ?? {}).out[0]
    : f?.in.find((p) => p.id === h.input);
  if (!port) return { status: 410, error: `${h.workflow} has no input ${h.input} now` };
  if (JSON.stringify(payload ?? null).length > PAYLOAD_MAX)
    return { status: 413, error: `keep it under ${PAYLOAD_MAX} bytes` };
  const who = dig(payload, h.subject);
  if ((typeof who !== "string" && typeof who !== "number") || String(who).trim() === "")
    return { status: 422, error: `the payload has no ${h.subject}` };
  const data =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { payload };
  const subject = `${port.kind}:${String(who).trim().slice(0, 180)}`;
  return {
    from: node ? `${node.id}.${port.id}` : `in.${port.id}`,
    event: { subject, kind: port.kind, data },
  };
}

/** A workflow's newest save for a client. */
export interface SavedWorkflow {
  /** Its `workflow_saves` id: the version a subject enters on. */
  id: number;
  edits: WorkflowEdits | null;
  by: string;
  at: string;
}

/** The newest save of each workflow for `client` (null: Wren's), by workflow id. */
export async function savedWorkflows(
  db: Db,
  client: string | null,
): Promise<Record<string, SavedWorkflow>> {
  const rows = await db
    .selectDistinctOn([workflowSaves.workflow])
    .from(workflowSaves)
    .where(
      and(
        client === null ? isNull(workflowSaves.client) : eq(workflowSaves.client, client),
        eq(workflowSaves.live, true),
      ),
    )
    .orderBy(workflowSaves.workflow, desc(workflowSaves.id));
  return Object.fromEntries(
    rows.map((r) => [r.workflow, { id: r.id, edits: r.edits, by: r.by, at: r.at.toISOString() }]),
  );
}

/** A live save of a workflow, as History lists it. */
export interface WorkflowVersion {
  id: number;
  edits: WorkflowEdits | null;
  by: string;
  at: string;
}

/**
 * A workflow's draft (a save newer than its newest live one, not live) and its live versions,
 * newest first: what the canvas's editor opens and its History lists.
 */
export async function workflowHistory(
  db: Queryable,
  client: string | null,
  workflow: string,
): Promise<{ draft: WorkflowVersion | null; versions: WorkflowVersion[] }> {
  const rows = await db
    .select({
      id: workflowSaves.id,
      edits: workflowSaves.edits,
      live: workflowSaves.live,
      by: workflowSaves.by,
      at: workflowSaves.at,
    })
    .from(workflowSaves)
    .where(
      and(
        client === null ? isNull(workflowSaves.client) : eq(workflowSaves.client, client),
        eq(workflowSaves.workflow, workflow),
      ),
    )
    .orderBy(desc(workflowSaves.id))
    .limit(30);
  const one = (r: (typeof rows)[number]): WorkflowVersion => ({
    id: r.id,
    edits: r.edits,
    by: r.by,
    at: r.at.toISOString(),
  });
  const first = rows[0];
  return {
    draft: first && !first.live ? one(first) : null,
    versions: rows
      .filter((r) => r.live)
      .slice(0, 15)
      .map(one),
  };
}

/** One save's wiring, live or not: what a subject that entered on it still walks. */
export async function savedVersion(
  db: Db,
  id: number,
): Promise<{ workflow: string; edits: WorkflowEdits | null } | null> {
  const [r] = await db
    .select({ workflow: workflowSaves.workflow, edits: workflowSaves.edits })
    .from(workflowSaves)
    .where(eq(workflowSaves.id, id));
  return r ?? null;
}

export const editsOf = (saved: Readonly<Record<string, SavedWorkflow>>) =>
  Object.fromEntries(Object.entries(saved).map(([id, s]) => [id, s.edits]));

export const SPINE = { name: "Spine" } as const;

interface Target {
  /** Whose database; null is Wren's. */
  client: string | null;
}
export type SpineService = {
  emit: (
    ctx: restate.Context,
    req: Target & { workflow: string; from: string; events: SpineEvent[] },
  ) => Promise<Tally>;
  release: (ctx: restate.Context, req: Target & { id: string }) => Promise<Tally | null>;
  retry: (ctx: restate.Context, req: Target & { id: string }) => Promise<Tally | null>;
  fire: (ctx: restate.Context, req: Fired) => Promise<{ entered: number }>;
};

/** Something happened that a Reply or Booking trigger may hear: the event it enters with. */
export type Fired = Target & { facts: TriggerFacts; event: SpineEvent };

/**
 * A reply or a booking, told to every live workflow of `client` with a trigger node that hears it
 * (`triggerHears`). Send-only, so the channel's own step never waits on a walk.
 */
export const spineFire = (ctx: restate.Context, req: Fired) => {
  ctx.serviceSendClient<SpineService>(SPINE).fire(req);
};
/** A channel's way to tell the spine: `spineFire` on the worker; unset where no Spine runs. */
export type FireTriggers = (ctx: restate.Context, req: Fired) => void;

/**
 * A lead's reply as a Reply trigger hears it: about the thread, as the channel's own touch step
 * says it (`reply:sms:<contact>`), so one lead enters a node once.
 */
export function replyFired(
  client: string | null,
  channel: "email" | "sms" | "dm",
  id: number,
): Fired {
  const thread = channel === "email" ? { enrollmentId: id } : { contactId: id };
  return {
    client,
    facts: { trigger: "trigger.reply", channel },
    event: {
      subject: `reply:${channel === "dm" ? "reach" : channel}:${id}`,
      kind: "reply",
      data: { channel, ...thread },
    },
  };
}

/**
 * A client's template workflows that aren't live: uninstalled, a draft, or waiting on a yes. Their
 * Reply and Booking nodes hear nothing. A workflow no template put there keeps hearing.
 */
export async function notLive(db: Queryable, client: string): Promise<string[]> {
  const rows = await db
    .select({ workflow: workflowInstalls.workflow })
    .from(workflowInstalls)
    .where(eq(workflowInstalls.client, client))
    .groupBy(workflowInstalls.workflow)
    .having(sql`NOT bool_or(${workflowInstalls.state} = 'live')`);
  return rows.map((r) => r.workflow);
}

/** Every Reply and Booking node in `flows` that hears `facts`, as where its event leaves. */
export function hearersOf(
  flows: Iterable<Workflow>,
  facts: TriggerFacts,
): Array<{ workflow: string; from: string }> {
  const out: Array<{ workflow: string; from: string }> = [];
  for (const f of flows)
    for (const n of f.nodes)
      if (triggerHears(n, facts)) out.push({ workflow: f.id, from: `${n.id}.out` });
  return out;
}

export const SPINE_CLOCK = { name: "SpineClock" } as const;
/** One Schedule node's clock: `<client>|<workflow>|<node>`, the client blank for Wren. */
export const clockKey = (client: string | null, workflow: string, node: string) =>
  `${client ?? ""}|${workflow}|${node}`;
export function clockOfKey(
  key: string,
): { client: string | null; workflow: string; node: string } | null {
  const [client = "", workflow, node, ...rest] = key.split("|");
  return workflow && node && !rest.length ? { client: client || null, workflow, node } : null;
}
/** The clocks a flow's Schedule nodes run on: started on publish and approve, like loops. */
export const clocksOf = (client: string | null, flow: Workflow): LoopKey[] =>
  flow.nodes
    .filter((n) => n.uses === "trigger.schedule")
    .map((n) => ({ service: SPINE_CLOCK.name, key: clockKey(client, flow.id, n.id) }));

/** A Schedule node's event for one slot: the same slot enters once, however often it's sent. */
export const slotEvent = (node: string, slot: Date): SpineEvent => ({
  subject: `item:schedule:${node}@${slot.toISOString()}`,
  kind: "item",
  data: { at: slot.toISOString() },
});

/** Events leaving `from` in a workflow, sent by a part's own code: a sender that sent a step. */
export const spineEmit = (
  ctx: restate.Context,
  req: Target & { workflow: string; from: string; events: SpineEvent[] },
) => ctx.serviceSendClient<SpineService>(SPINE).emit(req);

export interface SpineDeps {
  main: Db;
  clientDb(id: string): Db;
  workflows: readonly Workflow[];
  components: readonly Component[];
  steps: Readonly<Record<string, Step>>;
  rule(when: string, e: SpineEvent): Promise<boolean>;
}

const STEP_RETRY = { maxRetryAttempts: 3 };

export function makeSpine(d: SpineDeps) {
  const parts = new Map(d.components.map((c) => [c.id, c]));
  const steps = { ...logicSteps(d.rule), ...d.steps };
  // The client's saved wiring, read once per call and journaled, so a replay walks the same wires.
  const savesFor = (ctx: restate.Context, client: string | null) =>
    ctx.run("saved workflows", () => savedWorkflows(d.main, client));
  const flowsOf = (edits: Record<string, WorkflowEdits | null>) =>
    new Map(flowsWith(d.workflows, edits, d.components).flows.map((f) => [f.id, f]));
  const flowsFor = async (ctx: restate.Context, client: string | null) =>
    flowsOf(editsOf(await savesFor(ctx, client)));
  const walkFor = async (ctx: restate.Context, t: Target): Promise<Walk> => {
    const saves = await savesFor(ctx, t.client);
    return {
      flows: flowsOf(editsOf(saves)),
      // A workflow's newest live save: the wiring a new subject enters on.
      liveOf: (workflow) => saves[workflow]?.id ?? 0,
      // A save that no longer checks runs as the code's, the same as `flowsWith` drops it.
      flowsAt: async (workflow, version) => {
        const old =
          version === 0
            ? { workflow, edits: null }
            : await ctx.run(`wiring ${version}`, () => savedVersion(d.main, version));
        return flowsOf({
          ...editsOf(saves),
          [workflow]: old?.workflow === workflow ? old.edits : null,
        });
      },
      parts,
      steps,
      store: pgSpineStore(t.client ? d.clientDb(t.client) : d.main),
      client: t.client,
      by: ctx.request().id,
      run: (name, fn, capped) => ctx.run(name, fn, capped ? STEP_RETRY : {}),
      later: (id, ms) =>
        ctx
          .serviceSendClient<SpineService>(SPINE)
          .release({ client: t.client, id }, restate.rpc.sendOpts({ delay: ms })),
      rule: d.rule,
    };
  };

  return restate.service({
    name: SPINE.name,
    handlers: {
      /** Events leaving a node's output or a workflow's input. Parts and the door send it. */
      emit: restate.handlers.handler(
        { ingressPrivate: true },
        (
          ctx: restate.Context,
          req: Target & { workflow: string; from: string; events: SpineEvent[] },
        ) => walkFor(ctx, req).then((w) => walk(w, req.workflow, req.from, req.events)),
      ),
      /** A wire's wait is over. Only the spine sends it, delayed. */
      release: restate.handlers.handler(
        { ingressPrivate: true },
        (ctx: restate.Context, req: Target & { id: string }) =>
          walkFor(ctx, req).then((w) => resume(w, req.id)),
      ),
      /** A failed step, again: the console's Retry sends it once its cause is fixed. */
      retry: restate.handlers.handler(
        { ingressPrivate: true },
        (ctx: restate.Context, req: Target & { id: string }) =>
          walkFor(ctx, req).then((w) => retry(w, req.id)),
      ),
      /** A reply or booking: each live trigger node that hears it gets it at its output. */
      fire: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: Fired) => {
          const flows = await flowsFor(ctx, req.client);
          const client = req.client;
          const quiet = new Set(
            client === null ? [] : await ctx.run("not live", () => notLive(d.main, client)),
          );
          const at = hearersOf(
            [...flows.values()].filter((f) => !quiet.has(f.id)),
            req.facts,
          );
          for (const h of at)
            ctx
              .serviceSendClient<SpineService>(SPINE)
              .emit({ client: req.client, ...h, events: [req.event] });
          return { entered: at.length };
        },
      ),
      /**
       * The door: the phone Worker's `POST /hooks/<token>`. Answers a status for the sender; the
       * walk runs after, on its own call.
       */
      hook: async (ctx: restate.Context, req: { token: string; payload: unknown }) => {
        if (typeof req.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(req.token))
          return { status: 404, error: "no such hook" };
        const tokenHash = hashToken(req.token);
        const h = await ctx.run("hook", async () => {
          const [row] = await d.main
            .update(hooks)
            .set({ calls: sql`${hooks.calls} + 1`, lastAt: sql`now()` })
            .where(eq(hooks.tokenHash, tokenHash))
            .returning({
              client: hooks.client,
              workflow: hooks.workflow,
              input: hooks.input,
              subject: hooks.subject,
              fields: hooks.fields,
              open: hooks.open,
            });
          return row ?? null;
        });
        if (!h) return { status: 404, error: "no such hook" };
        // A template's door before its workflow is approved: counted, nothing enters.
        if (!h.open) return { status: 409, error: SHUT };
        const got = hookEvent(h, await flowsFor(ctx, h.client), req.payload);
        if ("error" in got) return got;
        // The lead's facts by this hook's field map, for every lead step after (./door.ts).
        got.event.data = { ...got.event.data, lead: leadOf(req.payload, h.fields) };
        ctx.serviceSendClient<SpineService>(SPINE).emit({
          client: h.client,
          workflow: h.workflow,
          from: got.from,
          events: [got.event],
        });
        return { status: 202, subject: got.event.subject };
      },
    },
  });
}

const NEXT = "next";

/**
 * Each Schedule node's clock (designs/2026-10-06-workflow-editor.md, step 5): one virtual object
 * per client, workflow and node. It keeps the next slot and sends itself `tick` at it, delayed.
 * `start` (publish, approve) sets the slot from the live settings; a tick whose slot isn't the
 * kept one is stale and does nothing, so a changed time never fires twice. A tick that finds no
 * Schedule node live there stops.
 */
export function makeSpineClock(d: Pick<SpineDeps, "main" | "workflows" | "components">) {
  type Self = {
    tick: (ctx: restate.ObjectContext, req: { slot: string }) => Promise<void>;
  };
  const nodeOf = async (ctx: restate.ObjectContext) => {
    const k = clockOfKey(ctx.key);
    if (!k) return null;
    const saves = await ctx.run("saved workflows", () => savedWorkflows(d.main, k.client));
    const flow = flowsWith(d.workflows, editsOf(saves), d.components).flows.find(
      (f) => f.id === k.workflow,
    );
    const n = flow?.nodes.find((x) => x.id === k.node && x.uses === "trigger.schedule");
    return n ? { ...k, with: n.with ?? {} } : null;
  };
  /** The next slot after `after`, kept and sent; none clears the clock. */
  const arm = async (ctx: restate.ObjectContext, after: Date) => {
    const n = await nodeOf(ctx);
    const slot = n ? nextSlot(n.with, after) : null;
    if (!slot) {
      ctx.clear(NEXT);
      return null;
    }
    const iso = slot.toISOString();
    if ((await ctx.get<string>(NEXT)) === iso) return iso;
    ctx.set(NEXT, iso);
    ctx
      .objectSendClient<Self>(SPINE_CLOCK, ctx.key)
      .tick(
        { slot: iso },
        restate.rpc.sendOpts({ delay: Math.max(0, slot.getTime() - after.getTime()) }),
      );
    return iso;
  };
  return restate.object({
    name: SPINE_CLOCK.name,
    handlers: {
      /** From the live settings: the next slot. Again with the same settings changes nothing. */
      start: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext) => ({
          next: await arm(ctx, new Date(await ctx.date.now())),
        }),
      ),
      /** No more ticks: the pending one is stale. */
      stop: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext) => {
          ctx.clear(NEXT);
        },
      ),
      /** A slot is due: its event enters at the node's output, then the next one is set. */
      tick: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext, req: { slot: string }) => {
          if ((await ctx.get<string>(NEXT)) !== req.slot) return;
          const n = await nodeOf(ctx);
          if (!n) {
            ctx.clear(NEXT);
            return;
          }
          spineEmit(ctx, {
            client: n.client,
            workflow: n.workflow,
            from: `${n.node}.out`,
            events: [slotEvent(n.node, new Date(req.slot))],
          });
          const now = new Date(await ctx.date.now());
          const after = new Date(Math.max(now.getTime(), Date.parse(req.slot)));
          ctx.clear(NEXT);
          await arm(ctx, after);
        },
      ),
    },
  });
}

export type SpineClock = ReturnType<typeof makeSpineClock>;

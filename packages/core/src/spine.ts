/**
 * The spine (designs/2026-10-05-workflows.md): events move along a workflow's routed wires. An
 * event leaves a node's output, or the workflow's own input. Each routed wire from there passes
 * it on, after its rule and its wait, and it arrives at the next node's input. That node's step
 * runs, and what it returns leaves on its outputs in turn. A node whose part has no step yet
 * (planned, or moved by its own code) keeps the arrival and stops there. One walk is one Restate
 * call; every arrival is a row in `events`, so nothing enters a node twice.
 */
import { createHash, randomBytes } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { desc, eq, isNull, sql } from "drizzle-orm";
import type { Component, EventKind } from "./components.js";
import { hooks, workflowSaves } from "./schema.js";
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

/** An event at a node's input: `node` is the dotted path from `workflow` down. */
export interface Arrival {
  workflow: string;
  node: string;
  port: string;
  event: SpineEvent;
}

export interface SpineStore {
  /**
   * Keep an arrival, owned by `by`. Its id when new, or when `by` already owns it (a retry);
   * null when another call kept it first. With `due`, it waits on its wire until then.
   */
  claim(a: Arrival, by: string, due?: Date): Promise<string | null>;
  /** Take a waiting arrival for `by`; null when another call took it. */
  release(id: string, by: string): Promise<Arrival | null>;
  /** Its step failed past its retries: the event stops here, with why. */
  fail(a: Arrival, error: string): Promise<void>;
}

export interface Walk {
  flows: ReadonlyMap<string, Workflow>;
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
    return { workflow, node: [...m.at, id].join("."), port, event: m.e };
  };

  for (let m = queue.shift(); m; m = queue.shift()) {
    const flow = flowAt(w, top, m.at);
    const [id, port] = m.ref.split(".") as [string, string];

    if (!m.arrive) {
      for (const wire of flow.wires) {
        if (wire.from !== m.ref || wire.via !== "events") continue;
        const e = m.e;
        if (wire.when) {
          const when = wire.when;
          const pass = await w.run(`rule ${wire.from} ${e.subject}`, () => w.rule(when, e));
          if (!pass) continue;
        }
        const to: Move = { arrive: true, at: m.at, ref: wire.to, e };
        if (!wire.wait) {
          queue.push(to);
          continue;
        }
        const ms = waitMs(wire.wait);
        const held = await w.run(`wait ${wire.to} ${e.subject}`, () =>
          w.store.claim(arrival(to), w.by, new Date(Date.now() + ms)),
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
    const step = stepOf(w, node);
    const inner = step ? undefined : innerOf(w, node);
    if (inner) {
      queue.push({ arrive: false, at: [...m.at, id], ref: `in.${port}`, e: m.e });
      continue;
    }
    const a = arrival(m);
    let outs: Awaited<ReturnType<Step>> | null;
    try {
      outs = await w.run(
        `${a.node}.${port} ${m.e.subject}`,
        async () => {
          if (!(await w.store.claim(a, w.by))) return null;
          const at = { client: w.client, workflow, node: a.node, with: node.with ?? {} };
          return step ? step(port, a.event, at) : [];
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

/** Events leaving `from` ("node.port", or "in.port" for the workflow's own input). */
export const walk = (w: Walk, workflow: string, from: string, batch: SpineEvent[]) =>
  walkMoves(
    w,
    workflow,
    batch.map((e) => ({ arrive: false, at: [], ref: from, e })),
  );

/** A waiting arrival whose time came: it arrives now. */
export async function resume(w: Walk, id: string): Promise<Tally | null> {
  const a = await w.run("release", () => w.store.release(id, w.by));
  if (!a) return null;
  const path = a.node.split(".");
  const last = path.pop() as string;
  return walkMoves(w, a.workflow, [
    { arrive: true, at: path, ref: `${last}.${a.port}`, e: a.event },
  ]);
}

export function pgSpineStore(db: Db): SpineStore {
  type Row = {
    workflow: string;
    node: string;
    port: string;
    subject: string;
    kind: EventKind;
    data: Record<string, unknown>;
  };
  return {
    async claim(a, by, due) {
      const e = pgSafe(a.event);
      const rows = (await db.execute(sql`
        INSERT INTO events (workflow, node, port, subject, kind, data, due, by)
        VALUES (${a.workflow}, ${a.node}, ${a.port}, ${e.subject}, ${e.kind},
          ${JSON.stringify(e.data)}::jsonb, ${due?.toISOString() ?? null}::timestamptz, ${by})
        ON CONFLICT ON CONSTRAINT uq_events_entry DO UPDATE SET by = excluded.by
          WHERE events.by = excluded.by
        RETURNING id::text`)) as unknown as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    },
    async release(id, by) {
      const rows = (await db.execute(sql`
        UPDATE events SET due = NULL, by = ${by}
        WHERE id = ${id}::uuid AND (due IS NOT NULL OR by = ${by})
        RETURNING workflow, node, port, subject, kind, data`)) as unknown as Row[];
      const r = rows[0];
      return r
        ? {
            workflow: r.workflow,
            node: r.node,
            port: r.port,
            event: { subject: r.subject, kind: r.kind, data: r.data },
          }
        : null;
    },
    async fail(a, error) {
      await db.execute(sql`
        UPDATE events SET error = ${pgSafe(error)}
        WHERE workflow = ${a.workflow} AND node = ${a.node} AND port = ${a.port}
          AND subject = ${a.event.subject}`);
    },
  };
}

// ---- The door: webhooks into a workflow's input ----

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new hook; its token is returned once and kept only as a hash. */
export async function addHook(
  main: Db,
  h: { name: string; client: string | null; workflow: string; input: string; subject: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await main.insert(hooks).values({ ...h, tokenHash: hashOf(token) });
  return token;
}

/** A payload's value at a dotted path. */
function dig(v: unknown, path: string): unknown {
  for (const k of path.split("."))
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

const PAYLOAD_MAX = 64_000;

/** A hook's payload as the event it enters with, or the status the sender gets. */
export function hookEvent(
  h: Pick<typeof hooks.$inferSelect, "workflow" | "input" | "subject">,
  flows: ReadonlyMap<string, Workflow>,
  payload: unknown,
): { port: string; event: SpineEvent } | { status: number; error: string } {
  const port = flows.get(h.workflow)?.in.find((p) => p.id === h.input);
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
  return { port: port.id, event: { subject, kind: port.kind, data } };
}

/** A workflow's newest save for a client. */
export interface SavedWorkflow {
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
    .where(client === null ? isNull(workflowSaves.client) : eq(workflowSaves.client, client))
    .orderBy(workflowSaves.workflow, desc(workflowSaves.id));
  return Object.fromEntries(
    rows.map((r) => [r.workflow, { edits: r.edits, by: r.by, at: r.at.toISOString() }]),
  );
}

export const editsOf = (saved: Readonly<Record<string, SavedWorkflow>>) =>
  Object.fromEntries(Object.entries(saved).map(([id, s]) => [id, s.edits]));

export const SPINE = { name: "Spine" } as const;

interface Target {
  /** Whose database; null is Wren's. */
  client: string | null;
}
type SpineService = {
  emit: (
    ctx: restate.Context,
    req: Target & { workflow: string; from: string; events: SpineEvent[] },
  ) => Promise<Tally>;
  release: (ctx: restate.Context, req: Target & { id: string }) => Promise<Tally | null>;
};

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
  const flows = new Map(d.workflows.map((f) => [f.id, f]));
  const parts = new Map(d.components.map((c) => [c.id, c]));
  const walkFor = async (ctx: restate.Context, t: Target): Promise<Walk> => ({
    // The client's saved wiring, read once per call and journaled, so a replay walks the same wires.
    flows: new Map(
      flowsWith(
        d.workflows,
        editsOf(await ctx.run("saved workflows", () => savedWorkflows(d.main, t.client))),
        d.components,
      ).flows.map((f) => [f.id, f]),
    ),
    parts,
    steps: d.steps,
    store: pgSpineStore(t.client ? d.clientDb(t.client) : d.main),
    client: t.client,
    by: ctx.request().id,
    run: (name, fn, capped) => ctx.run(name, fn, capped ? STEP_RETRY : {}),
    later: (id, ms) =>
      ctx
        .serviceSendClient<SpineService>(SPINE)
        .release({ client: t.client, id }, restate.rpc.sendOpts({ delay: ms })),
    rule: d.rule,
  });

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
      /**
       * The door: the phone Worker's `POST /hooks/<token>`. Answers a status for the sender; the
       * walk runs after, on its own call.
       */
      hook: async (ctx: restate.Context, req: { token: string; payload: unknown }) => {
        if (typeof req.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(req.token))
          return { status: 404, error: "no such hook" };
        const tokenHash = hashOf(req.token);
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
            });
          return row ?? null;
        });
        if (!h) return { status: 404, error: "no such hook" };
        const got = hookEvent(h, flows, req.payload);
        if ("error" in got) return got;
        ctx.serviceSendClient<SpineService>(SPINE).emit({
          client: h.client,
          workflow: h.workflow,
          from: `in.${got.port}`,
          events: [got.event],
        });
        return { status: 202, subject: got.event.subject };
      },
    },
  });
}

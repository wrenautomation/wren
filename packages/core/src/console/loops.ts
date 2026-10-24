/**
 * Loops as records: one row per loop object from Restate's state (`console.loop`), failing
 * first; `setLoop`'s request; and Wren's spine arrivals (`console.event`).
 */
import { sql } from "drizzle-orm";
import type { Stage } from "../components.js";
import { UNTIL_LABELS } from "../logic.js";
import type { PortalRequest } from "../portal.js";
import {
  choice,
  date,
  defineRecord,
  named,
  number,
  type RecordType,
  status,
  text,
} from "../records.js";
import type { TimedOut } from "../restate/limits.js";
import type { PassOutcome } from "../restate/loop.js";
import type { SentEvent } from "../schema.js";
import type { RestateAdmin } from "./restate-admin.js";

/** One loop object: a key of a service whose state has `running`. */
export interface LoopRow {
  service: string;
  key: string;
  running: boolean;
  /** When the last pass ran; null before the first. */
  lastAt: string | null;
  /** Failed passes in a row; 0 when the last one went fine. */
  failures: number;
  error: string | null;
  /** When the next `loop` call is due; null when none is queued. */
  nextAt: string | null;
  /** The gap the last pass asked for before the next; null before the first. */
  delayMs: number | null;
  /** Calls the last pass stopped waiting on (`within`, `limitedRun`); `held` ones are in Checks. */
  timeouts: TimedOut[];
}

/**
 * One part that runs for Wren, as the Agents page draws it: its loops (their state is `loops`)
 * and each out port that counts itself (its number is `recordsStats` on that view).
 */
export interface AgentLine {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  stage: Stage;
  /** The stage as said: "Find leads". The page groups by it, in the stages' order. */
  department: string;
  /** False: built for Wren but not yet per client; still runs here. */
  ready: boolean;
  loops: string[];
  counts: { port: string; label: string; record: string; view: string }[];
}

export interface SetLoopRequest extends PortalRequest {
  service: string;
  key: string;
  /** true starts it (stored settings kept), false stops it after the pass in flight. */
  run: boolean;
}

/** `scheduled_at` rides along: without it Restate leaves `scheduled_start_at` out of the answer. */
export const LOOPS_SQL = `SELECT s.service_name, s.service_key, s.key, s.value_utf8, i.scheduled_at, i.scheduled_start_at
FROM state s
LEFT JOIN sys_invocation i ON i.target_service_name = s.service_name AND i.target_service_key = s.service_key
  AND i.target_handler_name = 'loop' AND i.status = 'scheduled'
WHERE s.key IN ('loop', 'running', 'last')`;

/** One row per loop object (a `loop` key, or the `running` key before it), failing first, then by name. */
export function loopsOf(rows: Record<string, unknown>[]): LoopRow[] {
  const objects = new Map<string, { state: Record<string, unknown>; next: string | null }>();
  for (const r of rows) {
    const id = `${r.service_name}/${r.service_key}`;
    const o = objects.get(id) ?? { state: {}, next: null };
    o.state[String(r.key)] = JSON.parse(String(r.value_utf8));
    const at = r.scheduled_start_at;
    if (typeof at === "string" && (o.next === null || at < o.next)) o.next = at;
    objects.set(id, o);
  }
  const loops: LoopRow[] = [];
  for (const [id, { state: keys, next }] of objects) {
    // The one loop key (2026-10-05) carries what `running` and `last` did; it wins.
    const state = (keys.loop ?? keys) as Record<string, unknown>;
    if (!("running" in state)) continue;
    const slash = id.indexOf("/");
    const last = (state.last ?? null) as Partial<PassOutcome<unknown>> | null;
    loops.push({
      service: id.slice(0, slash),
      key: id.slice(slash + 1),
      running: state.running === true,
      lastAt: last?.now ?? null,
      failures: last?.failures ?? 0,
      error: last?.error ?? null,
      nextAt: next,
      delayMs: typeof last?.delayMs === "number" ? last.delayMs : null,
      timeouts: Array.isArray(last?.timeouts) ? last.timeouts : [],
    });
  }
  const failing = (l: LoopRow) => (l.failures > 0 || l.error !== null ? 0 : 1);
  return loops.sort(
    (a, b) =>
      failing(a) - failing(b) || a.service.localeCompare(b.service) || a.key.localeCompare(b.key),
  );
}

/**
 * Every loop as a record. Its id is "<service>/<key>"; `console.startLoop` and
 * `console.stopLoop` call `setLoop` with its service and key.
 */
export const loopRecord = (admin: RestateAdmin): RecordType =>
  defineRecord({
    id: "console.loop",
    app: "loops",
    channel: null,
    name: { one: "loop", many: "loops" },
    rows: async () =>
      loopsOf(await admin(LOOPS_SQL)).map((l) => ({
        id: `${l.service}/${l.key}`,
        service: l.service,
        key: l.key,
        state: l.running ? "running" : "stopped",
        // A stopped loop keeps its old failure count; only a running one is failing.
        health: l.running && (l.failures > 0 || l.error !== null) ? "failing" : "ok",
        last_at: l.lastAt,
        failures: l.failures,
        error: l.error,
        next_at: l.nextAt,
      })),
    key: "id",
    title: "service",
    subtitle: "key",
    fields: {
      service: named("Loop"),
      key: named("For"),
      state: status({
        running: { label: "Running", tone: "good" },
        stopped: { label: "Stopped", tone: "neutral" },
      }),
      health: status({
        failing: { label: "Failing", tone: "bad" },
        ok: { label: "OK", tone: "good" },
      }),
      lastAt: date("Last pass"),
      failures: number("Failures in a row"),
      error: text("Last error"),
      nextAt: date("Next pass"),
    },
    views: [
      { id: "all", label: "All", sort: "health", at: "lastAt" },
      { id: "failing", label: "Failing", where: { health: "failing" }, sort: "-failures" },
      { id: "stopped", label: "Stopped", where: { state: "stopped" } },
    ],
    actions: ["console.startLoop", "console.stopLoop"],
  });

/**
 * Wren's spine arrivals (`spine_events`): a failed step says why, and Retry runs it again once
 * the cause is fixed. ponytail: main only; a client's events stay in its database until a
 * client's workflow fails for real.
 */
export const eventRecord = defineRecord({
  id: "console.event",
  app: "workflows",
  channel: null,
  name: { one: "event", many: "events" },
  view: "spine_events",
  key: "id",
  title: "subject",
  subtitle: "node",
  fields: {
    subject: text("About"),
    workflow: named("Workflow"),
    node: named("Node"),
    port: named("Port"),
    kind: named("Kind"),
    state: status({
      failed: { label: "Failed", tone: "bad" },
      waiting: { label: "Waiting", tone: "neutral" },
      passed: { label: "Passed on", tone: "good" },
    }),
    at: date("Arrived"),
    due: date("Due"),
    until: choice(() => UNTIL_LABELS, "Waiting for"),
    error: text("Why it failed", { words: "reason" }),
  },
  views: [
    { id: "failed", label: "Failed", where: { state: "failed" }, sort: "-at", at: "at" },
    { id: "waiting", label: "Waiting", where: { state: "waiting" }, sort: "due", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  // What came in and what its step sent on: the canvas's node panel shows the last of them.
  load: async (db, id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = (await db.execute(
      sql`select data, sent, sent_at "sentAt" from events where id = ${id}::uuid`,
    )) as unknown as Array<{ data: unknown; sent: SentEvent[] | null; sentAt: unknown }>;
    const r = rows[0];
    return r
      ? {
          data: r.data,
          sent: r.sent,
          sentAt: r.sentAt ? new Date(r.sentAt as string).toISOString() : null,
        }
      : null;
  },
  actions: ["console.retryEvent", "console.replay"],
});

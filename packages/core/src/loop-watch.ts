/**
 * The loop watchdog (designs/2026-10-16-loop-watchdog.md). Every self-rescheduling loop
 * (`makeLoopObject`) keeps its chain alive by sending itself the next `loop` call. Two things
 * end a chain without a word: the call is lost (killed, cancelled, a pass that threw past its
 * retries), or a pass waits on a call that never answers (paused after its retries), holding the
 * key's lock. `LoopWatch/all` reads Restate's admin SQL every 10 minutes, sorts each running loop
 * into alive, dead or stuck, wakes a dead one, and tells each incident once.
 *
 * The loops come from Restate's `state`, the same read as Console → Loops: a loop added later is
 * watched with no list to update. A loop's cadence is its own: the last pass's `delayMs`.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { inArray } from "drizzle-orm";
import { LOOPS_SQL, type LoopRow, loopsOf, type RestateAdmin } from "./console.js";
import { deadLetters } from "./dead-letter-schema.js";
import type { Notifier, NotifyLevel } from "./notify.js";
import type { TimedOut } from "./restate/limits.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";

export const LOOP_WATCH_KEY = "all";
const LOOP_WATCH_EVERY_MS = 10 * 60_000;
const MIN = 60_000;

/** What a healthy loop looks like: how long a pass may sit without moving, and the slack on its next pass. */
interface LoopExpect {
  /** No call on the key moved for this long: stuck. */
  stallMs: number;
  /** A loop between passes, no call queued, is dead only this long after its next pass was due. */
  graceMs: number;
}
const DEFAULT_EXPECT: LoopExpect = { stallMs: 45 * MIN, graceMs: 10 * MIN };
/** The exceptions, by service. Everything else is `DEFAULT_EXPECT`. */
const LOOP_EXPECT: Readonly<Record<string, Partial<LoopExpect>>> = {
  // A pass reads every watched person through the desk, one call after another: 70 min seen.
  ReachWatch: { stallMs: 90 * MIN },
};
export const expectOf = (service: string): LoopExpect => ({
  ...DEFAULT_EXPECT,
  ...LOOP_EXPECT[service],
});

/** A dead loop is woken at most this often inside one incident... */
export const RESTART_EVERY_MS = 15 * MIN;
/** ...and at most this many times; then the watchdog says it gave up. */
export const MAX_RESTARTS = 6;
/** An incident closes after the loop is healthy this long; a relapse before then is the same one. */
export const COOL_MS = 60 * MIN;

/** One call that is not done: on a loop's key, or one such a call waits on. */
export interface OpenCall {
  id: string;
  target: string;
  /** Restate's status: `pending` (queued behind the lock), `running`, `suspended`, `backing-off`, `paused`. */
  status: string;
  /** When Restate last changed it. */
  movedAt: string;
}

/** A loop as the watchdog reads it: its state, and the calls on its key that are not done. */
export interface LoopView extends LoopRow {
  /** Open calls on this key, the lock holder first; scheduled ones are `nextAt`. */
  open: OpenCall[];
  /** Open calls the holder made and is waiting on. */
  waitsOn: OpenCall[];
}

export type Health = "alive" | "stopped" | "dead" | "stuck";

export interface LoopHealth {
  /** `Service/key`. */
  id: string;
  service: string;
  key: string;
  health: Health;
  why: string;
  /** For a stuck loop, the call it waits on. */
  blocker: OpenCall | null;
  lastAt: string | null;
  nextAt: string | null;
  /** Calls its last pass stopped waiting on: each unit skipped, the loop went on. */
  timeouts: TimedOut[];
}

const minutes = (ms: number) => `${Math.max(Math.round(ms / MIN), 0)} min`;

/** One loop's health at `now`. Pure. */
export function healthOf(l: LoopView, now: Date, ex: LoopExpect = expectOf(l.service)): LoopHealth {
  const base = {
    id: `${l.service}/${l.key}`,
    service: l.service,
    key: l.key,
    blocker: null,
    lastAt: l.lastAt,
    nextAt: l.nextAt,
    timeouts: l.timeouts,
  };
  if (!l.running) return { ...base, health: "stopped", why: "stopped" };
  const t = now.getTime();
  const holder = l.open.find((c) => c.status !== "pending") ?? null;
  if (holder) {
    const chain = [holder, ...l.waitsOn];
    const paused = chain.find((c) => c.status === "paused");
    if (paused)
      return {
        ...base,
        health: "stuck",
        why:
          paused === holder
            ? `its pass ${paused.target} is paused: Restate gave up on it`
            : `waits on ${paused.target}, paused: Restate gave up on it`,
        blocker: paused,
      };
    const moved = Math.max(...chain.map((c) => Date.parse(c.movedAt)));
    if (t - moved > ex.stallMs) {
      const blocker = l.waitsOn[0] ?? holder;
      return {
        ...base,
        health: "stuck",
        why: `waits on ${blocker.target} (${blocker.status}); nothing moved for ${minutes(t - moved)}`,
        blocker,
      };
    }
    return { ...base, health: "alive", why: "a pass is running" };
  }
  if (l.nextAt) return { ...base, health: "alive", why: "next pass queued" };
  // Only calls queued behind a lock no one holds: Restate is about to run one.
  if (l.open.length) return { ...base, health: "alive", why: "a call is about to run" };
  const due = l.lastAt !== null && l.delayMs !== null ? Date.parse(l.lastAt) + l.delayMs : null;
  if (due !== null && t <= due + ex.graceMs)
    return { ...base, health: "alive", why: "between passes" };
  return {
    ...base,
    health: "dead",
    why:
      due === null
        ? "running, but no pass is queued"
        : `running, but no pass is queued; the next was due ${minutes(t - due)} ago`,
  };
}

/** One loop's trouble, from the first check that saw it until it has been healthy for `COOL_MS`. */
export interface Incident {
  id: string;
  service: string;
  key: string;
  kind: "dead" | "stuck";
  why: string;
  since: string;
  /** Wakes sent in this incident. */
  restarts: number;
  restartedAt: string | null;
  /** Healthy since; null while still in trouble. */
  healthySince: string | null;
  /** Restarts used up: told once, no more wakes. */
  gaveUp: boolean;
  /** The blocker's dead letter, when it has one (`wren dlq show <id>`). */
  letter?: number | null;
  blocker?: OpenCall | null;
}

interface Notice {
  level: NotifyLevel;
  title: string;
  body: string;
}

interface WatchPlan {
  /** Loops to wake. */
  restart: { service: string; key: string }[];
  /** Incidents opened this check (one notice each) and ones whose restarts ran out. */
  opened: Incident[];
  gaveUp: Incident[];
  /** The incidents after this check, by loop id. */
  incidents: Record<string, Incident>;
}

/**
 * What to do about each loop, given what the last check left open. Pure. A dead loop is woken;
 * a stuck one only told (its lock is held; ending the blocker is a person's or agent's call). A
 * loop is told about once per incident, however many checks see it or restarts it takes.
 */
export function planWatch(
  health: readonly LoopHealth[],
  before: Readonly<Record<string, Incident>>,
  now: Date,
): WatchPlan {
  const t = now.getTime();
  const at = now.toISOString();
  const plan: WatchPlan = { restart: [], opened: [], gaveUp: [], incidents: {} };
  for (const h of health) {
    const open = before[h.id];
    if (h.health === "stopped") continue;
    if (h.health === "alive") {
      if (!open) continue;
      const healthySince = open.healthySince ?? at;
      if (t - Date.parse(healthySince) < COOL_MS) plan.incidents[h.id] = { ...open, healthySince };
      continue;
    }
    const inc: Incident = open
      ? { ...open, kind: h.health, why: h.why, healthySince: null, blocker: h.blocker }
      : {
          id: h.id,
          service: h.service,
          key: h.key,
          kind: h.health,
          why: h.why,
          since: at,
          restarts: 0,
          restartedAt: null,
          healthySince: null,
          gaveUp: false,
          blocker: h.blocker,
        };
    if (h.health === "dead" && !inc.gaveUp) {
      const due = inc.restartedAt === null || t - Date.parse(inc.restartedAt) >= RESTART_EVERY_MS;
      if (inc.restarts >= MAX_RESTARTS) {
        inc.gaveUp = true;
        plan.gaveUp.push(inc);
      } else if (due) {
        inc.restarts += 1;
        inc.restartedAt = at;
        plan.restart.push({ service: h.service, key: h.key });
      }
    }
    if (!open) plan.opened.push(inc);
    plan.incidents[h.id] = inc;
  }
  return plan;
}

const lineOf = (i: Incident) =>
  `${i.id}: ${i.why}${i.letter ? ` (dead letter #${i.letter})` : i.blocker ? ` (${i.blocker.id})` : ""}`;

/** The check's messages: new dead loops (woken, so silent), new stuck ones, and give-ups. */
export function noticesOf(plan: WatchPlan): Notice[] {
  const out: Notice[] = [];
  const dead = plan.opened.filter((i) => i.kind === "dead" && !i.gaveUp);
  const stuck = plan.opened.filter((i) => i.kind === "stuck");
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  if (dead.length)
    out.push({
      level: "info",
      title: `${n(dead.length, "loop")} had stopped: woken`,
      body: `${dead.map(lineOf).join("\n")}\nNothing to do; a relapse within the hour stays quiet. \`wren loops\` shows them.`,
    });
  if (stuck.length)
    out.push({
      level: "warning",
      title: `${n(stuck.length, "loop")} stuck behind a call`,
      body: `${stuck.map(lineOf).join("\n")}\nEnd the blocker: \`wren dlq show|retry|kill <id>\` for a letter, else \`restate invocations cancel <id>\`. Told once.`,
    });
  if (plan.gaveUp.length)
    out.push({
      level: "warning",
      title: `${n(plan.gaveUp.length, "loop")} ${plan.gaveUp.length === 1 ? "keeps" : "keep"} stopping: watchdog gave up`,
      body: `${plan.gaveUp.map(lineOf).join("\n")}\nWoken ${MAX_RESTARTS} times; each stopped again. \`wren loops\`, then the loop's own status.`,
    });
  return out;
}

/** Every call on an object's key that is not done. `scheduled_at` makes Restate return
 *  `scheduled_start_at`. One read, so a timer that fires between two
 *  reads can't look like no timer and no call. */
const OPEN_SQL = `SELECT id, target, target_service_name, target_service_key, target_handler_name, status,
  created_at, modified_at, scheduled_at, scheduled_start_at
FROM sys_invocation WHERE status <> 'completed' AND target_service_key IS NOT NULL`;
/** A delayed call that carries the chain on: the next pass, or a wake that sends one. */
const NEXT_HANDLERS = new Set(["loop", "wake"]);
const SERVICES_SQL = "SELECT name FROM sys_service";
const INV_ID = /^inv_\w+$/;

const callOf = (r: Record<string, unknown>): OpenCall => ({
  id: String(r.id),
  target: String(r.target ?? ""),
  status: String(r.status ?? ""),
  movedAt: String(r.modified_at ?? r.created_at ?? ""),
});

/**
 * Every loop Restate still serves, with the calls on its key that are not done and what the
 * lock holder waits on. A `running` key left by a retired service is skipped.
 */
async function readLoopViews(admin: RestateAdmin): Promise<LoopView[]> {
  const [stateRows, openRows, serviceRows] = await Promise.all([
    admin(LOOPS_SQL),
    admin(OPEN_SQL),
    admin(SERVICES_SQL),
  ]);
  const live = new Set(serviceRows.map((r) => String(r.name)));
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const r of openRows) {
    const id = `${r.target_service_name}/${r.target_service_key}`;
    byKey.set(id, [...(byKey.get(id) ?? []), r]);
  }
  const views = loopsOf(stateRows)
    .filter((l) => live.has(l.service))
    .map((l): LoopView => {
      const rows = byKey.get(`${l.service}/${l.key}`) ?? [];
      const next = rows
        .filter((r) => r.status === "scheduled" && NEXT_HANDLERS.has(String(r.target_handler_name)))
        .map((r) => String(r.scheduled_start_at ?? r.scheduled_at ?? r.created_at))
        .sort()[0];
      // The holder first: anything not queued, oldest first; then the queue.
      const open = rows
        .filter((r) => r.status !== "scheduled")
        .sort(
          (a, b) =>
            Number(a.status === "pending") - Number(b.status === "pending") ||
            String(a.created_at).localeCompare(String(b.created_at)),
        )
        .map(callOf);
      return { ...l, nextAt: next ?? null, open, waitsOn: [] };
    });
  const holders = views.flatMap((v) => {
    const h = v.open.find((c) => c.status !== "pending");
    return h && INV_ID.test(h.id) ? [h.id] : [];
  });
  if (holders.length) {
    const kids = await admin(
      `SELECT id, target, status, created_at, modified_at, invoked_by_id FROM sys_invocation
WHERE status <> 'completed' AND invoked_by_id IN (${holders.map((id) => `'${id}'`).join(", ")})`,
    );
    for (const v of views) {
      const h = v.open.find((c) => c.status !== "pending");
      if (h) v.waitsOn = kids.filter((k) => k.invoked_by_id === h.id).map(callOf);
    }
  }
  return views;
}

/** Every loop's health now, trouble first. */
export async function loopHealth(admin: RestateAdmin, now: Date): Promise<LoopHealth[]> {
  const rank: Record<Health, number> = { stuck: 0, dead: 1, alive: 2, stopped: 3 };
  return (await readLoopViews(admin))
    .map((v) => healthOf(v, now))
    .sort((a, b) => rank[a.health] - rank[b.health] || a.id.localeCompare(b.id));
}

interface LoopWatchDeps {
  main: Db;
  admin: RestateAdmin;
  notifier?: Notifier;
}

export interface LoopWatchPass {
  loops: number;
  alive: number;
  stopped: number;
  dead: number;
  stuck: number;
  restart: { service: string; key: string }[];
  notices: Notice[];
  /** Open incidents after this check, by loop id; `status` shows them. */
  incidents: Record<string, Incident>;
  /** Loops whose last pass timed out calls, by loop id: how many, and how many units it held. */
  timedOut: Record<string, { calls: number; held: number }>;
}

const INCIDENTS = "incidents";

/** Each loop whose last pass gave up on a call, with the count and the units it held. */
function timedOutOf(health: readonly LoopHealth[]): LoopWatchPass["timedOut"] {
  const out: LoopWatchPass["timedOut"] = {};
  for (const h of health)
    if (h.timeouts.length)
      out[h.id] = { calls: h.timeouts.length, held: h.timeouts.filter((t) => t.held).length };
  return out;
}

/** One check: read, sort, plan; the letters of new stuck loops looked up. No Restate calls. */
async function loopWatchCheck(
  deps: Pick<LoopWatchDeps, "main" | "admin">,
  before: Readonly<Record<string, Incident>>,
  now: Date,
): Promise<LoopWatchPass> {
  const health = await loopHealth(deps.admin, now);
  const plan = planWatch(health, before, now);
  const blocked = plan.opened.flatMap((i) => (i.blocker ? [i.blocker.id] : []));
  if (blocked.length) {
    const letters = await deps.main
      .select({ id: deadLetters.id, invocationId: deadLetters.invocationId })
      .from(deadLetters)
      .where(inArray(deadLetters.invocationId, blocked));
    for (const i of plan.opened)
      i.letter = letters.find((l) => l.invocationId === i.blocker?.id)?.id ?? null;
  }
  const count = (h: Health) => health.filter((x) => x.health === h).length;
  return {
    loops: health.length,
    alive: count("alive"),
    stopped: count("stopped"),
    dead: count("dead"),
    stuck: count("stuck"),
    restart: plan.restart,
    notices: noticesOf(plan),
    incidents: plan.incidents,
    timedOut: timedOutOf(health),
  };
}

type Wake = { wake: (ctx: restate.ObjectContext) => Promise<boolean> };

/** `LoopWatch/all`: a check every ten minutes; dead loops woken, each incident told once. */
export function makeLoopWatch(deps: LoopWatchDeps) {
  return makeLoopObject("LoopWatch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const before = (await ctx.get<Record<string, Incident>>(INCIDENTS)) ?? {};
    const outcome = (await runPass<LoopWatchPass>(ctx, deps.main, now, {
      name: "check",
      ledger: { command: "loops watch", argv: { daemon: true } },
      body: () => loopWatchCheck(deps, before, now),
      delayAfter: () => LOOP_WATCH_EVERY_MS,
      retryMs: LOOP_WATCH_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<LoopWatchPass>;
    const stats = outcome.stats;
    if (!stats) return outcome;
    // `wake` bumps the generation and sends a fresh `loop` call; a late old one drops out.
    for (const r of stats.restart) ctx.objectSendClient<Wake>({ name: r.service }, r.key).wake();
    const notifier = deps.notifier;
    if (notifier)
      for (const [i, n] of stats.notices.entries())
        await ctx.run(`tell ${i}`, () => notifier.notify(n.title, n.body, n.level));
    ctx.set(INCIDENTS, stats.incidents);
    return outcome;
  });
}

export type LoopWatch = ReturnType<typeof makeLoopWatch>;

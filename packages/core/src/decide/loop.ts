/**
 * `Decide/wren`: every 10 minutes, the subjects each source says are due get one decision each.
 * Scored here, never inline, so no draft or score step waits on an outside API, and the Mac's reads
 * are covered as well as the worker's.
 *
 * Limits: at most `max` subjects and `budgetMs` a pass, each call `LIMITS.http`; 3 failures end the
 * pass, a refused key ends it at once, and the daily cap holds it.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db, Queryable } from "@wren/db";
import { makeLoopObject, type PassOutcome, runPass } from "../restate/loop.js";
import type { BackendChoice } from "./backends.js";
import {
  DEFAULT_DAILY_USD,
  DecideStop,
  decide,
  decideModes,
  decideSettings,
  spentToday,
} from "./decide.js";
import type { DecideMode, DecisionKind } from "./kinds.js";

export interface DecideSubject {
  subject: string;
  /** JSON: what the backend is shown. */
  state: Record<string, unknown>;
}

/** What one kind asks about: its subjects due now. */
export interface DecideSource {
  kind: DecisionKind;
  due(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>;
}

export const DECIDE_EVERY_MS = 10 * 60_000;
export const DECIDE_MAX = 40;
export const DECIDE_BUDGET_MS = 5 * 60_000;
export const DECIDE_MAX_FAILURES = 3;

export interface DecidePassStats {
  asked: number;
  answered: number;
  refused: number;
  failed: number;
  usd: number;
  inputTokens: number;
  /** Why the pass ended early, or didn't run. */
  stopped: string | null;
  byKind: Partial<Record<DecisionKind, number>>;
}

export async function decidePass(
  db: Queryable,
  o: {
    sources: readonly DecideSource[];
    backends: BackendChoice;
    now?: Date;
    max?: number;
    budgetMs?: number;
    limitMs?: number;
    /** This pass's own spend limit, in place of the daily cap: a sample William set. */
    maxUsd?: number;
    /** Every decision's mode, in place of each kind's: `shadow` for a sample he never sees. */
    mode?: DecideMode;
  },
): Promise<DecidePassStats> {
  const s: DecidePassStats = {
    asked: 0,
    answered: 0,
    refused: 0,
    failed: 0,
    usd: 0,
    inputTokens: 0,
    stopped: null,
    byKind: {},
  };
  const now = o.now ?? new Date();
  const t0 = Date.now();
  if (!o.backends.chain.length) return { ...s, stopped: o.backends.note ?? "no backend" };
  const modes = await decideModes(db);
  const cap = o.maxUsd ?? (await decideSettings(db)).dailyUsd ?? DEFAULT_DAILY_USD;
  let spent = o.maxUsd !== undefined ? 0 : await spentToday(db, now);
  let left = o.max ?? DECIDE_MAX;
  outer: for (const src of o.sources) {
    const mode = modes[src.kind] === "off" ? "off" : (o.mode ?? modes[src.kind]);
    if (mode === "off" || left <= 0) continue;
    for (const sub of await src.due(db, now, left)) {
      if (spent >= cap) {
        s.stopped = `${o.maxUsd !== undefined ? "spend limit" : "daily cap"} $${cap} reached`;
        break outer;
      }
      if (Date.now() - t0 > (o.budgetMs ?? DECIDE_BUDGET_MS)) {
        s.stopped = "out of time";
        break outer;
      }
      left--;
      s.asked++;
      try {
        const row = await decide(db, {
          kind: src.kind,
          subject: sub.subject,
          state: sub.state,
          mode,
          chain: o.backends.chain,
          ...(o.limitMs ? { limitMs: o.limitMs } : {}),
        });
        if (!row) continue;
        if (row.label) s.answered++;
        else s.refused++;
        s.usd += row.costUsd;
        s.inputTokens += row.inputTokens ?? 0;
        spent += row.costUsd;
        s.byKind[src.kind] = (s.byKind[src.kind] ?? 0) + 1;
      } catch (err) {
        if (err instanceof DecideStop) {
          s.stopped = err.message;
          break outer;
        }
        s.failed++;
        if (s.failed >= DECIDE_MAX_FAILURES) {
          s.stopped = `${s.failed} failures: ${String(err).slice(0, 200)}`;
          break outer;
        }
      }
    }
  }
  s.usd = Math.round(s.usd * 1e6) / 1e6;
  return s;
}

export interface DecideDeps {
  main: Db;
  sources: readonly DecideSource[];
  /** Read per pass, so a key set later is picked up. */
  backends(): BackendChoice;
}

/** `Decide/wren`: one pass every 10 minutes over Wren's own workspace. */
export function makeDecide(d: DecideDeps) {
  return makeLoopObject("Decide", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return (await runPass<DecidePassStats>(ctx, d.main, now, {
      name: "decide",
      ledger: { command: "decide pass", argv: { daemon: true } },
      body: async () => decidePass(d.main, { sources: d.sources, backends: d.backends(), now }),
      delayAfter: () => DECIDE_EVERY_MS,
      retryMs: DECIDE_EVERY_MS,
    })) as PassOutcome<DecidePassStats>;
  });
}
export type DecideService = ReturnType<typeof makeDecide>;

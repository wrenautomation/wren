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
import { z } from "zod";
import { exclusiveHandler } from "../restate/form.js";
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
import { DECISION_KINDS, type DecideMode, type DecisionKind, KINDS } from "./kinds.js";

export interface DecideSubject {
  subject: string;
  /** JSON: what the backend is shown. */
  state: Record<string, unknown>;
}

/** What one kind asks about: its subjects due now. */
export interface DecideSource {
  kind: DecisionKind;
  due(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>;
  /** One subject asked about by hand (William's press): its state, or null when there is none. */
  one?(db: Queryable, subject: string): Promise<DecideSubject | null>;
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
          s.stopped = `${s.failed} failures: ${String(err).slice(0, 2000)}`;
          break outer;
        }
      }
    }
  }
  s.usd = Math.round(s.usd * 1e6) / 1e6;
  return s;
}

/** What a by-hand ask came to: it ran, or `why` it did not. */
export interface DecideOneOutcome {
  asked: boolean;
  label: string | null;
  why: string | null;
}

/**
 * One subject, asked now: the same cap and backends as a pass. William asked, so a kind in
 * shadow answers as a recommendation (the chip shows); a kind that is off stays off. The same
 * state is bought once (`decide`), so asking again before anything changed returns the row kept.
 * Never throws for an outage or a refusal: the answer says why.
 */
export async function decideOne(
  db: Queryable,
  o: {
    sources: readonly DecideSource[];
    backends: BackendChoice;
    kind: DecisionKind;
    subject: string;
    now?: Date;
    limitMs?: number;
  },
): Promise<DecideOneOutcome> {
  const no = (why: string): DecideOneOutcome => ({ asked: false, label: null, why });
  if (!o.backends.chain.length) return no(o.backends.note ?? "no backend");
  const src = o.sources.find((x) => x.kind === o.kind && x.one);
  if (!src?.one) return no(`${KINDS[o.kind].name} cannot be asked about one`);
  const modes = await decideModes(db);
  if (modes[o.kind] === "off") return no(`${KINDS[o.kind].name} are off`);
  const cap = (await decideSettings(db)).dailyUsd ?? DEFAULT_DAILY_USD;
  if ((await spentToday(db, o.now ?? new Date())) >= cap) return no(`daily cap $${cap} reached`);
  const sub = await src.one(db, o.subject);
  if (!sub) return no("nothing to ask about");
  try {
    const row = await decide(db, {
      kind: o.kind,
      subject: sub.subject,
      state: sub.state,
      mode: modes[o.kind] === "shadow" ? "recommend" : modes[o.kind],
      chain: o.backends.chain,
      ...(o.limitMs ? { limitMs: o.limitMs } : {}),
    });
    return { asked: !!row, label: row?.label ?? null, why: row?.error ?? null };
  } catch (err) {
    return no(err instanceof DecideStop ? err.message : String(err).slice(0, 2000));
  }
}

const ONE_INPUT = z.object({
  kind: z.enum(DECISION_KINDS),
  subject: z.string().min(1).max(200),
});

export interface DecideDeps {
  main: Db;
  sources: readonly DecideSource[];
  /** Read per pass, so a key set later is picked up. */
  backends(): BackendChoice;
}

/** `Decide/wren`: one pass every 10 minutes over Wren's own workspace. */
export function makeDecide(d: DecideDeps) {
  /** One subject asked now (the people console's "Check with Jev"). */
  const one = exclusiveHandler(
    { input: ONE_INPUT },
    async (
      ctx: restate.ObjectContext,
      req: z.infer<typeof ONE_INPUT>,
    ): Promise<DecideOneOutcome> => {
      const now = new Date(await ctx.date.now());
      return ctx.run("decide one", () =>
        decideOne(d.main, {
          sources: d.sources,
          backends: d.backends(),
          kind: req.kind,
          subject: req.subject,
          now,
        }),
      );
    },
  );
  return makeLoopObject(
    "Decide",
    async (ctx: restate.ObjectContext) => {
      const now = new Date(await ctx.date.now());
      return (await runPass<DecidePassStats>(ctx, d.main, now, {
        name: "decide",
        ledger: { command: "decide pass", argv: { daemon: true } },
        body: async () => decidePass(d.main, { sources: d.sources, backends: d.backends(), now }),
        delayAfter: () => DECIDE_EVERY_MS,
        retryMs: DECIDE_EVERY_MS,
      })) as PassOutcome<DecidePassStats>;
    },
    { extra: { one } },
  );
}
export type DecideService = ReturnType<typeof makeDecide>;

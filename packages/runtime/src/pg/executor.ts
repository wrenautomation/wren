/** Runs one claimed turn end to end: load, replay, outcome. Same code on the box and in Lambda. */

import { CancelledError } from "@restatedev/restate-sdk";
import type postgres from "postgres";
import type { Registry } from "./registry.js";
import { type Claim, finish, flush, isFenced, load, renew, unpin } from "./store.js";
import {
  Crash,
  type Invocation,
  type Loaded,
  Turn,
  type TurnOptions,
  toErrorJson,
} from "./turn.js";
import { type Finish, fromWire, type TurnAsk, type TurnReply, toWire, WIRE_MAX } from "./wire.js";

export interface ExecutorOptions extends TurnOptions {
  sql: postgres.Sql;
  registry: Registry;
  leaseMs?: number;
  log?: (msg: string, err?: unknown) => void;
  /** loaded by the caller (the box, for a Lambda turn) */
  loaded?: Loaded;
  /** writes the outcome; default: `finish` here. A Lambda turn hands it back to the box. */
  end?: (inv: Invocation, f: Finish) => Promise<void>;
}

export const DEFAULT_LEASE_MS = 60_000;

export async function runTurn(
  o: ExecutorOptions,
  c: Pick<Claim, "id" | "attempt">,
): Promise<string> {
  const leaseMs = o.leaseMs ?? DEFAULT_LEASE_MS;
  const log = o.log ?? ((m, e) => console.error(`rt: ${m}`, e ?? ""));
  const loaded = o.loaded ?? (await load(o.sql, c.id, c.attempt));
  if (!loaded) return "gone";
  const end =
    o.end ?? ((i: Invocation, f: Finish) => finish(o.sql, i, f.w, f.outcome, f.policy, leaseMs));
  const inv = loaded.inv;
  const h = o.registry.get(inv.service, inv.handler);
  if (!h) {
    const message = `no handler ${inv.service}/${inv.handler} here`;
    if (await unpin(o.sql, inv.id, inv.attempt, 2_000, message)) return "unpinned";
    await end(inv, { w: null, outcome: { type: "failed", error: { message } }, policy: undefined });
    return "failed";
  }
  if (inv.cancel && loaded.journal.length === 0) {
    await end(inv, {
      w: null,
      outcome: { type: "done", error: toErrorJson(new CancelledError()) },
      policy: h.retry,
    });
    return "done";
  }
  const turn = new Turn(loaded, h, { flush: (w) => flush(o.sql, inv, w, leaseMs) }, o);
  const beat = setInterval(() => {
    renew(o.sql, inv.id, inv.attempt, leaseMs).catch((e: unknown) => {
      if (isFenced(e)) turn.finish({ type: "fenced" });
    });
  }, leaseMs / 3);
  beat.unref();
  try {
    const outcome = await turn.execute();
    await turn.idle();
    if (outcome.type === "fenced") return "fenced";
    try {
      o.crash?.("finish:before");
    } catch {
      return "fenced";
    }
    await end(inv, { w: turn.leftover(), outcome, policy: h.retry });
    return outcome.type;
  } catch (e) {
    if (e instanceof Crash) return "fenced";
    // the lease runs out and another turn replays it
    log(`turn ${inv.id} #${inv.attempt} ended without an outcome`, e);
    return "lost";
  } finally {
    clearInterval(beat);
  }
}

/**
 * Box side of a Lambda turn: load here, `call` runs the handler (Lambda), finish here.
 * Lambda's own Postgres trips drop to its `ctx.run` flushes and lease renewals.
 */
export async function remoteTurn(
  sql: postgres.Sql,
  c: Pick<Claim, "id" | "attempt">,
  leaseMs: number,
  call: (ask: TurnAsk) => Promise<TurnReply | string | null | undefined>,
): Promise<string> {
  const loaded = await load(sql, c.id, c.attempt);
  if (!loaded) return "gone";
  const wire = toWire(loaded);
  const reply = await call({
    id: c.id,
    attempt: c.attempt,
    leaseMs,
    defer: true,
    ...(wire.length < WIRE_MAX ? { loaded: wire } : {}),
  });
  // an old Lambda build finished the turn itself and answered with its status
  if (!reply || typeof reply === "string") return reply ?? "lost";
  if (reply.finish) {
    const f = fromWire<Finish>(reply.finish);
    await finish(sql, loaded.inv, f.w, f.outcome, f.policy, leaseMs);
  }
  return reply.status;
}

/** Lambda side: run the handler; hand the outcome back unless it is too big for the reply. */
export async function servedTurn(o: ExecutorOptions, ask: TurnAsk): Promise<TurnReply | string> {
  if (!ask.defer) return runTurn({ ...o, leaseMs: ask.leaseMs }, ask);
  let held: { inv: Invocation; f: Finish } | undefined;
  const status = await runTurn(
    {
      ...o,
      leaseMs: ask.leaseMs,
      ...(ask.loaded ? { loaded: fromWire<Loaded>(ask.loaded) } : {}),
      end: async (inv, f) => {
        held = { inv, f };
      },
    },
    ask,
  );
  if (!held) return { status };
  const wire = toWire(held.f);
  if (wire.length < WIRE_MAX) return { status, finish: wire };
  await finish(o.sql, held.inv, held.f.w, held.f.outcome, held.f.policy, ask.leaseMs);
  return { status };
}

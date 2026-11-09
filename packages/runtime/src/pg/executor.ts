/** Runs one claimed turn end to end: load, replay, outcome. Same code on the box and in Lambda. */

import { CancelledError } from "@restatedev/restate-sdk";
import type postgres from "postgres";
import type { Registry } from "./registry.js";
import { type Claim, finish, flush, isFenced, load, renew, unpin } from "./store.js";
import { Crash, Turn, type TurnOptions, toErrorJson } from "./turn.js";

export interface ExecutorOptions extends TurnOptions {
  sql: postgres.Sql;
  registry: Registry;
  leaseMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

export const DEFAULT_LEASE_MS = 60_000;

export async function runTurn(
  o: ExecutorOptions,
  c: Pick<Claim, "id" | "attempt">,
): Promise<string> {
  const leaseMs = o.leaseMs ?? DEFAULT_LEASE_MS;
  const log = o.log ?? ((m, e) => console.error(`rt: ${m}`, e ?? ""));
  const loaded = await load(o.sql, c.id, c.attempt);
  if (!loaded) return "gone";
  const inv = loaded.inv;
  const h = o.registry.get(inv.service, inv.handler);
  if (!h) {
    const message = `no handler ${inv.service}/${inv.handler} here`;
    if (await unpin(o.sql, inv.id, inv.attempt, 2_000, message)) return "unpinned";
    await finish(o.sql, inv, null, { type: "failed", error: { message } }, undefined, leaseMs);
    return "failed";
  }
  if (inv.cancel && loaded.journal.length === 0) {
    await finish(
      o.sql,
      inv,
      null,
      { type: "done", error: toErrorJson(new CancelledError()) },
      h.retry,
      leaseMs,
    );
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
    await finish(o.sql, inv, turn.leftover(), outcome, h.retry, leaseMs);
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

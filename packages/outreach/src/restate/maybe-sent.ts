/**
 * A send that lands at most once, on Restate (designs/2026-10-16-send-verdicts.md). The ledger
 * claim and settle are steps; the send is the caller's journaled site call, never inside a step.
 * The send runs under the ledger row's key, and autobrowse says whether it went out. Unsure ends
 * the invocation terminally, so Restate neither retries nor pauses it.
 */
import * as restate from "@restatedev/restate-sdk";
import { SiteCallError } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import { sendOnce } from "@wren/core/maybe-sent";
import type { Queryable } from "@wren/db";
import { ReachRefusal } from "../refusal.js";
import {
  claimSend,
  releaseSend,
  type SendClaim,
  settleSent,
  settleUnsure,
  UNSURE_WAITS,
} from "../send-attempts.js";

/** Parked for a person. Terminal: a scheduled slot leaves the schedule, nothing retries it. */
export class SendUnsure extends restate.TerminalError {
  readonly unsure = true;
}
export const isSendUnsure = (err: unknown): err is SendUnsure => err instanceof SendUnsure;

/**
 * The claim was refused: another invocation is sending it, it waits on a person, or a refusal of
 * the claim itself. Terminal (409), and nothing about the send changed.
 */
export class SendTaken extends restate.TerminalError {
  readonly taken = true;
}
export const isSendTaken = (err: unknown): err is SendTaken => err instanceof SendTaken;

/**
 * Autobrowse said nothing went out (the browser was busy, the page never loaded, the read showed
 * it absent). The ledger row is released, so the item sends again on its next pass under a new
 * key. Terminal: this invocation does not send it again.
 */
export class SendNotSent extends restate.TerminalError {
  readonly notSent = true;
  constructor(
    message: string,
    readonly how: "before_submit" | "verified_absent",
  ) {
    super(message, { errorCode: 503 });
  }
}
export const isSendNotSent = (err: unknown): err is SendNotSent => err instanceof SendNotSent;

/**
 * A send's failure as its handler throws it: a refusal, or a journaled answer a retry would only
 * replay, is terminal; anything else is left for Restate to retry.
 */
export function sendError(err: unknown): unknown {
  if (err instanceof restate.TerminalError) return err;
  if (isRefusal(err)) return new restate.TerminalError(err.message, { errorCode: err.status });
  if (err instanceof SiteCallError && err.journaled)
    return new restate.TerminalError(err.message, { errorCode: err.status || 502 });
  return err;
}

interface AtMostOnce extends Omit<SendClaim, "invocation" | "now"> {
  /** Runs under the ledger row's send key; a desk write inside it carries the key. */
  send: () => Promise<{ ref: string | null }>;
  /** Guards before a first send, not on a take-over (others of ours in the thread). */
  before?: () => Promise<void>;
}

export interface Landed {
  ref: string | null;
  at: string;
  /** Found by autobrowse's verified read rather than answered by the send. */
  found: boolean;
}

export async function sendAtMostOnce(
  ctx: restate.Context,
  db: Queryable,
  o: AtMostOnce,
): Promise<Landed> {
  const now = new Date(await ctx.date.now());
  const { send, before, ...claim } = o;
  // A refusal comes back as a value, so it is thrown as `SendTaken` here, not as a step's error.
  const claimed = await ctx.run("claim send", async () => {
    try {
      return await claimSend(db, { ...claim, invocation: ctx.request().id, now });
    } catch (err) {
      if (err instanceof ReachRefusal) return { go: "taken" as const, why: err.message };
      throw err;
    }
  });
  if (claimed.go === "taken") throw new SendTaken(claimed.why, { errorCode: 409 });
  if (claimed.go === "done")
    return { ref: claimed.ref, at: claimed.at ?? now.toISOString(), found: true };
  let out: Awaited<ReturnType<typeof sendOnce<{ ref: string | null }>>>;
  try {
    out = await sendOnce({
      key: claimed.sendKey,
      send,
      tried: claimed.tried,
      ...(before ? { before } : {}),
    });
  } catch (err) {
    // A refusal, or an error before any write answered: no attempt stands.
    await ctx.run("release send", () => releaseSend(db, o.item));
    throw err;
  }
  if (out.kind === "not_sent") {
    await ctx.run("release send", () => releaseSend(db, o.item));
    throw new SendNotSent(`Nothing went out: ${out.reason}`, out.how);
  }
  if (out.kind === "unsure") {
    const why = out.why;
    await ctx.run("unsure", () => settleUnsure(db, o.item, { why, now }));
    throw new SendUnsure(`It ${UNSURE_WAITS}. ${why}`, { errorCode: 409 });
  }
  const ref = out.kind === "sent" ? out.sent.ref : out.seen.ref;
  const at = (out.kind === "found" && out.seen.at) || now.toISOString();
  const by = out.kind;
  await ctx.run("settle send", () => settleSent(db, o.item, { ref, at: new Date(at), by, now }));
  return { ref, at, found: out.kind === "found" };
}

/**
 * A send on the ledger, typed (designs/2026-10-16-send-verdicts.md). A write carries the ledger
 * row's send key and says whether it went out: `sent`, `not_sent` or `unknown`. `sendOnce` runs
 * the send under that key and maps the answer. Wren reads no words and no site, and a take-over
 * runs the same key again, so the stored verdict answers and nothing is written twice.
 *
 * `send` may hold journaled site calls, so `sendOnce` never wraps it in a step.
 */
import { SiteCallError } from "./content/autobrowse.js";
import { NotSent, type SendTrace, SendUnknown, SentFound, withSendKey } from "./send-verdict.js";

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What `sendOnce` ended with. A platform's refusal is thrown (`refusalOf`), not returned. */
type SendOutcome<S> =
  | { kind: "sent"; sent: S }
  | {
      kind: "found";
      seen: { kind: "found"; ref: string | null; at: string | null; url: string | null };
    }
  /** Nothing went out, and the item may be sent again (under a new key). */
  | { kind: "not_sent"; how: "before_submit" | "verified_absent"; reason: string }
  | { kind: "unsure"; why: string };

interface SendOnce<S> {
  /** The ledger row's send key: the send runs under it. */
  key: string;
  send: () => Promise<S>;
  /** A take-over: an earlier try may have left. Its key answers its stored verdict; `unknown` is asked again. */
  tried?: boolean;
  /** Guards that run before a first send (not on a take-over: our own earlier send is there). */
  before?: () => Promise<void>;
}

/** The platform said no to the write: the error `isRefusal` reads, with its status. */
export const refusalOf = (err: NotSent): SiteCallError => {
  const e = new SiteCallError("send", "POST", "write", err.status ?? 400, err.reason);
  e.journaled = true;
  return e;
};

/**
 * Send once, under its key, and say what became of it. A refusal is thrown as it came. An
 * error after a keyed write answered is `unsure`, never thrown: the item must not be sent
 * again by a caller that releases on a throw. Any other error is thrown (nothing left).
 */
export async function sendOnce<S>(o: SendOnce<S>): Promise<SendOutcome<S>> {
  if (!o.tried) await o.before?.();
  const trace: SendTrace = { wrote: false };
  try {
    return {
      kind: "sent",
      sent: await withSendKey(o.key, o.send, { recheck: o.tried === true, trace }),
    };
  } catch (err) {
    if (err instanceof SentFound)
      return {
        kind: "found",
        seen: { kind: "found", ref: err.id, at: err.at, url: err.url },
      };
    if (err instanceof NotSent) {
      if (err.how === "refused") throw refusalOf(err);
      return { kind: "not_sent", how: err.how, reason: err.reason };
    }
    if (err instanceof SendUnknown) return { kind: "unsure", why: err.reason };
    if (trace.wrote)
      return { kind: "unsure", why: `a write answered, then: ${said(err).slice(0, 2000)}` };
    throw err;
  }
}

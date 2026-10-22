/**
 * Send verdicts from autobrowse (autobrowse designs/2026-10-16-send-verdicts.md). A desk write
 * carries a send key and answers `sent`, `not_sent` or `unknown` as a value. Wren maps the
 * value and never reads autobrowse's words.
 *
 * The key scope: `withSendKey(key, fn)` runs a send, and every irreversible site call inside it
 * (`restateSites`) carries a key made from it, one per write (`writeKey`). Across a service
 * boundary the key rides in the request, and the callee answers a `Delivery` value, since a
 * thrown error loses its type on the way back (`deliveryOf`, `delivered`).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as restate from "@restatedev/restate-sdk";

/** autobrowse's `SendVerdict` (`src/sites/verdict.ts`); no import from that repo. */
export type SendVerdict =
  | {
      verdict: "sent";
      id: string | null;
      url: string | null;
      at: string;
      how: "answer" | "verified";
      /** The official answer, as an unkeyed call gives it; only when `how` is `answer`. */
      output?: unknown;
    }
  | {
      verdict: "not_sent";
      reason: string;
      how: "refused" | "before_submit" | "verified_absent";
      status?: number;
    }
  | { verdict: "unknown"; reason: string; since: string };

/** The verify read found it: it went out, with this id. The answer itself was lost. */
export class SentFound extends Error {
  constructor(
    readonly id: string | null,
    readonly url: string | null,
    readonly at: string,
  ) {
    super(`sent: found on the site${id ? ` as ${id}` : ""}`);
    this.name = "SentFound";
  }
}

/** Nothing went out. `refused`: the platform said no. Else the item may be sent again. */
export class NotSent extends Error {
  constructor(
    readonly how: "refused" | "before_submit" | "verified_absent",
    readonly reason: string,
    readonly status: number | null = null,
  ) {
    super(`not sent (${how}): ${reason}`);
    this.name = "NotSent";
  }
}

/** No read could tell. A person checks it (To approve, "May have gone out"). */
export class SendUnknown extends Error {
  constructor(
    readonly reason: string,
    readonly since: string,
  ) {
    super(`may have gone out: ${reason}`);
    this.name = "SendUnknown";
  }
}

/** A write whose end no answer told: `unknown`, and something may be out there. */
export function unknownSend(reason: string, since: string): SendUnknown {
  noteAnswer("unknown");
  return new SendUnknown(reason, since);
}

/** A verdict as `restateSites` hands it on: the answer's output, or one of the typed errors. */
export function outputOf<T>(v: SendVerdict): T {
  noteAnswer(v.verdict);
  if (v.verdict === "sent") {
    if (v.how === "answer") return v.output as T;
    throw new SentFound(v.id, v.url, v.at);
  }
  if (v.verdict === "not_sent") throw new NotSent(v.how, v.reason, v.status ?? null);
  throw new SendUnknown(v.reason, v.since);
}

/** What a send's writes did, readable by the caller once the send ends (also when it threw). */
export interface SendTrace {
  /**
   * A keyed write answered `sent`, `found` or `unknown`: something may be out there, so the
   * send is never released for a blind second try. False: nothing is left (a `not_sent`
   * answer, or no write answered at all).
   */
  wrote: boolean;
}

export interface SendScopeOptions {
  /**
   * An `unknown` answer asks `verdict {sendKey}` once more (autobrowse re-runs its verify reads).
   * A takeover or a person's "check again" sets it.
   */
  recheck?: boolean;
  /**
   * Ask what became of each keyed write; never write. A keyed write asks `verdict {sendKey}` (or
   * reads the send journal) in place of making the call, so a key the other side has forgotten
   * cannot send. Calls that are not keyed (reads, staging) still run as usual.
   */
  verifyOnly?: boolean;
  /** Read after the send: did a keyed write answer? */
  trace?: SendTrace;
}

interface KeyScope {
  key: string;
  /** Writes made so far in this scope, by route: the second write to one route gets its own key. */
  seen: Map<string, number>;
  recheck: boolean;
  verifyOnly: boolean;
  trace: SendTrace;
}

const scopes = new AsyncLocalStorage<KeyScope>();

/** Run a send under its key (a `send_attempts` row's `send_key`). Deterministic on replay. */
export const withSendKey = <T>(
  key: string,
  fn: () => Promise<T>,
  o: SendScopeOptions = {},
): Promise<T> =>
  scopes.run(
    {
      key,
      seen: new Map(),
      recheck: o.recheck ?? false,
      verifyOnly: o.verifyOnly ?? false,
      trace: o.trace ?? { wrote: false },
    },
    fn,
  );

/**
 * A fresh send key for an item (`dm:42 3f9a...`): one per send, never reused, since autobrowse
 * keeps a final verdict per key for good. Make it inside a journaled step, so a replay gets
 * the same one.
 */
export const newSendKey = (item: string): string =>
  `${item} ${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** The send key this code runs under, or null. */
export const currentSendKey = (): string | null => scopes.getStore()?.key ?? null;

/** Does this scope ask for an `unknown` answer to be checked once more? */
export const rechecking = (): boolean => scopes.getStore()?.recheck ?? false;

/** Does this scope only ask what became of its keyed writes, never write? */
export const verifyingOnly = (): boolean => scopes.getStore()?.verifyOnly ?? false;

/** A keyed write answered with this verdict (`Delivery` kinds count the same). */
export function noteAnswer(kind: "sent" | "found" | "not_sent" | "unknown"): void {
  const s = scopes.getStore();
  if (s && kind !== "not_sent") s.trace.wrote = true;
}

/**
 * The key of one irreversible write in the current scope: the send key, the route, and its
 * count, so a publish and its first comment are two writes. Null outside a scope.
 */
export function writeKey(site: string, method: string, path: string): string | null {
  const s = scopes.getStore();
  if (!s) return null;
  const route = `${site} ${method} ${path}`;
  const n = (s.seen.get(route) ?? 0) + 1;
  s.seen.set(route, n);
  // A long path is what the cut loses, never the count.
  const tail = n > 1 ? ` #${n}` : "";
  return `${`${s.key} ${route}`.slice(0, 200 - tail.length)}${tail}`;
}

/** A send's result as a value, for an answer across a Restate service boundary. */
export type Delivery<T> =
  | { kind: "sent"; out: T }
  | { kind: "found"; id: string | null; url: string | null; at: string }
  | {
      kind: "not_sent";
      how: "refused" | "before_submit" | "verified_absent";
      reason: string;
      status: number | null;
    }
  | { kind: "unknown"; reason: string; since: string };

/** Is this answer a `Delivery` (a keyed write's answer), not the plain output of an older callee? */
export const isDelivery = (v: unknown): v is Delivery<unknown> => {
  if (typeof v !== "object" || v === null || !("kind" in v)) return false;
  // A void answer loses its `out` on the wire, so `sent` needs nothing more.
  return v.kind === "sent" || v.kind === "found" || v.kind === "not_sent" || v.kind === "unknown";
};

/** In the callee: run the send under `key` and answer what happened as a value. */
export async function deliveryOf<T>(
  key: string,
  fn: () => Promise<T>,
  o: SendScopeOptions = {},
): Promise<Delivery<T>> {
  const trace: SendTrace = o.trace ?? { wrote: false };
  try {
    return { kind: "sent", out: await withSendKey(key, fn, { ...o, trace }) };
  } catch (err) {
    if (err instanceof SentFound) return { kind: "found", id: err.id, url: err.url, at: err.at };
    if (err instanceof NotSent)
      return { kind: "not_sent", how: err.how, reason: err.reason, status: err.status };
    if (err instanceof SendUnknown)
      return { kind: "unknown", reason: err.reason, since: err.since };
    // An error after a write answered: something may be out there, so the caller must not
    // see a plain failure it could release and send again.
    if (trace.wrote)
      return {
        kind: "unknown",
        reason: `a write answered, then: ${err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000)}`,
        since: new Date().toISOString(),
      };
    throw err;
  }
}

/** In the caller: the delivery's output, or the typed error the callee caught. */
export function delivered<T>(d: Delivery<T>): T {
  noteAnswer(d.kind);
  if (d.kind === "sent") return d.out;
  if (d.kind === "found") throw new SentFound(d.id, d.url, d.at);
  if (d.kind === "not_sent") throw new NotSent(d.how, d.reason, d.status);
  throw new SendUnknown(d.reason, d.since);
}

/**
 * A write that crosses a service boundary under the scope's key: `call` gets the request's
 * `sendKey`, `recheck` and `verifyOnly`, and the callee answers a `Delivery` (a Content handler given a key).
 * The value is unwrapped here, so a typed outcome is thrown as it was in the callee.
 */
export async function sendAcross<T>(
  call: (k: { sendKey: string; recheck: boolean; verifyOnly: boolean }) => Promise<unknown>,
): Promise<T> {
  const sendKey = currentSendKey();
  if (!sendKey) throw new Error("sendAcross needs a send key: run it inside withSendKey");
  const answer = await call({ sendKey, recheck: rechecking(), verifyOnly: verifyingOnly() });
  // A callee that ignores the key answers the plain output.
  return isDelivery(answer)
    ? delivered(answer as Delivery<T>)
    : delivered({ kind: "sent", out: answer as T });
}

/** A typed send outcome, terminal for Restate: it says what happened, a retry cannot change it. */
export const isSendOutcome = (err: unknown): err is SentFound | NotSent | SendUnknown =>
  err instanceof SentFound || err instanceof NotSent || err instanceof SendUnknown;

/** A typed outcome as a terminal error, where a handler must end on it (409, or the refusal's status). */
export function terminalOf(err: SentFound | NotSent | SendUnknown): restate.TerminalError {
  const code = err instanceof NotSent && err.how === "refused" ? (err.status ?? 400) : 409;
  return new restate.TerminalError(err.message, { errorCode: code });
}

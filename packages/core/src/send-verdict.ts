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

/** A verdict as `restateSites` hands it on: the answer's output, or one of the typed errors. */
export function outputOf<T>(v: SendVerdict): T {
  if (v.verdict === "sent") {
    if (v.how === "answer") return v.output as T;
    throw new SentFound(v.id, v.url, v.at);
  }
  if (v.verdict === "not_sent") throw new NotSent(v.how, v.reason, v.status ?? null);
  throw new SendUnknown(v.reason, v.since);
}

interface KeyScope {
  key: string;
  /** Writes made so far in this scope, by route: the second write to one route gets its own key. */
  seen: Map<string, number>;
}

const scopes = new AsyncLocalStorage<KeyScope>();

/** Run a send under its key (a `send_attempts` row's `send_key`). Deterministic on replay. */
export const withSendKey = <T>(key: string, fn: () => Promise<T>): Promise<T> =>
  scopes.run({ key, seen: new Map() }, fn);

/** The send key this code runs under, or null. */
export const currentSendKey = (): string | null => scopes.getStore()?.key ?? null;

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
  return `${s.key} ${route}${n > 1 ? ` #${n}` : ""}`.slice(0, 200);
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

/** In the callee: run the send under `key` and answer what happened as a value. */
export async function deliveryOf<T>(key: string, fn: () => Promise<T>): Promise<Delivery<T>> {
  try {
    return { kind: "sent", out: await withSendKey(key, fn) };
  } catch (err) {
    if (err instanceof SentFound) return { kind: "found", id: err.id, url: err.url, at: err.at };
    if (err instanceof NotSent)
      return { kind: "not_sent", how: err.how, reason: err.reason, status: err.status };
    if (err instanceof SendUnknown)
      return { kind: "unknown", reason: err.reason, since: err.since };
    throw err;
  }
}

/** In the caller: the delivery's output, or the typed error the callee caught. */
export function delivered<T>(d: Delivery<T>): T {
  if (d.kind === "sent") return d.out;
  if (d.kind === "found") throw new SentFound(d.id, d.url, d.at);
  if (d.kind === "not_sent") throw new NotSent(d.how, d.reason, d.status);
  throw new SendUnknown(d.reason, d.since);
}

/** A typed send outcome, terminal for Restate: it says what happened, a retry cannot change it. */
export const isSendOutcome = (err: unknown): err is SentFound | NotSent | SendUnknown =>
  err instanceof SentFound || err instanceof NotSent || err instanceof SendUnknown;

/** A typed outcome as a terminal error, where a handler must end on it (409, or the refusal's status). */
export function terminalOf(err: SentFound | NotSent | SendUnknown): restate.TerminalError {
  const code = err instanceof NotSent && err.how === "refused" ? (err.status ?? 400) : 409;
  return new restate.TerminalError(err.message, { errorCode: code });
}

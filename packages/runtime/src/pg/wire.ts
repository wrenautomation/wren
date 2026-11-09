/**
 * A turn across the Lambda invoke (designs/2026-11-09-own-runtime.md, "Lambda turns"): the box
 * loads the row and writes the outcome; Lambda only runs the handler. The invoke payload is JSON,
 * so bytes, maps, sets and dates go as tagged values.
 * Own codec: superjson needs a custom Uint8Array rule, node:v8 ties box and Lambda to one Node major.
 */
import type { RetryPolicy } from "./registry.js";
import type { Invocation, Loaded, Outcome, Writes } from "./turn.js";

const TAG = "__rtw"; // no turn value is an object with this key and an array value

export function toWire(v: unknown): string {
  return JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
    const o = this[k]; // before toJSON: Buffer and Date are still themselves here
    if (o instanceof Uint8Array)
      return { [TAG]: ["b", Buffer.from(o.buffer, o.byteOffset, o.byteLength).toString("base64")] };
    if (o instanceof Map) return { [TAG]: ["m", [...o]] };
    if (o instanceof Set) return { [TAG]: ["s", [...o]] };
    if (o instanceof Date) return { [TAG]: ["d", String(o.getTime())] }; // NaN = pg 'infinity'
    return x;
  });
}

export function fromWire<T>(s: string): T {
  return JSON.parse(s, (_k, x) => {
    if (x === null || typeof x !== "object" || Array.isArray(x)) return x;
    const t = (x as Record<string, unknown>)[TAG];
    if (!Array.isArray(t) || Object.keys(x).length !== 1) return x;
    const [kind, v] = t as [string, unknown];
    if (kind === "b") return Buffer.from(v as string, "base64");
    if (kind === "m") return new Map(v as [unknown, unknown][]);
    if (kind === "s") return new Set(v as unknown[]);
    if (kind === "d") return new Date(Number(v));
    throw new Error(`rt wire: unknown tag ${kind}`);
  });
}

/** What a turn writes at its end; the box runs `finish` with it. */
export interface Finish {
  w: Writes | null;
  outcome: Exclude<Outcome, { type: "fenced" }>;
  policy: RetryPolicy | undefined;
}

/** Box → Lambda. `loaded` is left out when too big for the invoke; Lambda then loads it. */
export interface TurnAsk {
  id: string;
  attempt: number;
  leaseMs: number;
  loaded?: string;
  /** the box writes the outcome; an old box leaves this out and Lambda finishes as before */
  defer?: true;
}

/** Lambda → box. `finish` is left out when Lambda wrote the outcome itself. */
export interface TurnReply {
  status: string;
  finish?: string;
}

/** Under Lambda's 6 MB sync invoke cap, both ways. */
export const WIRE_MAX = 5_000_000;

export type { Invocation, Loaded };

/**
 * A desk call that runs longer than an HTTP request may wait (a posts pass reads and drafts for
 * minutes): sent once under an idempotency key, then its output asked for every few seconds
 * until it is there. Restate keeps an idempotent call's result, so a dropped poll loses nothing.
 */
import { randomUUID } from "node:crypto";

export interface PollOptions {
  /** The ingress: `ingressOf(settings)`. */
  url: string;
  headers?: Record<string, string>;
  /** Between asks. */
  everyMs?: number;
  /** Give up after this long; the call itself keeps running. */
  maxMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** A line now and then while it runs. */
  log?: (line: string) => void;
}

/** Restate's answer for an invocation that hasn't finished yet. */
const NOT_READY = 470;

/** The key a long call is sent under: one per run of the CLI. */
export const longCallKey = (what: string) => `cli:${what}:${randomUUID()}`;

/** Ask for one invocation's output until it is there; its error is thrown as the CLI's. */
export async function pollOutput<T>(invocationId: string, o: PollOptions): Promise<T> {
  const get = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const every = o.everyMs ?? 5_000;
  const max = o.maxMs ?? 30 * 60_000;
  const url = `${o.url.replace(/\/$/, "")}/restate/invocation/${encodeURIComponent(invocationId)}/output`;
  for (let waited = 0; ; waited += every) {
    const res = await get(url, { method: "GET", headers: { ...(o.headers ?? {}) } });
    if (res.status === NOT_READY) {
      await res.text().catch(() => "");
      if (waited >= max)
        throw new Error(
          `still running after ${Math.round(waited / 1000)} s: ${invocationId} (it keeps going)`,
        );
      if (waited > 0 && waited % 60_000 < every)
        o.log?.(`running ${Math.round(waited / 1000)} s: ${invocationId}`);
      await sleep(every);
      continue;
    }
    const body = await res.text();
    if (!res.ok) throw new Error(`${invocationId} failed (${res.status}): ${body.slice(0, 500)}`);
    return (body ? JSON.parse(body) : null) as T;
  }
}

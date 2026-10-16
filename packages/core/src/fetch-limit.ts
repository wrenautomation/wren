/**
 * Time limits on outbound HTTP (designs/2026-10-16-loop-watchdog.md). A fetch with no limit that
 * never answers holds its step until Lambda cuts it at 900 s, and Restate then retries the step
 * until it pauses the loop. Every client a loop uses goes through one of these, sized to its call.
 */

/** A signal that aborts after `ms`, or sooner when `signal` (the caller's own) does. */
export function limitSignal(ms: number, signal?: AbortSignal | null): AbortSignal {
  const limit = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, limit]) : limit;
}

type Fetchy<I> = (input: I, init?: RequestInit) => Promise<Response>;

/**
 * `fetchImpl` with every request cut at `ms` (the body read too). A caller's own signal still
 * aborts it. An aborted request rejects with a `TimeoutError` (or the caller's reason).
 */
export function timedFetch<I = string | URL | Request>(
  ms: number,
  fetchImpl: Fetchy<I> = (input, init) => fetch(input as string | URL | Request, init),
): Fetchy<I> {
  return (input, init) => fetchImpl(input, { ...init, signal: limitSignal(ms, init?.signal) });
}

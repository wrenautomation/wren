/**
 * `POST /api/pulse`: the app's reads that fall due together (the sidebar's counts, the bell, a
 * badge) as one request. Each call runs as if sent alone, with the same sign-in, so every guard
 * still answers for itself. Reads only: a write has no business in a batch. Free-plan Workers
 * count requests in, not the calls inside one.
 */
export const PULSE_PATH = "/api/pulse";
export const PULSE_MAX = 8;

export type PulseCall = { path: string; body: Record<string, unknown> };
export type PulseAnswer = { status: number; body: unknown };

/** The calls a pulse body names, or null when it is malformed or too long. */
export function pulseCalls(input: unknown): PulseCall[] | null {
  const calls = (input as { calls?: unknown } | null)?.calls;
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > PULSE_MAX) return null;
  const out: PulseCall[] = [];
  for (const c of calls) {
    const { path, body } = (c ?? {}) as { path?: unknown; body?: unknown };
    if (typeof path !== "string" || !/^[A-Za-z][A-Za-z0-9]*\/[A-Za-z][A-Za-z0-9]*$/.test(path))
      return null;
    if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body)))
      return null;
    out.push({ path, body: (body ?? {}) as Record<string, unknown> });
  }
  return out;
}

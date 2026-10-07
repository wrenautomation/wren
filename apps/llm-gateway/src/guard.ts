/**
 * Who may call and how much. Each caller has its own bearer token (the Worker's secret
 * holds only sha256 hashes) and three limits:
 * - a faucet: a bucket of `rpm` requests that refills at rpm/60 a second, so a burst up to
 *   `rpm`, then a steady drip;
 * - requests per UTC day;
 * - paid tokens per UTC day: Cohere bills credits, so a paid request reserves its prompt
 *   plus its max completion up front and settles on what the reply says it used.
 * The same three apply to all callers together. Over any of them: 429 with Retry-After and
 * x-ratelimit-* headers saying what is left.
 */

export interface Limits {
  rpm: number;
  rpd: number;
  paidTokensPerDay: number;
}

export interface CallerLimits extends Limits {
  /** May `POST /reset`. */
  admin?: boolean;
}

export const CALLERS: Record<string, CallerLimits> = {
  // The Lambda and the box worker (WREN_LLM=gateway).
  prod: { rpm: 300, rpd: 50_000, paidTokensPerDay: 250_000 },
  // William's machine (WREN_LLM_GATEWAY_TOKEN in llm.env): bulk tests run here.
  william: { rpm: 120, rpd: 20_000, paidTokensPerDay: 1_000_000, admin: true },
};

/** Everyone together. 1M paid tokens is at most about $10 of Command A a day. */
export const ALL: Limits = { rpm: 600, rpd: 100_000, paidTokensPerDay: 1_000_000 };

/** A larger `max_tokens` is cut to this; it is also the paid reservation when none is set. */
export const MAX_COMPLETION_TOKENS = 8192;
export const MAX_BODY_BYTES = 1_000_000;

interface Faucet {
  level: number;
  at: number;
}

interface Day {
  day: string;
  requests: number;
  paidTokens: number;
}

export type GuardSaved =
  | { kind: "faucet"; id: string; faucet: Faucet }
  | { kind: "day"; id: string; d: Day };

/** Storage ids the guard owns; `/reset` keeps them, so a reset never refills a cap. */
export const GUARD_PREFIX = "g:";

export type Admission =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: string; retryAfter: number; headers: Record<string, string> };

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const toMidnight = (now: number) => Math.ceil((86_400_000 - (now % 86_400_000)) / 1000);

export class Guard {
  private readonly faucets = new Map<string, Faucet>();
  private readonly days = new Map<string, Day>();

  constructor(private readonly save: (s: GuardSaved) => void = () => {}) {}

  load(s: GuardSaved): void {
    if (s.kind === "faucet") this.faucets.set(s.id, s.faucet);
    else this.days.set(s.id, s.d);
  }

  /** Charge one request (and `paidReserve` tokens) to the caller and to everyone, or refuse. */
  admit(caller: string, now: number, paidReserve = 0): Admission {
    const lim = CALLERS[caller];
    if (!lim) return { ok: false, reason: `unknown caller ${caller}`, retryAfter: 0, headers: {} };
    const scopes: [string, string, Limits][] = [
      [`${GUARD_PREFIX}caller:${caller}`, caller, lim],
      [`${GUARD_PREFIX}all`, "all callers", ALL],
    ];
    const state = scopes.map(([id, who, l]) => ({
      id,
      who,
      l,
      f: this.faucet(id, l, now),
      d: this.day(id, now),
    }));
    const own = state[0] as (typeof state)[number];
    for (const { who, l, f, d } of state) {
      if (f.level < 1) {
        const retryAfter = Math.ceil((1 - f.level) / (l.rpm / 60));
        return refuse(`${who}: over ${l.rpm} requests a minute`, retryAfter, lim, own);
      }
      if (d.requests >= l.rpd)
        return refuse(`${who}: over ${l.rpd} requests today (UTC)`, toMidnight(now), lim, own);
      if (paidReserve > 0 && d.paidTokens + paidReserve > l.paidTokensPerDay)
        return refuse(
          `${who}: paid tokens today would pass ${l.paidTokensPerDay} (this request reserves ${paidReserve})`,
          toMidnight(now),
          lim,
          own,
        );
    }
    for (const { id, f, d } of state) {
      f.level -= 1;
      d.requests += 1;
      d.paidTokens += paidReserve;
      this.save({ kind: "faucet", id, faucet: f });
      this.save({ kind: "day", id, d });
    }
    return { ok: true, headers: remaining(lim, own) };
  }

  /** The reply's real paid tokens are `delta` off the reservation (negative = refund). */
  settle(caller: string, now: number, delta: number): void {
    if (!delta) return;
    for (const id of [`${GUARD_PREFIX}caller:${caller}`, `${GUARD_PREFIX}all`]) {
      const d = this.day(id, now);
      d.paidTokens = Math.max(0, d.paidTokens + delta);
      this.save({ kind: "day", id, d });
    }
  }

  usage(now: number) {
    const row = (id: string, l: Limits) => {
      const d = this.day(id, now);
      return { requestsToday: d.requests, paidTokensToday: d.paidTokens, limits: l };
    };
    return {
      day: utcDay(now),
      all: row(`${GUARD_PREFIX}all`, ALL),
      callers: Object.fromEntries(
        Object.entries(CALLERS).map(([name, l]) => [name, row(`${GUARD_PREFIX}caller:${name}`, l)]),
      ),
    };
  }

  private faucet(id: string, l: Limits, now: number): Faucet {
    const f = this.faucets.get(id) ?? { level: l.rpm, at: now };
    f.level = Math.min(l.rpm, f.level + ((now - f.at) / 60_000) * l.rpm);
    f.at = now;
    this.faucets.set(id, f);
    return f;
  }

  private day(id: string, now: number): Day {
    const day = utcDay(now);
    let d = this.days.get(id);
    if (!d || d.day !== day) {
      d = { day, requests: 0, paidTokens: 0 };
      this.days.set(id, d);
    }
    return d;
  }
}

function remaining(lim: Limits, own: { f: Faucet; d: Day }): Record<string, string> {
  return {
    "x-ratelimit-limit-requests": String(lim.rpm),
    "x-ratelimit-remaining-requests": String(Math.max(0, Math.floor(own.f.level))),
    "x-ratelimit-remaining-requests-day": String(Math.max(0, lim.rpd - own.d.requests)),
    "x-ratelimit-remaining-paid-tokens-day": String(
      Math.max(0, lim.paidTokensPerDay - own.d.paidTokens),
    ),
  };
}

function refuse(
  reason: string,
  retryAfter: number,
  lim: Limits,
  own: { f: Faucet; d: Day },
): Admission {
  return {
    ok: false,
    reason,
    retryAfter,
    headers: { ...remaining(lim, own), "retry-after": String(retryAfter) },
  };
}

/** The caller a bearer token belongs to. `callers` is the secret: "name sha256hex" lines. */
export async function callerOf(
  authorization: string | null,
  callers: string,
): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/.exec(authorization ?? "");
  if (!m?.[1]) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1]));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  for (const line of callers.split("\n")) {
    const [name, hash] = line.trim().split(/\s+/);
    if (name && hash === hex && name in CALLERS) return name;
  }
  return null;
}

/**
 * The body as sent upstream, or why it is refused: one choice only, `max_tokens` cut to
 * MAX_COMPLETION_TOKENS. Also the paid reservation: prompt bytes / 4 plus the max completion.
 */
export function sanitize(
  body: Record<string, unknown>,
  bytes: number,
): { body: Record<string, unknown>; reserve: number } | { error: string } {
  if (body.n !== undefined && body.n !== 1) return { error: "n must be 1" };
  if (!Array.isArray(body.messages) || !body.messages.length)
    return { error: "messages must be a non-empty array" };
  const out = { ...body };
  let max = MAX_COMPLETION_TOKENS;
  for (const k of ["max_tokens", "max_completion_tokens"] as const) {
    const v = out[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || v < 1) return { error: `${k} must be a positive number` };
    out[k] = Math.min(v, MAX_COMPLETION_TOKENS);
    max = out[k] as number;
  }
  return { body: out, reserve: Math.ceil(bytes / 4) + max };
}

/**
 * Per key and model: requests this minute and this day, a cooldown after a 429, and keys
 * that failed auth. Pure over a `save` hook so the Durable Object persists it and tests
 * run in memory. Keys are numbered by their line in the secret; the key text never
 * enters the ledger.
 *
 * Routing ideas from freellmapi (MIT, Copyright (c) 2026 Tashfeen Ahmed): a request ledger
 * per key, cooldown on 429 backing off 2 → 4 → 8 → 15 minutes, and the next key, then the
 * next model, before giving up. Keys are tried round-robin, not by bandit score: every
 * key here is the same free tier.
 */
import { dayKey, limitsFor, type Provider, type Target } from "./catalog.js";

/**
 * `model`: the model itself is the trouble (a shared upstream pool is full, or it timed
 * out), not this key: the model is skipped for MODEL_COOL_MS.
 */
export type Outcome = "ok" | "rate" | "daily" | "auth" | "server" | "model";

export interface Slot {
  /** `floor(now / 60s)` of the minute counted in `minuteCount`. */
  minute: number;
  minuteCount: number;
  day: string;
  dayCount: number;
  coolUntil: number;
  backoff: number;
  ok: number;
  fail: number;
  /** The last failure: status and the start of the provider's message. */
  last?: string;
}

const BACKOFF_MIN = [2, 4, 8, 15];
const SERVER_COOL_MS = 30_000;
const AUTH_DEAD_MS = 24 * 60 * 60_000;
export const MODEL_COOL_MS = 10 * 60_000;

export type Saved =
  | { kind: "slot"; id: string; slot: Slot }
  | { kind: "dead"; id: string; until: number }
  | { kind: "cursor"; id: string; at: number }
  | { kind: "model"; id: string; until: number };

export class Ledger {
  readonly slots = new Map<string, Slot>();
  /** Key → epoch ms until which it is skipped on every model (failed auth). */
  readonly dead = new Map<string, number>();
  private readonly cursors = new Map<string, number>();
  /** "provider|model" → epoch ms until which the model is skipped (slow or overloaded). */
  readonly modelCool = new Map<string, number>();

  constructor(private readonly save: (s: Saved) => void = () => {}) {}

  load(s: Saved): void {
    if (s.kind === "slot") this.slots.set(s.id, s.slot);
    else if (s.kind === "dead") this.dead.set(s.id, s.until);
    else if (s.kind === "model") this.modelCool.set(s.id.slice("model:".length), s.until);
    else this.cursors.set(s.id, s.at);
  }

  /**
   * The next key for this model with room left, counted as used; null when every key is
   * spent, cooling or dead.
   */
  acquire(t: Target, keyCount: number, now: number): number | null {
    const lim = limitsFor(t);
    const minute = Math.floor(now / 60_000);
    const day = dayKey(t.provider, now);
    const cursorId = `${t.provider}|${t.model}`;
    if ((this.modelCool.get(cursorId) ?? 0) > now) return null;
    const start = this.cursors.get(cursorId) ?? 0;
    for (let i = 0; i < keyCount; i++) {
      const idx = (start + i) % keyCount;
      if ((this.dead.get(keyId(t.provider, idx)) ?? 0) > now) continue;
      const s = this.slot(t, idx);
      if (s.coolUntil > now) continue;
      if (s.minute !== minute) Object.assign(s, { minute, minuteCount: 0 });
      if (s.day !== day) Object.assign(s, { day, dayCount: 0 });
      if (s.minuteCount >= lim.rpm || s.dayCount >= lim.rpd) continue;
      s.minuteCount++;
      s.dayCount++;
      this.put(t, idx, s);
      this.cursors.set(cursorId, (idx + 1) % keyCount);
      this.save({ kind: "cursor", id: cursorId, at: (idx + 1) % keyCount });
      return idx;
    }
    return null;
  }

  report(t: Target, idx: number, outcome: Outcome, now: number, detail?: string): void {
    if (outcome === "model") {
      const id = `${t.provider}|${t.model}`;
      this.modelCool.set(id, now + MODEL_COOL_MS);
      this.save({ kind: "model", id: `model:${id}`, until: now + MODEL_COOL_MS });
    }
    if (outcome === "auth") {
      const until = now + AUTH_DEAD_MS;
      this.dead.set(keyId(t.provider, idx), until);
      this.save({ kind: "dead", id: keyId(t.provider, idx), until });
    }
    const s = this.slot(t, idx);
    if (detail) s.last = detail;
    if (outcome === "model") s.fail++;
    else if (outcome === "ok") {
      s.ok++;
      s.backoff = 0;
    } else {
      s.fail++;
      if (outcome === "rate") {
        s.backoff = Math.min(s.backoff + 1, BACKOFF_MIN.length);
        s.coolUntil = now + (BACKOFF_MIN[s.backoff - 1] as number) * 60_000;
      } else if (outcome === "daily") {
        // Spent for the provider's day: the count says so until the day turns.
        s.day = dayKey(t.provider, now);
        s.dayCount = Number.MAX_SAFE_INTEGER;
      } else if (outcome === "server") {
        s.coolUntil = now + SERVER_COOL_MS;
      }
    }
    this.put(t, idx, s);
  }

  /** Per model: keys usable now, requests today, keys cooling, keys spent for the day. */
  usage(targets: Target[], keyCounts: Record<Provider, number>, now: number) {
    return targets.map((t) => {
      const lim = limitsFor(t);
      const day = dayKey(t.provider, now);
      let ready = 0;
      let today = 0;
      let cooling = 0;
      let spent = 0;
      let dead = 0;
      const errors = new Set<string>();
      for (let idx = 0; idx < keyCounts[t.provider]; idx++) {
        const s = this.slots.get(slotId(t, idx));
        const dayCount = s && s.day === day ? s.dayCount : 0;
        if (dayCount < Number.MAX_SAFE_INTEGER) today += dayCount;
        if (s?.last && errors.size < 3) errors.add(s.last);
        if ((this.dead.get(keyId(t.provider, idx)) ?? 0) > now) dead++;
        else if (s && s.coolUntil > now) cooling++;
        else if (dayCount >= lim.rpd) spent++;
        else ready++;
      }
      const modelCool = (this.modelCool.get(`${t.provider}|${t.model}`) ?? 0) - now;
      return {
        model: `${t.provider}/${t.model}`,
        skippedForSec: modelCool > 0 ? Math.ceil(modelCool / 1000) : 0,
        keys: keyCounts[t.provider],
        ready,
        cooling,
        spent,
        dead,
        today,
        limits: lim,
        errors: [...errors],
      };
    });
  }

  private slot(t: Target, idx: number): Slot {
    return (
      this.slots.get(slotId(t, idx)) ?? {
        minute: 0,
        minuteCount: 0,
        day: "",
        dayCount: 0,
        coolUntil: 0,
        backoff: 0,
        ok: 0,
        fail: 0,
      }
    );
  }

  private put(t: Target, idx: number, s: Slot): void {
    this.slots.set(slotId(t, idx), s);
    this.save({ kind: "slot", id: slotId(t, idx), slot: s });
  }
}

const keyId = (p: Provider, idx: number) => `${p}#${idx}`;
const slotId = (t: Target, idx: number) => `${t.provider}#${idx}|${t.model}`;

/** What an upstream failure means for the key that sent it; null = the request's fault. */
export function classify(status: number, body: string): Outcome | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 400 && /api key (not valid|invalid|expired)|API_KEY_INVALID/i.test(body))
    return "auth";
  if (status === 429) {
    if (/upstream|shared.?pool/i.test(body)) return "model";
    return /per.?day|daily|RequestsPerDay/i.test(body) ? "daily" : "rate";
  }
  if (status >= 500) return "server";
  return null;
}

/** A failure, short and with anything shaped like a key cut out, for `/usage`. */
export function describe(status: number, body: string): string {
  let msg = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: string } } };
    msg = j.error?.metadata?.raw ?? j.error?.message ?? body;
  } catch {}
  const clean = msg
    .replace(/(AIza|sk-or-v1-|sk-)[\w-]{8,}/g, "[key]")
    .replace(/\s+/g, " ")
    .trim();
  return `${status} ${clean.slice(0, 160)}`;
}

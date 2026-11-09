/**
 * Live topics, writer side (designs/2026-11-08-live-topics.md): after a commit, a signed POST to the
 * portal Worker's `/api/live/changed`; its `LiveRoom` tells open tabs, which read again. A hint, never data.
 */

export const LIVE_HOOK_PATH = "/api/live/changed";
/** ms since epoch; refused more than `LIVE_SKEW_MS` off */
export const LIVE_TS_HEADER = "x-wren-ts";
/** hex HMAC-SHA256 of `<ts>.<body>` */
export const LIVE_SIG_HEADER = "x-wren-sig";
const LIVE_SKEW_MS = 5 * 60_000;
const LIVE_TOPIC = /^[a-z0-9:_-]{1,64}$/;
const LIVE_TOPICS_MAX = 20;
const DEFAULT_URL = `https://app.wrenautomation.com${LIVE_HOOK_PATH}`;
const TIMEOUT_MS = 2000;

export interface LiveChange {
  topics: string[];
  /** a client's data: its room hears too; room `app` always hears */
  client?: string;
}

/** valid topics, deduped, capped */
export function liveTopics(topics: readonly unknown[]): string[] {
  const ok = topics.filter((t): t is string => typeof t === "string" && LIVE_TOPIC.test(t));
  return [...new Set(ok)].slice(0, LIVE_TOPICS_MAX);
}

/** hex HMAC-SHA256 of `<ts>.<body>` (WebCrypto: Node, Workers) */
export async function liveSignature(secret: string, ts: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The receiver's check: ts within `LIVE_SKEW_MS`, sig a valid HMAC (constant time, via `verify`). */
export async function liveVerify(
  secret: string,
  ts: string,
  body: string,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  const at = Number(ts);
  if (!/^\d{1,16}$/.test(ts) || Math.abs(now - at) > LIVE_SKEW_MS) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const mac = new Uint8Array((sig.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", key, mac, enc.encode(`${ts}.${body}`));
}

/**
 * Tell open tabs these topics changed. Never throws; 2 s cap; no `WREN_LIVE_SECRET` = no-op.
 * Call after commit, never inside the transaction.
 */
export async function tellLive(
  topics: readonly string[],
  o: { client?: string | null; vars?: Record<string, string | undefined> } = {},
): Promise<boolean> {
  const vars = o.vars ?? process.env;
  const secret = vars.WREN_LIVE_SECRET;
  const ok = liveTopics(topics);
  if (!secret || !ok.length) return false;
  const change: LiveChange = { topics: ok, ...(o.client ? { client: o.client } : {}) };
  const body = JSON.stringify(change);
  const ts = String(Date.now());
  try {
    const res = await fetch(vars.WREN_LIVE_URL || DEFAULT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LIVE_TS_HEADER]: ts,
        [LIVE_SIG_HEADER]: await liveSignature(secret, ts, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // tabs read again on focus and reconnect
    return false;
  }
}

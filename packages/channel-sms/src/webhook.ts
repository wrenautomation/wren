/**
 * Telnyx webhook signatures, WebCrypto only, so the same file runs in the
 * Cloudflare Worker that receives webhooks and in Node tests. Telnyx signs
 * `${timestamp}|${rawBody}` with Ed25519; the public key is on the portal
 * (Account → Public Key), base64. A request older than five minutes is
 * refused, so a captured one cannot be replayed later.
 */

export const SIGNATURE_HEADER = "telnyx-signature-ed25519";
export const TIMESTAMP_HEADER = "telnyx-timestamp";
const TOLERANCE_SECONDS = 300;

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * The checks that need no key: both headers there and the time within five minutes. Run first,
 * so an unsigned or stale request costs no lookup of whose key to check it with.
 */
export function signedFresh(input: {
  signature: string | null;
  timestamp: string | null;
  nowSeconds?: number;
}): Verdict {
  if (!input.signature || !input.timestamp)
    return { ok: false, reason: "missing signature headers" };
  const ts = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside five minutes" };
  }
  return { ok: true };
}

/**
 * Our number on a Telnyx event, unverified: the one a text or call came to, or a sent text
 * came from. It only picks whose key checks the signature. Null when the event names none
 * (10DLC's) or the body isn't one.
 */
export function ourNumber(body: unknown): string | null {
  const data = (body as { data?: { event_type?: unknown; payload?: unknown } } | null)?.data;
  const type = typeof data?.event_type === "string" ? data.event_type : "";
  const p = (data?.payload ?? {}) as {
    from?: unknown;
    to?: unknown;
    direction?: unknown;
  };
  const phone = (v: unknown) => {
    const n = typeof v === "string" ? v : (v as { phone_number?: unknown } | null)?.phone_number;
    return typeof n === "string" && /^\+\d{6,15}$/.test(n) ? n : null;
  };
  if (type === "message.received") return phone(Array.isArray(p.to) ? p.to[0] : p.to);
  if (type.startsWith("message.")) return phone(p.from);
  if (type.startsWith("call.")) return phone(p.direction === "outgoing" ? p.from : p.to);
  return null;
}

export async function verifyTelnyx(input: {
  publicKey: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowSeconds?: number;
}): Promise<Verdict> {
  const fresh = signedFresh(input);
  if (!fresh.ok) return fresh;
  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      fromBase64(input.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      fromBase64(input.signature ?? ""),
      new TextEncoder().encode(`${input.timestamp}|${input.rawBody}`),
    );
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "bad signature" };
}

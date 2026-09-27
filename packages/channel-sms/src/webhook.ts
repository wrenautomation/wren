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

export async function verifyTelnyx(input: {
  publicKey: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowSeconds?: number;
}): Promise<Verdict> {
  if (!input.signature || !input.timestamp)
    return { ok: false, reason: "missing signature headers" };
  const ts = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside five minutes" };
  }
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
      fromBase64(input.signature),
      new TextEncoder().encode(`${input.timestamp}|${input.rawBody}`),
    );
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "bad signature" };
}

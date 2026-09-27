import type { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelnyx } from "./webhook.js";

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as Uint8Array).toString("base64");

async function signer() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (ts: string, body: string) =>
    b64(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        pair.privateKey,
        new TextEncoder().encode(`${ts}|${body}`),
      ),
    );
  return { publicKey, sign };
}

describe("verifyTelnyx", () => {
  const body = '{"data":{"id":"e1"}}';
  it("accepts a fresh, correctly signed body", async () => {
    const { publicKey, sign } = await signer();
    const signature = await sign("1000", body);
    expect(
      await verifyTelnyx({
        publicKey,
        signature,
        timestamp: "1000",
        rawBody: body,
        nowSeconds: 1010,
      }),
    ).toEqual({ ok: true });
  });
  it("refuses a changed body, a stale timestamp, missing headers, a junk key", async () => {
    const { publicKey, sign } = await signer();
    const signature = await sign("1000", body);
    const base = { publicKey, signature, timestamp: "1000", rawBody: body, nowSeconds: 1010 };
    expect((await verifyTelnyx({ ...base, rawBody: `${body} ` })).ok).toBe(false);
    expect((await verifyTelnyx({ ...base, nowSeconds: 2000 })).ok).toBe(false);
    expect((await verifyTelnyx({ ...base, signature: null })).ok).toBe(false);
    expect((await verifyTelnyx({ ...base, publicKey: "AAAA" })).ok).toBe(false);
  });
});

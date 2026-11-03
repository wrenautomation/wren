import { createHmac, type webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhook, verifyTelnyx } from "./webhook.js";

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

describe("verifyStandardWebhook", () => {
  const secret = `whsec_${Buffer.from("synthetic-secret-32-bytes-long!!").toString("base64")}`;
  const sign = (id: string, ts: string, body: string) =>
    `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`${id}.${ts}.${body}`)
      .digest("base64")}`;
  const body = '{"event_type":"message.received","event_id":"e1"}';
  const base = { secret, id: "msg_1", timestamp: "1000", rawBody: body, nowSeconds: 1010 };

  it("accepts any one matching v1 entry", async () => {
    const good = sign("msg_1", "1000", body);
    expect(await verifyStandardWebhook({ ...base, signature: good })).toEqual({ ok: true });
    expect(await verifyStandardWebhook({ ...base, signature: `v1,AAAA ${good}` })).toEqual({
      ok: true,
    });
  });

  it("refuses a changed body, another id, a stale time, no id", async () => {
    const good = sign("msg_1", "1000", body);
    const no = (v: { ok: boolean }) => expect(v.ok).toBe(false);
    no(await verifyStandardWebhook({ ...base, signature: good, rawBody: `${body} ` }));
    no(await verifyStandardWebhook({ ...base, signature: good, id: "msg_2" }));
    no(await verifyStandardWebhook({ ...base, signature: good, nowSeconds: 2000 }));
    no(await verifyStandardWebhook({ ...base, signature: good, id: null }));
    no(await verifyStandardWebhook({ ...base, signature: "v2,abc" }));
  });
});

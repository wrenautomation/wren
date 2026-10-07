/**
 * `/api/dictate` with a fake speech server: off unless set up, never on the demo, signed-in
 * only, a WAV in and `{text}` out.
 */
import { forgetKeys } from "@wren/auth/verify";
import { wavOf } from "@wren/voice/dictation";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WAV } from "../src/dictate.js";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const AUTH = "https://auth.test";
let keys: CryptoKeyPair;
let heard: { url: string; auth: string | null; model: unknown; file: unknown }[];

const enc = (v: unknown) =>
  btoa(typeof v === "string" ? v : JSON.stringify(v))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function token() {
  const head = enc({ alg: "EdDSA", kid: "k1", typ: "JWT" });
  const body = enc({
    aud: ["wren"],
    iss: AUTH,
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "owner@client.example",
  });
  const sig = await crypto.subtle.sign(
    "Ed25519",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return `${head}.${body}.${enc(bin)}`;
}

const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  AUTH_ORIGIN: AUTH,
  DICTATE_URL: "https://speech.test/v1/audio/transcriptions",
  DICTATE_MODEL: "whisper-test",
  DICTATE_KEY: "sk-test",
  ...over,
});

/** No speech server set up. */
const unset = (): Env => {
  const e = env();
  delete e.DICTATE_URL;
  return e;
};

const wav = () => wavOf(new Float32Array(16_000).fill(0.1));
const send = (host: string, body: BodyInit, headers: HeadersInit = {}) =>
  new Request(`https://${host}/api/dictate`, {
    method: "POST",
    headers: { "content-type": "audio/wav", ...headers },
    body,
  });

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
});

beforeEach(() => {
  forgetKeys();
  heard = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${AUTH}/api/auth/jwks`) {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      return Response.json({ keys: [{ ...jwk, alg: "EdDSA", kid: "k1" }] });
    }
    const form = init?.body as FormData;
    heard.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      model: form.get("model"),
      file: (form.get("file") as Blob | null)?.type,
    });
    return Response.json({ text: " Reply to Dana. " });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("/api/dictate", () => {
  it("says on when a server is set, off when not, off on the demo", async () => {
    const on = await worker.fetch(new Request("https://app.test/api/dictate"), env());
    expect(await on.json()).toEqual({ on: true, model: "whisper-test" });
    const off = await worker.fetch(new Request("https://app.test/api/dictate"), unset());
    expect(await off.json()).toEqual({ on: false });
    const demo = await worker.fetch(new Request("https://demo.test/api/dictate"), env());
    expect(await demo.json()).toEqual({ on: false });
  });

  it("turns a signed-in WAV into words through the speech server", async () => {
    const res = await worker.fetch(
      send("app.test", wav(), { authorization: `Bearer ${await token()}` }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Reply to Dana." });
    expect(heard).toEqual([
      {
        url: "https://speech.test/v1/audio/transcriptions",
        auth: "Bearer sk-test",
        model: "whisper-test",
        file: "audio/wav",
      },
    ]);
  });

  it("refuses the demo, no sign-in, other types, too much and not a WAV", async () => {
    const signed = { authorization: `Bearer ${await token()}` };
    expect((await worker.fetch(send("demo.test", wav()), env())).status).toBe(403);
    expect((await worker.fetch(send("app.test", wav()), env())).status).toBe(401);
    const form = send("app.test", "a=1", { ...signed, "content-type": "text/plain" });
    expect((await worker.fetch(form, env())).status).toBe(415);
    const big = send("app.test", new Uint8Array(MAX_WAV + 1), signed);
    expect((await worker.fetch(big, env())).status).toBe(413);
    const junk = send("app.test", new Uint8Array(64), signed);
    expect((await worker.fetch(junk, env())).status).toBe(400);
    expect((await worker.fetch(send("app.test", wav(), signed), unset())).status).toBe(503);
    expect(heard).toEqual([]);
  });
});

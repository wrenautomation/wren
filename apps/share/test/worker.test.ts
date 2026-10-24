import { describe, expect, it } from "vitest";
import worker, { type Env, MAX_TRACE } from "../src/worker.js";

const ID = "0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b";

function fakeEnv(limitOk = true) {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, body: ArrayBuffer | Uint8Array) {
      store.set(key, new Uint8Array(body));
    },
    async get(key: string) {
      const b = store.get(key);
      return b ? { body: b } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(o: { prefix: string }) {
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(o.prefix))
        .map(([key, v]) => ({ key, size: v.length }));
      return { objects, truncated: false };
    },
  };
  const limit = { limit: async () => ({ success: limitOk }) };
  const env = {
    SHARE: bucket,
    INSTALL_LIMIT: limit,
    IP_LIMIT: limit,
    ADMIN_TOKEN: "t0ken",
  } as unknown as Env;
  return { env, store };
}

const zip = new Uint8Array([0x50, 0x4b, 3, 4, 9]);
const put = (env: Env, path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://share.test${path}`, {
      method: "PUT",
      body,
      headers: { "x-install": ID, ...headers },
    }),
    env,
  );

describe("share ingest", () => {
  it("takes a trace into the inbox under its day and install", async () => {
    const { env, store } = fakeEnv();
    const r = await put(env, "/v1/traces/2026-x.github.login.ok.zip", zip);
    expect(r.status).toBe(201);
    const [key] = [...store.keys()];
    expect(key).toMatch(
      new RegExp(`^inbox/\\d{4}-\\d{2}-\\d{2}/${ID}/traces/2026-x.github.login.ok.zip$`),
    );
  });

  it("refuses a bad install id, a bad name, a non-zip, bad JSON and an over-cap body", async () => {
    const { env, store } = fakeEnv();
    expect((await put(env, "/v1/traces/a.zip", zip, { "x-install": "me" })).status).toBe(400);
    expect((await put(env, "/v1/traces/..a.zip", zip)).status).toBe(400);
    expect((await put(env, "/v1/traces/a.json", zip)).status).toBe(400);
    expect((await put(env, "/v1/traces/a.zip", "hello")).status).toBe(415);
    expect((await put(env, "/v1/flows/a.flow.json", "{no")).status).toBe(415);
    expect((await put(env, "/v1/traces/a.zip", new Uint8Array(MAX_TRACE + 1))).status).toBe(413);
    expect(store.size).toBe(0);
  });

  it("answers 429 over the rate cap", async () => {
    const { env } = fakeEnv(false);
    expect((await put(env, "/v1/traces/a.zip", zip)).status).toBe(429);
  });

  it("admin: bearer only; writes kept/ but never inbox/", async () => {
    const { env, store } = fakeEnv();
    await put(env, "/v1/flows/a.flow.json", "{}");
    const call = (method: string, path: string, auth = "Bearer t0ken", body?: BodyInit) =>
      worker.fetch(
        new Request(`https://share.test/admin/${path}`, {
          method,
          headers: { authorization: auth },
          ...(body ? { body } : {}),
        }),
        env,
      );
    expect((await call("GET", "list", "Bearer nope")).status).toBe(401);
    const list = (await (await call("GET", "list")).json()) as { keys: { key: string }[] };
    expect(list.keys).toHaveLength(1);
    const key = list.keys[0]?.key ?? "";
    expect(await (await call("GET", `object/${encodeURIComponent(key)}`)).text()).toBe("{}");
    expect((await call("PUT", "object/inbox%2Fx", undefined, "z")).status).toBe(403);
    expect((await call("PUT", "object/kept%2Fx.zip", undefined, "z")).status).toBe(201);
    expect((await call("DELETE", `object/${encodeURIComponent(key)}`)).status).toBe(200);
    expect([...store.keys()]).toEqual(["kept/x.zip"]);
  });
});

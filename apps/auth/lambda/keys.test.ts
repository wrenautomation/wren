/** The key path refuses before the database: wrong path, method, body, no sealer, no viewer. */
import { keySealer, newKeyPair } from "@wren/core/keys";
import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import type { UrlEvent } from "./http.js";
import { keyIntake } from "./keys.js";

const VALUE = "sk_test_synthetic0000000000";
const event = (over: Partial<UrlEvent> = {}): UrlEvent => ({
  rawPath: "/api/keys/stage",
  headers: { "content-type": "application/json", "x-wren-viewer": "owner@client.example" },
  body: JSON.stringify({ client: "acme", name: "STRIPE_SECRET_KEY", value: VALUE }),
  requestContext: { http: { method: "POST" } },
  ...over,
});
/** Any query fails: these answers come before the database. */
const db = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("no database here");
    },
  },
) as Db;
const sealer = keySealer(newKeyPair("k1").publicSpec);

describe("keyIntake", () => {
  it("leaves other paths to sign-in", async () => {
    expect(await keyIntake(event({ rawPath: "/api/auth/session" }), db, sealer)).toBeNull();
  });

  it("refuses a GET, a bad body, no sealer and no viewer, never echoing the key", async () => {
    const cases: [UrlEvent, Parameters<typeof keyIntake>[2], number][] = [
      [event({ requestContext: { http: { method: "GET" } } }), sealer, 405],
      [event({ body: "{" }), sealer, 400],
      [event(), null, 503],
      [event({ headers: {} }), sealer, 401],
      [event({ body: JSON.stringify({ client: "Acme!", name: "X", value: VALUE }) }), sealer, 400],
    ];
    for (const [e, s, status] of cases) {
      const out = await keyIntake(e, db, s);
      expect(out?.statusCode).toBe(status);
      expect(out?.body).not.toContain(VALUE);
      expect(out?.headers["cache-control"]).toBe("no-store");
    }
  });

  it("a database error answers 500 without the key", async () => {
    const out = await keyIntake(event(), db, sealer);
    expect(out?.statusCode).toBe(500);
    expect(out?.body).not.toContain(VALUE);
  });
});

// The door's path rules (designs/2026-11-09-own-runtime.md, "Phase 3"): a handler named `send` is
// a handler, and `/send` after it is still Restate's one-way suffix. Found by the pg suite run.
import { startTestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as clients from "../../src/clients.js";
import * as sdk from "../../src/index.js";
import { startPgTestEnvironment } from "../../src/pg/index.js";

const sent: string[] = [];
const mail = sdk.service({
  name: "Mail",
  handlers: {
    send: async (_ctx: sdk.Context, to: string) => {
      sent.push(`svc:${to}`);
      return `sent ${to}`;
    },
  },
});
const box = sdk.object({
  name: "Box",
  handlers: {
    send: async (ctx: sdk.ObjectContext, to: string) => {
      sent.push(`${ctx.key}:${to}`);
      return `${ctx.key} sent ${to}`;
    },
  },
});

let base = "";
let stop = async () => {};
beforeAll(async () => {
  const pg = await startTestPostgres();
  const rt = await startPgTestEnvironment({ url: pg.url, services: [mail, box] });
  base = rt.baseUrl();
  stop = async () => {
    await rt.stop();
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((ok) => setTimeout(ok, 30));
  expect(f()).toBe(true);
};

describe("a handler named send", () => {
  it("is called on a service and on an object", async () => {
    const ingress = clients.connect({ url: base });
    expect(await ingress.serviceClient(mail).send("ada")).toBe("sent ada");
    expect(await ingress.objectClient(box, "k1").send("bo")).toBe("k1 sent bo");
  });

  it("takes Restate's /send suffix after it", async () => {
    expect((await post("/Mail/send/send", "cy")).status).toBe(202);
    expect((await post("/Box/k2/send/send", "di")).status).toBe(202);
    await until(() => sent.includes("svc:cy") && sent.includes("k2:di"));
  });

  it("a path too long or too short for the kind is a 404", async () => {
    expect((await post("/Mail/send/other", "x")).status).toBe(404);
    expect((await post("/Box/send", "x")).status).toBe(404);
  });
});

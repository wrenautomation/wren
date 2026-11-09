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

// a call whose child keeps failing: the output's 470 names the child's error
const leaf = sdk.service({
  name: "Leaf",
  handlers: {
    boom: async (_ctx: sdk.Context) => {
      throw new Error("leaf down: token=abc");
    },
  },
});
const top = sdk.service({
  name: "Top",
  handlers: {
    run: async (ctx: sdk.Context) => ctx.serviceClient(leaf).boom(),
  },
});

let base = "";
let stop = async () => {};
beforeAll(async () => {
  const pg = await startTestPostgres();
  const rt = await startPgTestEnvironment({ url: pg.url, services: [mail, box, leaf, top] });
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

describe("output while a call is tried again", () => {
  it("answers 470 with the deepest failing call's count and error", async () => {
    const r = await post("/Top/run/send", null);
    const { invocationId } = (await r.json()) as { invocationId: string };
    let body: { message?: string; retry?: { count: number; reason: string } } = {};
    for (let i = 0; i < 100 && !body.retry; i++) {
      const out = await fetch(`${base}/restate/invocation/${invocationId}/output`);
      expect(out.status).toBe(470);
      body = (await out.json()) as typeof body;
      if (!body.retry) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(body.message).toBe("not ready");
    expect(body.retry?.count).toBeGreaterThan(0);
    expect(body.retry?.reason).toContain("leaf down");
  }, 30_000);

  it("a call that is not failing has no retry", async () => {
    const r = await post("/Mail/send/send?delay=2s", "late");
    const { invocationId } = (await r.json()) as { invocationId: string };
    const out = await fetch(`${base}/restate/invocation/${invocationId}/output`);
    expect(out.status).toBe(470);
    expect(await out.json()).toEqual({ message: "not ready" });
  });
});

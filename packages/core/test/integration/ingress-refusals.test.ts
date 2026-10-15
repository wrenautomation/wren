/**
 * What the portal's Worker gets back from Restate's ingress: a refusal's status, words and field
 * (`answer`), and one run per idempotency key (the Worker's request id). A throwaway service, no
 * database.
 */
import * as restate from "@restatedev/restate-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answer } from "../../src/portal.js";
import { PortalRefusal, staleRefusal } from "../../src/refusal.js";
import { startTestRestate } from "../../src/testing.js";

let env: Awaited<ReturnType<typeof startTestRestate>>;
let runs = 0;
const probe = restate.service({
  name: "RefusalProbe",
  handlers: {
    act: async (ctx: restate.Context, _req: unknown) =>
      answer(async () => ({ runs: await ctx.run("count", () => ++runs) })),
    missing: async (_ctx: restate.Context, _req: unknown) =>
      answer(async () => {
        throw new PortalRefusal("Pick a subreddit first.", 422, "subreddit");
      }),
    stale: async (_ctx: restate.Context, _req: unknown) =>
      answer(async () => {
        throw staleRefusal("page");
      }),
  },
});

beforeAll(async () => {
  env = await startTestRestate({ services: [probe] });
});
afterAll(async () => {
  await env?.stop();
});

const post = (handler: string, key?: string) =>
  fetch(`${env.baseUrl()}/RefusalProbe/${handler}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: "{}",
  });

describe("through the ingress", () => {
  it("a refusal keeps its status, words and field", async () => {
    const res = await post("missing");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      message: "Pick a subreddit first.",
      metadata: { field: "subreddit" },
    });
  });

  it("a stale save is a 409 in plain words", async () => {
    const res = await post("stale");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string; metadata?: unknown };
    expect(body.message).toBe("This page changed since you opened it. Look again.");
    expect(body.metadata ?? {}).toEqual({});
  });

  it("the same idempotency key runs once and answers the same", async () => {
    const first = await (await post("act", "portal:test-once")).json();
    const again = await (await post("act", "portal:test-once")).json();
    const other = await (await post("act")).json();
    expect(again).toEqual(first);
    expect(other).toEqual({ runs: (first as { runs: number }).runs + 1 });
  });
});

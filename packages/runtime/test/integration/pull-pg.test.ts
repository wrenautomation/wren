// Pulled services (designs/2026-11-09-own-runtime.md, "Phase 5"): autobrowse's desk claims its
// calls over the door; its handlers are unknown until it registers.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, serveDoor } from "../../src/pg/index.js";

let sql: postgres.Sql;
let base = "";
let drain = () => {};
let stop = async () => {};
beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 6, onnotice: () => {} });
  await migrate(sql);
  const door = await serveDoor({
    sql,
    pull: { pulled: ["desk"], leaseMs: 2_000 },
  });
  base = door.url;
  drain = door.drain;
  stop = async () => {
    await door.close();
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const rt = async (op: string, body: unknown) => {
  const r = await post(`/rt/${op}`, body);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
type Call = {
  id: string;
  attempt: number;
  service: string;
  handler: string;
  input: string;
  headers: Record<string, string>;
  cancel: boolean;
};
const take = async (waitMs = 3_000) =>
  (await rt("claim", { services: ["desk"], waitMs })).body.calls as Call[];
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

describe("pulled services", () => {
  it("before the desk registers, its calls are unknown", async () => {
    expect((await post("/desk/status/send", { site: "x" })).status).toBe(404);
    expect(await sql`SELECT 1 FROM rt.invocations WHERE service = 'desk'`).toHaveLength(0);
  });

  it("register takes only pulled names", async () => {
    const no = await rt("register", { services: [{ name: "Other", handlers: [{ name: "h" }] }] });
    expect(no.status).toBe(403);
    const ok = await rt("register", {
      services: [{ name: "desk", handlers: [{ name: "status" }, { name: "call" }] }],
    });
    expect(ok).toEqual({ status: 200, body: { handlers: 2 } });
    expect(
      await sql`SELECT handler FROM rt.handlers WHERE service = 'desk' ORDER BY handler`,
    ).toEqual([{ handler: "call" }, { handler: "status" }]);
    expect((await rt("claim", { services: ["Other"] })).body.calls).toEqual([]);
  });

  it("a waiting claim gets a call sent after it; input and headers come as sent", async () => {
    await new Promise((r) => setTimeout(r, 5_100)); // the door's handler cache
    const waiting = take(10_000);
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    expect(
      (await post("/desk/status/send", { site: "linkedin" }, { "x-caller": "wren:test" })).status,
    ).toBe(202);
    const [c] = await waiting;
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(c).toMatchObject({ service: "desk", handler: "status", attempt: 1, cancel: false });
    expect(JSON.parse(Buffer.from((c as Call).input, "base64").toString())).toEqual({
      site: "linkedin",
    });
    expect((c as Call).headers["x-caller"]).toBe("wren:test");
    expect((await rt("finish", { id: c?.id, attempt: 1, value: b64("ok") })).status).toBe(200);
  });

  it("a sync call gets the value the desk finishes with", async () => {
    const call = post("/desk/status", { site: "x" });
    const [c] = await take();
    await rt("finish", { id: c?.id, attempt: c?.attempt, value: b64({ up: true }) });
    const r = await call;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ up: true });
  });

  it("a terminal error ends the call with its code; a stale finish is refused", async () => {
    const call = post("/desk/call", { site: "x" });
    const [c] = await take();
    const error = { message: "no such site", code: 400 };
    expect((await rt("finish", { id: c?.id, attempt: 9, error, terminal: true })).status).toBe(409);
    await rt("finish", { id: c?.id, attempt: c?.attempt, error, terminal: true });
    const r = await call;
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toBe("no such site");
    expect((await rt("finish", { id: c?.id, attempt: c?.attempt, value: b64(1) })).status).toBe(
      409,
    );
  });

  it("a failure retries on the desk's policy, then pauses", async () => {
    await post("/desk/call/send", { site: "y" });
    const retry = { initialInterval: 50, maxAttempts: 2 };
    const [a] = await take();
    await rt("finish", { id: a?.id, attempt: a?.attempt, error: { message: "flaky" }, retry });
    const [b] = await take();
    expect(b?.id).toBe(a?.id);
    expect(b?.attempt).toBe(2);
    await rt("finish", { id: b?.id, attempt: 2, error: { message: "flaky" }, retry });
    expect(
      await sql`SELECT status, failures FROM rt.invocations WHERE id = ${a?.id as string}`,
    ).toEqual([{ status: "paused", failures: 2 }]);
  });

  it("renew keeps the lease and passes a cancel; a lapsed lease is claimed again", async () => {
    await post("/desk/call/send", { site: "z" });
    const [c] = await take();
    expect((await rt("renew", { id: c?.id, attempt: c?.attempt })).body).toEqual({
      cancel: false,
    });
    await sql`UPDATE rt.invocations SET cancel = true WHERE id = ${c?.id as string}`;
    expect((await rt("renew", { id: c?.id, attempt: c?.attempt })).body).toEqual({
      cancel: true,
    });
    await new Promise((r) => setTimeout(r, 2_200)); // lease 2 s, no renew
    const [again] = await take();
    expect(again).toMatchObject({ id: c?.id, attempt: 2, cancel: true });
    expect((await rt("renew", { id: c?.id, attempt: 1 })).status).toBe(409);
    await rt("finish", {
      id: c?.id,
      attempt: 2,
      error: { message: "cancelled", code: 409 },
      terminal: true,
    });
  });

  it("a drained door fails its health check and still serves calls", async () => {
    const health = () => fetch(`${base}/restate/health`).then((r) => r.status);
    expect(await health()).toBe(200);
    drain();
    expect(await health()).toBe(503);
    expect((await rt("claim", { services: ["desk"] })).status).toBe(200);
  });
});

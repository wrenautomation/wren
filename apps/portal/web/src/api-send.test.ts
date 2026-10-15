/** How a call leaves: a refused token retried once with the same body, and a closing tab's call kept alive. */
import { afterEach, describe, expect, it, vi } from "vitest";

const assign = vi.fn();
Object.assign(globalThis, {
  location: Object.assign(new URL("https://app.example.test/home"), { assign }),
});
vi.mock("./autotrack.js", () => ({ tellAutotrack: () => undefined }));
vi.mock("./write-socket.js", () => ({ startWriteSocket: () => null }));

/** A token the auth host hands out, good for an hour. */
const jwt = () =>
  `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, email: "op@example.test" }))}.y`;
const sent: { url: string; init: RequestInit }[] = [];
function serve(...statuses: number[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("/api/auth/token")) return new Response(JSON.stringify({ token: jwt() }));
      sent.push({ url, init });
      const status = statuses.shift() ?? 200;
      return new Response(JSON.stringify(status === 200 ? { done: [1] } : { message: "no" }), {
        status,
      });
    }),
  );
}
const settle = () => new Promise((r) => setTimeout(r, 0));

const { call, outlives } = await import("./api.js");

afterEach(() => {
  sent.length = 0;
  vi.unstubAllGlobals();
});

describe("a 401 from the Worker", () => {
  it("is asked once more with a fresh token and the same body, requestId too", async () => {
    serve(401, 200);
    const got = await call("people/broadcastApprove", { ids: [1], requestId: "r-1" });
    expect(got).toEqual({ done: [1] });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.init.body).toBe(sent[0]?.init.body);
    expect(JSON.parse(String(sent[1]?.init.body))).toMatchObject({ requestId: "r-1" });
  });

  it("twice in a row goes to sign-in, with no third send", async () => {
    serve(401, 401, 200);
    void call("people/broadcastApprove", { ids: [2], requestId: "r-2" }).catch(() => undefined);
    for (let i = 0; i < 5; i++) await settle();
    expect(sent).toHaveLength(2);
  });
});

describe("a call sent as the tab closes", () => {
  it("is kept alive when the page is hidden and the body is small", async () => {
    vi.stubGlobal("document", { visibilityState: "hidden" });
    expect(outlives("{}")).toBe(true);
    expect(outlives("x".repeat(60_000))).toBe(false);
    serve(200);
    await call("notes/delete", { ids: [3], requestId: "r-3" });
    expect(sent[0]?.init.keepalive).toBe(true);
  });

  it("is a plain fetch while the page shows", async () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    serve(200);
    await call("notes/delete", { ids: [4], requestId: "r-4" });
    expect(sent[0]?.init.keepalive).toBeUndefined();
  });
});

describe("every write goes through WRITES", () => {
  it("a write with no request id gets one; a read gets none", async () => {
    serve(200, 200);
    await call("people/broadcastApprove", { ids: [5] });
    await call("notes/home", {});
    expect(JSON.parse(String(sent[0]?.init.body)).requestId).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(JSON.parse(String(sent[1]?.init.body))).not.toHaveProperty("requestId");
  });

  it("a double send of the same write while it's out is one request", async () => {
    serve(200);
    await Promise.all([
      call("people/broadcastApprove", { ids: [6], requestId: "r-6x" }),
      call("people/broadcastApprove", { ids: [6], requestId: "r-6x" }),
    ]);
    expect(sent).toHaveLength(1);
  });
});

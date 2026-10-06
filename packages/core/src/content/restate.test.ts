import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { asAccount, autobrowseSites, SiteCallError, type SiteClient } from "./autobrowse.js";
import { fakeContentChannel } from "./index.js";
import { DESK, journaledSites, makeContent, restateSites, SITES } from "./restate.js";

/** A stand-in Context whose `sites` client answers from a script and keeps every call. */
function ctxOf(answer: (handler: string, req: unknown) => unknown) {
  const calls: { handler: string; req: unknown }[] = [];
  const services: unknown[] = [];
  const ctx = {
    run: async (name: string, fn: () => Promise<unknown>) => {
      calls.push({ handler: `run ${name}`, req: null });
      return fn();
    },
    serviceClient: (service: unknown) => {
      services.push(service);
      return new Proxy(
        {},
        {
          get:
            (_t, handler: string) =>
            async (req: unknown): Promise<unknown> => {
              calls.push({ handler, req });
              return answer(handler, req);
            },
        },
      );
    },
  };
  return { ctx: ctx as unknown as restate.Context, calls, services };
}

describe("restateSites", () => {
  it("wakes the box once per invocation, as a journaled step before the first call", async () => {
    const { ctx, calls } = ctxOf((h) => (h === "status" ? { routes: [] } : {}));
    let woken = 0;
    const sites = restateSites(ctx, {
      caller: "test",
      wake: async () => {
        woken++;
        return "started";
      },
    });
    await sites.via("youtube", "GET", "/x");
    await sites.call("youtube", "GET", "/x");
    await sites.call("youtube", "GET", "/y");
    expect(woken).toBe(1);
    expect(calls.map((c) => c.handler)).toEqual(["run wake autobrowse", "status", "call", "call"]);
    const bare = ctxOf(() => ({}));
    await restateSites(bare.ctx, { caller: "test" }).call("youtube", "GET", "/x");
    expect(bare.calls.map((c) => c.handler)).toEqual(["call"]);
  });

  it("calls `sites/call` with the official shape and reads `via` from one status per site", async () => {
    const { ctx, calls } = ctxOf((h) =>
      h === "status"
        ? { routes: [{ method: "POST", path: "/rest/posts", via: "api" }] }
        : { id: "urn:li:share:1" },
    );
    const sites = restateSites(ctx, { caller: "test" });
    expect(await sites.call("linkedin", "POST", "/rest/posts", { commentary: "hi" })).toEqual({
      id: "urn:li:share:1",
    });
    expect(await sites.via("linkedin", "POST", "/rest/posts")).toBe("api");
    expect(await sites.via("linkedin", "GET", "/rest/posts")).toBe("none");
    expect(calls.map((c) => c.handler)).toEqual(["call", "status"]);
    expect(calls[0]?.req).toEqual({
      site: "linkedin",
      method: "POST",
      path: "/rest/posts",
      input: { commentary: "hi" },
      caller: "test",
    });
  });

  it("a pinned account rides on every call, over Restate and over HTTP", async () => {
    const { ctx, calls } = ctxOf(() => ({}));
    await asAccount(restateSites(ctx, { caller: "test" }), "linkedin@outreach-2").call(
      "linkedin",
      "GET",
      "/rest/me",
    );
    expect(calls[0]?.req).toMatchObject({ site: "linkedin", account: "linkedin@outreach-2" });
    await restateSites(ctx, { caller: "test" }).call("linkedin", "GET", "/rest/me");
    expect(calls[1]?.req).not.toHaveProperty("account");

    const urls: string[] = [];
    const http = autobrowseSites({
      url: "http://box",
      fetch: async (u) => {
        urls.push(String(u));
        return new Response("{}");
      },
    });
    await asAccount(http, "reddit@a").call("reddit", "GET", "/api/v1/me", { raw_json: 1 });
    await asAccount(http, "reddit@a").call("reddit", "POST", "/api/submit", { sr: "x" });
    expect(urls).toEqual([
      "http://box/api/sites/reddit/api/v1/me?raw_json=1&account=reddit%40a",
      "http://box/api/sites/reddit/api/submit?account=reddit%40a",
    ]);
  });

  it("the caller rides on every call: in the body over Restate, as x-caller over HTTP", async () => {
    const { ctx, calls } = ctxOf(() => ({}));
    await restateSites(ctx, { caller: "wren:crm-run" }).call("linkedin", "GET", "/rest/me");
    expect(calls[0]?.req).toMatchObject({ caller: "wren:crm-run" });

    const sent: (string | null)[] = [];
    const http = (caller?: string) =>
      autobrowseSites({
        url: "http://box",
        ...(caller ? { caller } : {}),
        fetch: async (_u, init) => {
          sent.push(new Headers(init?.headers).get("x-caller"));
          return new Response("{}");
        },
      });
    await http("wren:books").call("gmail", "GET", "/x");
    await http().call("gmail", "GET", "/x");
    expect(sent).toEqual(["wren:books", null]);
  });

  it("a terminal error from the worker is a SiteCallError with its status", async () => {
    const { ctx } = ctxOf(() => {
      throw new restate.TerminalError("no leg yet", { errorCode: 501 });
    });
    await expect(
      restateSites(ctx, { caller: "test" }).call("youtube", "GET", "/youtube/v3/videos"),
    ).rejects.toSatisfy((e: unknown) => e instanceof SiteCallError && e.status === 501);
  });
});

describe("restateSites over a named service", () => {
  it("defaults to `sites`; DESK names `desk`", async () => {
    expect(SITES).toEqual({ name: "sites" });
    expect(DESK).toEqual({ name: "desk" });
    const box = ctxOf(() => ({}));
    await restateSites(box.ctx, { caller: "test" }).call("reddit", "GET", "/api/v1/me");
    expect(box.services).toEqual([{ name: "sites" }]);
    const mac = ctxOf(() => ({}));
    await restateSites(mac.ctx, { caller: "test", service: DESK }).call(
      "reddit",
      "GET",
      "/api/v1/me",
    );
    expect(mac.services).toEqual([{ name: "desk" }]);
    expect(mac.calls).toEqual([
      {
        handler: "call",
        req: { site: "reddit", method: "GET", path: "/api/v1/me", input: {}, caller: "test" },
      },
    ]);
  });

  it("the desk is never woken without a wake, even on via", async () => {
    const { ctx, calls } = ctxOf((h) => (h === "status" ? { routes: [] } : {}));
    const desk = restateSites(ctx, { caller: "test", service: DESK });
    await desk.via("reddit", "POST", "/api/submit");
    await desk.call("reddit", "POST", "/api/submit");
    expect(calls.map((c) => c.handler)).toEqual(["status", "call"]);
  });

  it("a wake still runs once before the first call on a named service", async () => {
    const { ctx, calls, services } = ctxOf(() => ({}));
    let woken = 0;
    const sites = restateSites(ctx, {
      caller: "test",
      wake: async () => {
        woken++;
        return "running";
      },
      service: DESK,
    });
    await sites.call("reddit", "GET", "/a");
    await sites.call("reddit", "GET", "/b");
    expect(woken).toBe(1);
    expect(services).toEqual([{ name: "desk" }]);
    expect(calls.map((c) => c.handler)).toEqual(["run wake autobrowse", "call", "call"]);
  });

  it("a terminal error from the desk is a SiteCallError carrying the site, route and code", async () => {
    const { ctx } = ctxOf(() => {
      throw new restate.TerminalError("subreddit banned you", { errorCode: 403 });
    });
    const err = await restateSites(ctx, { caller: "test", service: DESK })
      .call("reddit", "POST", "/api/submit", { sr: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteCallError);
    expect(err).toMatchObject({
      site: "reddit",
      status: 403,
      message: "reddit POST /api/submit: 403 subreddit banned you",
    });
  });

  it("a terminal error with no code maps to 500; a plain error passes through", async () => {
    const bare = ctxOf(() => {
      throw new restate.TerminalError("boom");
    });
    await expect(
      restateSites(bare.ctx, { caller: "test", service: DESK }).call("reddit", "GET", "/x"),
    ).rejects.toSatisfy((e: unknown) => e instanceof SiteCallError && e.status === 500);
    const plain = new Error("socket hang up");
    const flaky = ctxOf(() => {
      throw plain;
    });
    await expect(
      restateSites(flaky.ctx, { caller: "test", service: DESK }).call("reddit", "GET", "/x"),
    ).rejects.toBe(plain);
  });

  it("via reads one status per site and keeps each site's apart", async () => {
    const { ctx, calls } = ctxOf((h, req) => {
      if (h !== "status") return {};
      const site = (req as { site: string }).site;
      return site === "reddit"
        ? { routes: [{ method: "POST", path: "/api/submit", via: "browser" }] }
        : { routes: [{ method: "POST", path: "/api/submit", via: "api" }] };
    });
    const desk = restateSites(ctx, { caller: "test", service: DESK });
    const [a, b] = await Promise.all([
      desk.via("reddit", "POST", "/api/submit"),
      desk.via("reddit", "POST", "/api/submit"),
    ]);
    expect([a, b]).toEqual(["browser", "browser"]);
    expect(await desk.via("other", "POST", "/api/submit")).toBe("api");
    expect(await desk.via("reddit", "GET", "/api/info")).toBe("none");
    expect(calls.filter((c) => c.handler === "status").map((c) => c.req)).toEqual([
      { site: "reddit" },
      { site: "other" },
    ]);
  });

  it("the status cache lives per client: a new client reads status again", async () => {
    const { ctx, calls } = ctxOf(() => ({ routes: [] }));
    await restateSites(ctx, { caller: "test", service: DESK }).via("reddit", "GET", "/x");
    await restateSites(ctx, { caller: "test", service: DESK }).via("reddit", "GET", "/x");
    expect(calls.filter((c) => c.handler === "status")).toHaveLength(2);
  });
});

describe("journaledSites", () => {
  const runCtx = () => {
    const steps: string[] = [];
    const ctx = {
      run: async (name: string, fn: () => Promise<unknown>) => {
        steps.push(name);
        return fn();
      },
    } as unknown as restate.Context;
    return { ctx, steps };
  };
  const direct = (fail?: SiteCallError): SiteClient => ({
    async call<T>() {
      if (fail) throw fail;
      return { ok: 1 } as T;
    },
    async via() {
      return "api" as const;
    },
  });

  it("each call is one named step", async () => {
    const { ctx, steps } = runCtx();
    expect(await journaledSites(ctx, direct()).call("reddit", "POST", "/api/submit")).toEqual({
      ok: 1,
    });
    expect(steps).toEqual(["reddit POST /api/submit"]);
  });

  it("a refusal is terminal inside the step and a SiteCallError outside; a 429 is not terminal", async () => {
    const { ctx } = runCtx();
    const refused = new SiteCallError("reddit", "POST", "/api/submit", 403, "no");
    await expect(
      journaledSites(ctx, direct(refused)).call("reddit", "POST", "/api/submit"),
    ).rejects.toSatisfy((e: unknown) => e instanceof SiteCallError && e.status === 403);
    const busy = new SiteCallError("reddit", "GET", "/x", 429, "slow down");
    await expect(journaledSites(ctx, direct(busy)).call("reddit", "GET", "/x")).rejects.toBe(busy);
  });
});

describe("Content service", () => {
  const linkedin = fakeContentChannel("linkedin");
  const svc = makeContent(() => ({ linkedin }));
  const h = (
    svc as unknown as { service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>> }
  ).service;
  const ctx = {} as never;

  it("routes by platform", async () => {
    expect(await h.platforms?.(ctx)).toEqual(["linkedin"]);
    const pub = (await h.publish?.(ctx, { platform: "linkedin", post: { text: "hi" } })) as {
      id: string;
    };
    expect(pub.id).toBe("linkedin-1");
    const rows = (await h.list?.(ctx, { platform: "linkedin" })) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([pub.id]);
  });

  it("activity and audience: the channel's rows, or null when it reads none", async () => {
    linkedin.happen({
      id: "a1",
      kind: "follow",
      actor: "Ana",
      actorUrl: null,
      text: "Ana followed you",
      url: null,
      at: "2026-10-06T10:00:00Z",
      raw: {},
    });
    linkedin.follow(42);
    const rows = (await h.activity?.(ctx, { platform: "linkedin", q: { since: null } })) as {
      id: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual(["a1"]);
    expect(await h.activity?.(ctx, { platform: "linkedin", q: { since: "2026-10-07" } })).toEqual(
      [],
    );
    expect(await h.audience?.(ctx, { platform: "linkedin" })).toMatchObject({ followers: 42 });
    const { activity: _a, audience: _b, ...bare } = fakeContentChannel("x");
    const hx = (
      makeContent(() => ({ x: bare })) as unknown as {
        service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
      }
    ).service;
    expect(await hx.activity?.(ctx, { platform: "x" })).toBeNull();
    expect(await hx.audience?.(ctx, { platform: "x" })).toBeNull();
  });

  it("an unconfigured platform is a terminal 404, not a retry", async () => {
    await expect(h.metrics?.(ctx, { platform: "youtube", id: "v" })).rejects.toMatchObject({
      name: "TerminalError",
      message: /no youtube channel/,
    });
  });
});

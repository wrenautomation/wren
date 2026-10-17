import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import {
  NotSent,
  type SendTrace,
  SendUnknown,
  type SendVerdict,
  SentFound,
  withSendKey,
} from "../send-verdict.js";
import {
  asAccount,
  autobrowseSites,
  type CapHolds,
  capHeld,
  capWaitMs,
  holdCap,
  liveHolds,
  SiteCallError,
  type SiteClient,
} from "./autobrowse.js";
import { fakeContentChannel } from "./index.js";
import {
  ArmedStop,
  DESK,
  isRefusal,
  journaledHost,
  journaledSites,
  makeContent,
  restateSites,
  SITES,
} from "./restate.js";

/** A stand-in Context whose `sites` client answers from a script and keeps every call. */
function ctxOf(answer: (handler: string, req: unknown) => unknown) {
  const calls: { handler: string; req: unknown; idem?: string }[] = [];
  const services: unknown[] = [];
  const sent: { handler: string; req: unknown }[] = [];
  const ctx = {
    run: async (name: string, fn: () => Promise<unknown>) => {
      calls.push({ handler: `run ${name}`, req: null });
      return fn();
    },
    sleep: async (ms: number) => {
      calls.push({ handler: "sleep", req: ms });
    },
    date: { now: async () => Date.parse("2026-10-16T12:00:00.000Z") },
    serviceSendClient: (service: unknown) => {
      services.push(service);
      return new Proxy(
        {},
        { get: (_t, handler: string) => (req: unknown) => void sent.push({ handler, req }) },
      );
    },
    serviceClient: (service: unknown) => {
      services.push(service);
      return new Proxy(
        {},
        {
          get:
            (_t, handler: string) =>
            async (req: unknown, opts?: { getOpts?: () => { idempotencyKey?: string } }) => {
              const idem = opts?.getOpts?.().idempotencyKey;
              calls.push({ handler, req, ...(idem ? { idem } : {}) });
              return answer(handler, req);
            },
        },
      );
    },
  };
  return { ctx: ctx as unknown as restate.Context, calls, services, sent };
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

describe("restateSites arming", () => {
  it("reads run; the first write is sent to `arm` instead and stops the channel", async () => {
    const { ctx, calls, sent } = ctxOf(() => ({ sub: "me" }));
    const sites = restateSites(ctx, { caller: "wren:content", service: DESK, arm: true });
    await sites.call("linkedin", "GET", "/rest/me");
    await expect(
      sites.call("linkedin", "POST", "/rest/socialActions/urn/comments", { text: "hi" }),
    ).rejects.toBeInstanceOf(ArmedStop);
    expect(calls.map((c) => c.handler)).toEqual(["call"]);
    expect(sent).toEqual([
      {
        handler: "arm",
        req: {
          site: "linkedin",
          method: "POST",
          path: "/rest/socialActions/urn/comments",
          input: { text: "hi" },
          caller: "wren:content",
        },
      },
    ]);
  });

  it("Content.arm: armed only when a write reached `arm`; never for a client", async () => {
    const seen: (boolean | undefined)[] = [];
    const reply = (stop: boolean) => async () => {
      if (stop) throw new ArmedStop();
      throw new Error("not found");
    };
    let stop = true;
    const x = { ...fakeContentChannel("x"), reply: () => reply(stop)() };
    const h = (
      makeContent((_ctx, o) => {
        seen.push(o?.arm);
        return { x: x as never };
      }) as unknown as {
        service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
      }
    ).service;
    const req = { platform: "x", commentId: "c1", text: "thanks" };
    expect(await h.arm?.({}, req)).toEqual({ armed: true });
    expect(seen).toEqual([true]);
    stop = false;
    expect(await h.arm?.({}, req)).toEqual({ armed: false });
    expect(await h.arm?.({}, { ...req, client: "acme" })).toEqual({ armed: false });
    expect(seen).toHaveLength(2);
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

  it("a read or an upload that failed in passing is called again, paused, then journaled final", async () => {
    let n = 0;
    const flaky = ctxOf(() => {
      if (++n < 3) throw new restate.TerminalError("HTTP 0 TypeError (UND_ERR_SOCKET)");
      return { urn: "urn:li:video:1" };
    });
    const sites = restateSites(flaky.ctx, { caller: "test", service: DESK });
    expect(await sites.call("linkedin", "POST", "/upload", { kind: "video" })).toEqual({
      urn: "urn:li:video:1",
    });
    expect(flaky.calls.filter((c) => c.handler === "sleep").map((c) => c.req)).toEqual([
      30_000, 60_000,
    ]);

    const down = ctxOf(() => {
      throw new restate.TerminalError("bad gateway", { errorCode: 502 });
    });
    const err = await restateSites(down.ctx, { caller: "test", service: DESK })
      .call("youtube", "GET", "/youtube/v3/videos")
      .catch((e: unknown) => e);
    expect(down.calls.filter((c) => c.handler === "call")).toHaveLength(3);
    expect(err).toMatchObject({ status: 502, journaled: true });
  });

  it("a post or a refusal is never called again", async () => {
    const post = ctxOf(() => {
      throw new restate.TerminalError("bad gateway", { errorCode: 502 });
    });
    await restateSites(post.ctx, { caller: "test", service: DESK })
      .call("x", "POST", "/2/tweets", { text: "hi" })
      .catch(() => null);
    expect(post.calls.filter((c) => c.handler === "call")).toHaveLength(1);
    const refused = ctxOf(() => {
      throw new restate.TerminalError("not found", { errorCode: 404 });
    });
    await restateSites(refused.ctx, { caller: "test", service: DESK })
      .call("x", "GET", "/2/tweets/1")
      .catch(() => null);
    expect(refused.calls.filter((c) => c.handler === "call")).toHaveLength(1);
  });

  it("a post that fails keeps the status: the caller reads it, not the words", async () => {
    const c = ctxOf(() => {
      throw new restate.TerminalError("profile google@test is busy", { errorCode: 503 });
    });
    const err = await restateSites(c.ctx, { caller: "test", service: DESK })
      .call("tiktok", "POST", "/web/posts", { text: "hi" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503, journaled: true });
    expect(c.calls.filter((x) => x.handler === "call")).toHaveLength(1);
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

describe("restateSites keyed writes", () => {
  const KEY = "thread:7 k1";
  const WRITE = `${KEY} tiktok POST /web/posts`;
  const AT = "2026-10-16T12:00:00.000Z";
  const sentAnswer: SendVerdict = {
    verdict: "sent",
    how: "answer",
    id: "v1",
    url: null,
    at: AT,
    output: { id: "v1" },
  };
  const sentVerified: SendVerdict = {
    verdict: "sent",
    how: "verified",
    id: "v2",
    url: "u",
    at: AT,
  };
  const notSent: SendVerdict = { verdict: "not_sent", how: "before_submit", reason: "busy" };
  const unknown: SendVerdict = { verdict: "unknown", reason: "lags", since: AT };
  /** A write inside the key scope, as the caller's send makes it. */
  const post = (
    answer: (handler: string, req: unknown) => unknown,
    o: { recheck?: boolean; trace?: SendTrace } = {},
  ) => {
    const c = ctxOf(answer);
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    const run = withSendKey(
      KEY,
      () => sites.call("tiktok", "POST", "/web/posts", { text: "hi" }),
      o,
    );
    return { ...c, run };
  };

  it("sends the key in the request and as Restate's idempotency key", async () => {
    const c = post(() => sentAnswer);
    expect(await c.run).toEqual({ id: "v1" });
    expect(c.calls).toEqual([
      {
        handler: "call",
        req: {
          site: "tiktok",
          method: "POST",
          path: "/web/posts",
          input: { text: "hi" },
          caller: "test",
          sendKey: WRITE,
        },
        idem: WRITE,
      },
    ]);
  });

  it("each verdict maps: sent, found, not sent, unknown", async () => {
    expect(await post(() => sentAnswer).run).toEqual({ id: "v1" });
    await expect(post(() => sentVerified).run).rejects.toMatchObject({
      constructor: SentFound,
      id: "v2",
      url: "u",
    });
    const no = await post(() => notSent).run.catch((e: unknown) => e);
    expect(no).toBeInstanceOf(NotSent);
    expect(no).toMatchObject({ how: "before_submit", reason: "busy" });
    const absent = await post(() => ({ ...notSent, how: "verified_absent" })).run.catch(
      (e: unknown) => e,
    );
    expect(absent).toMatchObject({ how: "verified_absent" });
    const maybe = await post(() => unknown).run.catch((e: unknown) => e);
    expect(maybe).toBeInstanceOf(SendUnknown);
    expect(maybe).toMatchObject({ reason: "lags", since: AT });
  });

  it("the platform's no is a SiteCallError with its status, journaled", async () => {
    const c = post(() => ({
      verdict: "not_sent",
      how: "refused",
      reason: "RATELIMIT",
      status: 422,
    }));
    const err = await c.run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteCallError);
    expect(err).toMatchObject({ status: 422, journaled: true });
    expect(isRefusal(err)).toBe(true);
  });

  it("an unknown answer is asked again only when the caller rechecks", async () => {
    const plain = post(() => unknown);
    await plain.run.catch(() => null);
    expect(plain.calls.map((x) => x.handler)).toEqual(["call"]);

    const again = post((h) => (h === "verdict" ? sentVerified : unknown), { recheck: true });
    await expect(again.run).rejects.toBeInstanceOf(SentFound);
    expect(again.calls.map((x) => x.handler)).toEqual(["call", "verdict"]);
    expect(again.calls[1]?.req).toEqual({ sendKey: WRITE });
  });

  it("a killed or failed call asks `verdict` on the same service with the same key", async () => {
    for (const [message, errorCode] of [
      ["killed", 409],
      ["bad gateway", 502],
      ["timeout", 408],
    ] as const) {
      const c = post((h) => {
        if (h === "verdict") return sentVerified;
        throw new restate.TerminalError(message, { errorCode });
      });
      await expect(c.run).rejects.toBeInstanceOf(SentFound);
      expect(c.calls.map((x) => x.handler)).toEqual(["call", "verdict"]);
      expect(c.calls[1]?.req).toEqual({ sendKey: WRITE });
      expect(c.services).toEqual([{ name: "desk" }]);
    }
  });

  it("a request that was wrong stays an error and asks nothing", async () => {
    const c = post(() => {
      throw new restate.TerminalError("no such account", { errorCode: 403 });
    });
    const err = await c.run.catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403, journaled: true });
    expect(c.calls.map((x) => x.handler)).toEqual(["call"]);
  });

  it("a verdict call that fails too is unknown, never a plain failure", async () => {
    const c = post(() => {
      throw new restate.TerminalError("bad gateway", { errorCode: 502 });
    });
    const err = await c.run.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SendUnknown);
    expect(err).toMatchObject({ reason: "the verdict could not be read" });
  });

  it("an older desk's plain answer passes as the output", async () => {
    const trace: SendTrace = { wrote: false };
    const c = post(() => ({ id: "old" }), { trace });
    expect(await c.run).toEqual({ id: "old" });
    expect(trace.wrote).toBe(true);
  });

  it("the trace tells a write answered, and a not-sent answer leaves nothing", async () => {
    const wrote: SendTrace = { wrote: false };
    await post(() => unknown, { trace: wrote }).run.catch(() => null);
    expect(wrote.wrote).toBe(true);
    const clean: SendTrace = { wrote: false };
    await post(() => notSent, { trace: clean }).run.catch(() => null);
    expect(clean.wrote).toBe(false);
  });

  it("a second write to one route gets its own key", async () => {
    const c = ctxOf(() => sentAnswer);
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    await withSendKey(KEY, async () => {
      await sites.call("tiktok", "POST", "/web/posts", { text: "a" });
      await sites.call("tiktok", "POST", "/web/posts", { text: "b" });
    });
    expect(c.calls.map((x) => x.idem)).toEqual([WRITE, `${WRITE} #2`]);
  });

  it("a read and an upload carry no key, even inside the scope", async () => {
    const c = ctxOf(() => ({}));
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    await withSendKey(KEY, async () => {
      await sites.call("tiktok", "GET", "/web/me");
      await sites.call("linkedin", "POST", "/upload", { kind: "video" });
    });
    for (const call of c.calls) {
      expect(call.idem).toBeUndefined();
      expect(call.req).not.toHaveProperty("sendKey");
    }
  });
});

describe("journaledHost", () => {
  it("signs each source in a journaled step, so a replay hands the site the same URL", async () => {
    const journal = new Map<string, unknown>();
    const ctx = {
      run: async (name: string, fn: () => Promise<unknown>) => {
        if (!journal.has(name)) journal.set(name, await fn());
        return journal.get(name);
      },
    } as unknown as restate.Context;
    let n = 0;
    const host = journaledHost(ctx, { host: async (s) => `${s}?sig=${++n}` });
    const first = await host.host("s3://b/k.mp4");
    expect(await host.host("s3://b/k.mp4")).toBe(first);
    expect([...journal.keys()]).toEqual(["sign s3://b/k.mp4"]);
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

  it("insights: the channel's numbers and gaps, or null when it reads none", async () => {
    linkedin.measure("p1", {
      values: [{ metric: "saves", value: 2 }],
      gaps: [{ metric: "reach", state: "needs_william", why: "partner API" }],
    });
    expect(
      await h.insights?.(ctx, { platform: "linkedin", id: "p1", published: null, kind: null }),
    ).toMatchObject({
      values: [{ metric: "saves", value: 2 }],
      gaps: [{ metric: "reach", state: "needs_william" }],
    });
    linkedin.measureAccount({ days: [{ day: "2026-10-06", values: [] }], gaps: [] });
    expect(await h.accountInsights?.(ctx, { platform: "linkedin" })).toMatchObject({
      days: [{ day: "2026-10-06" }],
    });
    linkedin.report({
      rows: [{ id: "p1", day: "2026-10-05", values: [{ metric: "impressions_day", value: 9 }] }],
      gaps: [],
      cursor: "2026-10-06T00:00:00Z",
    });
    expect(
      await h.reportDays?.(ctx, { platform: "linkedin", after: "2026-10-01T00:00:00Z" }),
    ).toMatchObject({ rows: [{ id: "p1", day: "2026-10-05" }], cursor: "2026-10-06T00:00:00Z" });
    const { insights: _i, accountInsights: _a, reportDays: _r, ...bare } = fakeContentChannel("x");
    const hx = (
      makeContent(() => ({ x: bare })) as unknown as {
        service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
      }
    ).service;
    expect(await hx.insights?.(ctx, { platform: "x", id: "t" })).toBeNull();
    expect(await hx.accountInsights?.(ctx, { platform: "x" })).toBeNull();
    expect(await hx.reportDays?.(ctx, { platform: "x" })).toBeNull();
  });

  it("a journaled site failure is terminal, so the queue moves on; an unjournaled one retries", async () => {
    const dropped = (journaled: boolean) => {
      const e = new SiteCallError("linkedin", "POST", "/upload", 500, "UND_ERR_SOCKET");
      e.journaled = journaled;
      const ch = { ...fakeContentChannel("linkedin"), publish: () => Promise.reject(e) };
      return (
        makeContent(() => ({ linkedin: ch })) as unknown as {
          service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
        }
      ).service.publish?.(ctx, { platform: "linkedin", post: { text: "hi" } });
    };
    await expect(dropped(true)).rejects.toMatchObject({ name: "TerminalError", code: 500 });
    await expect(dropped(false)).rejects.toMatchObject({ name: "SiteCallError" });
  });

  it("a keyed publish answers a Delivery; a typed outcome crosses as a value, not an error", async () => {
    const ch = fakeContentChannel("linkedin");
    const out = (await h.publish?.(ctx, {
      platform: "linkedin",
      post: { text: "hi" },
      sendKey: "draft:1 k1",
    })) as { kind: string; out: { id: string } };
    expect(out).toMatchObject({ kind: "sent", out: { id: expect.any(String) } });
    const typed = (error: Error) =>
      (
        makeContent(() => ({
          linkedin: { ...ch, publish: () => Promise.reject(error) },
        })) as unknown as {
          service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
        }
      ).service.publish?.(ctx, {
        platform: "linkedin",
        post: { text: "hi" },
        sendKey: "draft:1 k1",
      });
    expect(await typed(new SendUnknown("lags", "2026-10-16T12:00:00.000Z"))).toEqual({
      kind: "unknown",
      reason: "lags",
      since: "2026-10-16T12:00:00.000Z",
    });
    expect(await typed(new NotSent("before_submit", "busy"))).toMatchObject({
      kind: "not_sent",
      how: "before_submit",
    });
    expect(await typed(new SentFound("v9", null, "2026-10-16T12:00:00.000Z"))).toMatchObject({
      kind: "found",
      id: "v9",
    });
  });

  it("a keyed publish that fails with no write answered still throws", async () => {
    const e = new SiteCallError("linkedin", "POST", "/rest/posts", 403, "forbidden");
    e.journaled = true;
    const ch = { ...fakeContentChannel("linkedin"), publish: () => Promise.reject(e) };
    const svc2 = (
      makeContent(() => ({ linkedin: ch })) as unknown as {
        service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
      }
    ).service;
    await expect(
      svc2.publish?.(ctx, { platform: "linkedin", post: { text: "hi" }, sendKey: "draft:1 k1" }),
    ).rejects.toMatchObject({ name: "TerminalError", code: 403 });
  });

  it("an unconfigured platform is a terminal 404, not a retry", async () => {
    await expect(h.metrics?.(ctx, { platform: "youtube", id: "v" })).rejects.toMatchObject({
      name: "TerminalError",
      message: /no youtube channel/,
    });
  });
});

describe("capWaitMs", () => {
  it("reads a used daily cap's wait, from the site error or a terminal error's message", () => {
    const msg = "linkedin inbox cap for a@b.test is used (48/48 today); retry after 25138s";
    expect(capWaitMs(new SiteCallError("linkedin", "GET", "/messaging", 429, msg))).toBe(25138000);
    expect(capWaitMs(new Error(`SiteCallError: linkedin GET /messaging: 429 ${msg}`))).toBe(
      25138000,
    );
    expect(capWaitMs(new SiteCallError("x", "GET", "/s", 429, "slow down; retry after 30s"))).toBe(
      null,
    );
    expect(capWaitMs(new SiteCallError("x", "GET", "/s", 500, "retry after 9999s"))).toBeNull();
    const terminal = new restate.TerminalError("x search cap is used; retry after 7200s", {
      errorCode: 429,
    });
    expect(capWaitMs(terminal)).toBe(7_200_000);
  });

  it("holds a key until its cap resets; anything else holds nothing", () => {
    const holds: CapHolds = {};
    const cap = new SiteCallError("x", "GET", "/s", 429, "search cap is used; retry after 3600s");
    expect(holdCap(holds, "x:comments", cap, 1_000)).toBe(true);
    expect(holds).toEqual({ "x:comments": 3_601_000 });
    expect(holdCap(holds, "x:comments", new Error("boom"), 1_000)).toBe(false);
    expect(capHeld(holds, "x:comments", 3_600_999)).toBe(true);
    expect(capHeld(holds, "x:comments", 3_601_000)).toBe(false);
    expect(capHeld(holds, "reddit", 0)).toBe(false);
    expect(liveHolds(holds, 3_601_000)).toEqual({});
  });
});

describe("isRefusal", () => {
  const e = (status: number, msg = "no") => new SiteCallError("x", "GET", "/s", status, msg);
  it("a used daily cap is final; a short 429 and a 408 retry", () => {
    expect(isRefusal(e(429, "x search cap is used (50/50 today); retry after 9910s"))).toBe(true);
    expect(isRefusal(e(429, "slow down; retry after 30s"))).toBe(false);
    expect(isRefusal(e(429))).toBe(false);
    expect(isRefusal(e(408))).toBe(false);
    expect(isRefusal(e(403))).toBe(true);
    expect(isRefusal(e(503))).toBe(false);
  });
  it("a route nothing does yet (501) is final", () => {
    expect(isRefusal(e(501, "workflow linkedin-post-stats not recorded yet"))).toBe(true);
    expect(isRefusal(e(502))).toBe(false);
  });
});

import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type { JournalEntry, JournalRecord, SendJournal } from "../send-journal.js";
import {
  deliveryOf,
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
  LOGIN_HOLD_MS,
  liveHolds,
  SiteCallError,
  type SiteClient,
} from "./autobrowse.js";
import { fakeContentChannel } from "./index.js";
import { gapStateOf } from "./insights.js";
import {
  ArmedStop,
  DESK,
  isRefusal,
  journaledHost,
  journaledSites,
  keyedWaitEnds,
  makeContent,
  restateSites,
  SEND_GRACE_MS,
  SITES,
} from "./restate.js";

/** A stand-in Context whose `sites` client answers from a script and keeps every call. */
function ctxOf(answer: (handler: string, req: unknown) => unknown) {
  const calls: { handler: string; req: unknown; idem?: string }[] = [];
  const services: unknown[] = [];
  const sent: { handler: string; req: unknown }[] = [];
  const waits: { handler: string; ms: number }[] = [];
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
            (req: unknown, opts?: { getOpts?: () => { idempotencyKey?: string } }) => {
              const idem = opts?.getOpts?.().idempotencyKey;
              calls.push({ handler, req, ...(idem ? { idem } : {}) });
              // A RestatePromise: `within` waits on it with a timeout; `HANG` never answers.
              const out = answer(handler, req);
              const p = (async () => out)();
              return Object.assign(p, {
                orTimeout: (ms: number) => {
                  waits.push({ handler, ms });
                  return out === HANG ? Promise.reject(new restate.TimeoutError()) : p;
                },
              });
            },
        },
      );
    },
  };
  return { ctx: ctx as unknown as restate.Context, calls, services, sent, waits };
}

/** An answer that never comes: the call's wait runs out. */
const HANG = Symbol("hang");

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
      // The end of the call's day on Wren's clock: the desk sends it no later.
      until: expect.stringMatching(/^\d{4}-\d\d-\d\dT0[45]:00:00\.000Z$/),
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

  it("a terminal error's access code rides on the SiteCallError and picks the gap", async () => {
    const { ctx } = ctxOf(() => {
      throw new restate.TerminalError("reddit: signed out", {
        errorCode: 401,
        metadata: { code: "need_login" },
      });
    });
    const err = await restateSites(ctx, { caller: "test", service: DESK })
      .call("reddit", "GET", "/api/me", {})
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, code: "need_login" });
    expect(gapStateOf(err)).toBe("needs_william");
    expect(gapStateOf(new SiteCallError("x", "GET", "/", 403, "captcha", "platform_blocked"))).toBe(
      "error",
    );
    expect(gapStateOf(new SiteCallError("x", "GET", "/", 403, "no scope"))).toBe("needs_scope");
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
          until: expect.stringMatching(/^\d{4}-\d\d-\d\dT0[45]:00:00\.000Z$/),
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

  it("a container is staging: no key, no trace; a refused publish after it is the refusal (10-17)", async () => {
    const refusal: SendVerdict = {
      verdict: "not_sent",
      how: "refused",
      reason: "The media is not ready",
      status: 400,
    };
    const c = ctxOf((_h, req) =>
      (req as { path: string }).path === "/me/threads_publish" ? refusal : { id: "c1" },
    );
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    const trace: SendTrace = { wrote: false };
    const err = await deliveryOf(
      KEY,
      async () => {
        const made = await sites.call("threads", "POST", "/me/threads", { text: "hi" });
        expect(made).toEqual({ id: "c1" });
        return sites.call("threads", "POST", "/me/threads_publish", { creation_id: "c1" });
      },
      { trace },
    ).catch((e: unknown) => e);
    // Not a Delivery of kind unknown ("a write answered, then ..."): the refusal itself.
    expect(err).toBeInstanceOf(SiteCallError);
    expect(err).toMatchObject({ status: 400, journaled: true });
    expect(trace.wrote).toBe(false);
    const [container, publish] = c.calls;
    expect(container?.idem).toBeUndefined();
    expect(container?.req).not.toHaveProperty("sendKey");
    expect(publish?.idem).toBe(`${KEY} threads POST /me/threads_publish`);
  });

  it("a YouTube upload is the publish: keyed, and never called again after a 5xx", async () => {
    const c = ctxOf((h) => {
      if (h === "verdict") return unknown;
      throw new restate.TerminalError("bad gateway", { errorCode: 502 });
    });
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    const err = await withSendKey(KEY, () =>
      sites.call("youtube", "POST", "/upload/youtube/v3/videos", { title: "t" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SendUnknown);
    expect(c.calls.map((x) => x.handler)).toEqual(["call", "verdict"]);
    expect(c.calls[0]?.idem).toBe(`${KEY} youtube POST /upload/youtube/v3/videos`);
    expect(c.calls.some((x) => x.handler === "sleep")).toBe(false);
  });

  it("a POST that only reads carries no key and leaves no trace", async () => {
    const c = ctxOf(() => ({ data: { privacy_level_options: ["SELF_ONLY"] } }));
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    const trace: SendTrace = { wrote: false };
    await withSendKey(
      KEY,
      () => sites.call("tiktok", "POST", "/v2/post/publish/creator_info/query/"),
      { trace },
    );
    expect(c.calls[0]?.idem).toBeUndefined();
    expect(c.calls[0]?.req).not.toHaveProperty("sendKey");
    expect(trace.wrote).toBe(false);
  });
});

describe("restateSites keyed write waits", () => {
  it("waits to its day's end plus grace, not `limitMs`; past it the verdict answers", async () => {
    const c = ctxOf((handler) =>
      handler === "call" ? HANG : { verdict: "not_sent", how: "before_submit", reason: "none" },
    );
    const sites = restateSites(c.ctx, { caller: "test", service: DESK, limitMs: 60_000 });
    const err = await withSendKey("thread:7 k1", () =>
      sites.call("tiktok", "POST", "/web/posts", { text: "hi" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotSent);
    const wait = c.waits.find((w) => w.handler === "call")?.ms ?? 0;
    const ends = keyedWaitEnds(new Date("2026-10-16T12:00:00.000Z")).getTime();
    expect(wait).toBe(ends - Date.parse("2026-10-16T12:00:00.000Z"));
    expect(wait).toBeGreaterThan(SEND_GRACE_MS);
    expect(c.calls.map((x) => x.handler)).toEqual(["call", "verdict"]);
  });
});

describe("restateSites verify-only", () => {
  const KEY = "thread:7 k1";
  const WRITE = `${KEY} tiktok POST /web/posts`;
  const AT = "2026-10-16T12:00:00.000Z";
  const ask = (answer: (h: string, req: unknown) => unknown, o: { trace?: SendTrace } = {}) => {
    const c = ctxOf(answer);
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    const run = withSendKey(KEY, () => sites.call("tiktok", "POST", "/web/posts", { text: "hi" }), {
      verifyOnly: true,
      ...o,
    });
    return { ...c, run };
  };

  it("asks the verdict and never calls; each answer maps as in a send", async () => {
    const sent = ask(() => ({
      verdict: "sent",
      how: "verified",
      id: "v2",
      url: "u",
      at: AT,
    }));
    await expect(sent.run).rejects.toBeInstanceOf(SentFound);
    expect(sent.calls).toEqual([{ handler: "verdict", req: { sendKey: WRITE } }]);

    const none = await ask(() => ({
      verdict: "not_sent",
      how: "verified_absent",
      reason: "gone",
    })).run.catch((e: unknown) => e);
    expect(none).toBeInstanceOf(NotSent);

    const refused = await ask(() => ({
      verdict: "not_sent",
      how: "refused",
      reason: "no",
      status: 403,
    })).run.catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 403, journaled: true });

    const trace: SendTrace = { wrote: false };
    const maybe = ask(() => ({ verdict: "unknown", reason: "lags", since: AT }), { trace });
    await expect(maybe.run).rejects.toBeInstanceOf(SendUnknown);
    expect(trace.wrote).toBe(true);
    for (const c of [sent, maybe]) expect(c.calls.some((x) => x.handler === "call")).toBe(false);
  });

  it("a verdict that cannot be read is unknown, never a write", async () => {
    const c = ask(() => {
      throw new restate.TerminalError("bad gateway", { errorCode: 502 });
    });
    await expect(c.run).rejects.toBeInstanceOf(SendUnknown);
    expect(c.calls.map((x) => x.handler)).toEqual(["verdict"]);
  });

  it("a read and a staging write still run", async () => {
    const c = ctxOf(() => ({ ok: 1 }));
    const sites = restateSites(c.ctx, { caller: "test", service: DESK });
    await withSendKey(
      KEY,
      async () => {
        await sites.call("tiktok", "GET", "/web/me");
        await sites.call("threads", "POST", "/me/threads", {});
      },
      { verifyOnly: true },
    );
    expect(c.calls.map((x) => x.handler)).toEqual(["call", "call"]);
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

/** A send journal in memory, with the writes it saw. */
function memJournal(seed: Record<string, JournalRecord> = {}) {
  const rows = new Map<string, JournalRecord>(Object.entries(seed));
  const log: string[] = [];
  const journal: SendJournal = {
    async begin(e: JournalEntry, now: Date) {
      const held = rows.get(e.key);
      if (held) return { won: false, record: held };
      rows.set(e.key, { verdict: null, startedAt: now.toISOString() });
      log.push(`begin ${e.key}`);
      return { won: true };
    },
    async settle(key, verdict) {
      const held = rows.get(key);
      if (held) rows.set(key, { ...held, verdict });
      log.push(`settle ${key}`);
    },
    async read(key) {
      return rows.get(key) ?? null;
    },
  };
  return { journal, rows, log };
}

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
  const direct = (fail?: unknown): SiteClient & { n: number } => ({
    n: 0,
    async call<T>() {
      this.n++;
      if (fail) throw fail;
      return { ok: 1 } as T;
    },
    async via() {
      return "api" as const;
    },
  });
  const KEY = "thread:7 k1";
  const WRITE = `${KEY} reddit POST /api/submit`;
  const AT = "2026-10-16T12:00:00.000Z";

  it("each call is one named step", async () => {
    const { ctx, steps } = runCtx();
    const { journal } = memJournal();
    expect(
      await journaledSites(ctx, direct(), journal).call("reddit", "POST", "/api/submit"),
    ).toEqual({ ok: 1 });
    expect(steps).toEqual(["reddit POST /api/submit"]);
  });

  it("a refusal is terminal inside the step and a SiteCallError outside; a 429 is not terminal", async () => {
    const { ctx } = runCtx();
    const { journal } = memJournal();
    const refused = new SiteCallError("reddit", "POST", "/api/submit", 403, "no");
    await expect(
      journaledSites(ctx, direct(refused), journal).call("reddit", "POST", "/api/submit"),
    ).rejects.toSatisfy((e: unknown) => e instanceof SiteCallError && e.status === 403);
    const busy = new SiteCallError("reddit", "GET", "/x", 429, "slow down");
    await expect(
      journaledSites(ctx, direct(busy), journal).call("reddit", "GET", "/x"),
    ).rejects.toBe(busy);
  });

  describe("a write inside a key scope", () => {
    const send = (
      sites: SiteClient,
      journal: SendJournal,
      o: { recheck?: boolean; trace?: SendTrace; verifyOnly?: boolean } = {},
    ) =>
      withSendKey(
        KEY,
        () => journaledSites(runCtx().ctx, sites, journal).call("reddit", "POST", "/api/submit"),
        o,
      );

    it("writes the record before the act, then the verdict, and answers the output", async () => {
      const { journal, log, rows } = memJournal();
      const order: string[] = [];
      const sites: SiteClient = {
        async call<T>() {
          order.push(...log);
          return { id: "t3_a" } as T;
        },
        via: async () => "api" as const,
      };
      const trace: SendTrace = { wrote: false };
      expect(await send(sites, journal, { trace })).toEqual({ id: "t3_a" });
      expect(order).toEqual([`begin ${WRITE}`]);
      expect(log).toEqual([`begin ${WRITE}`, `settle ${WRITE}`]);
      expect(rows.get(WRITE)?.verdict).toMatchObject({ verdict: "sent", how: "answer" });
      expect(trace.wrote).toBe(true);
    });

    it("a final verdict answers with no call", async () => {
      const done = memJournal({
        [WRITE]: {
          startedAt: AT,
          verdict: {
            verdict: "sent",
            how: "answer",
            id: null,
            url: null,
            at: AT,
            output: { id: "t3_a" },
          },
        },
      });
      const sites = direct();
      expect(await send(sites, done.journal)).toEqual({ id: "t3_a" });
      expect(sites.n).toBe(0);
      const no = memJournal({
        [WRITE]: {
          startedAt: AT,
          verdict: { verdict: "not_sent", how: "refused", reason: "RATELIMIT", status: 429 },
        },
      });
      const err = await send(sites, no.journal).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 429, journaled: true });
      expect(sites.n).toBe(0);
    });

    it("an open record, or an unknown one, is unknown with no call; recheck changes nothing", async () => {
      const sites = direct();
      for (const verdict of [null, { verdict: "unknown" as const, reason: "lags", since: AT }]) {
        const { journal } = memJournal({ [WRITE]: { startedAt: AT, verdict } });
        for (const recheck of [false, true]) {
          const trace: SendTrace = { wrote: false };
          const err = await send(sites, journal, { recheck, trace }).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(SendUnknown);
          expect(trace.wrote).toBe(true);
        }
      }
      expect(sites.n).toBe(0);
      const open = await send(
        sites,
        memJournal({ [WRITE]: { startedAt: AT, verdict: null } }).journal,
      ).catch((e: unknown) => e);
      expect(open).toMatchObject({
        since: AT,
        reason: expect.stringContaining("nothing can tell"),
      });
    });

    it("the platform's no is a journaled SiteCallError with its status, and final", async () => {
      const { journal, rows } = memJournal();
      const no = new SiteCallError("reddit", "POST", "/api/submit", 422, "RATELIMIT");
      const trace: SendTrace = { wrote: false };
      const err = await send(direct(no), journal, { trace }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SiteCallError);
      expect(err).toMatchObject({ status: 422, journaled: true });
      expect(trace.wrote).toBe(false);
      expect(rows.get(WRITE)?.verdict).toMatchObject({
        verdict: "not_sent",
        how: "refused",
        status: 422,
      });
      // A take-over under the same key: the same refusal, no second call.
      const again = direct();
      expect(await send(again, journal).catch((e: unknown) => e)).toMatchObject({ status: 422 });
      expect(again.n).toBe(0);
    });

    it("a 408 is not a refusal: it may have gone out", async () => {
      const slow = new SiteCallError("reddit", "POST", "/api/submit", 408, "timeout");
      const err = await send(direct(slow), memJournal().journal).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SendUnknown);
    });

    it("a connection that never opened is not sent, before submit", async () => {
      const refused = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
      const { journal, rows } = memJournal();
      const trace: SendTrace = { wrote: false };
      const err = await send(direct(refused), journal, { trace }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotSent);
      expect(err).toMatchObject({ how: "before_submit" });
      expect(trace.wrote).toBe(false);
      expect(rows.get(WRITE)?.verdict).toMatchObject({ verdict: "not_sent" });
    });

    it("any other failure is unknown, and a second try does not write", async () => {
      const { journal } = memJournal();
      const first = direct(new Error("socket hang up"));
      expect(await send(first, journal).catch((e: unknown) => e)).toBeInstanceOf(SendUnknown);
      expect(first.n).toBe(1);
      const second = direct();
      expect(await send(second, journal).catch((e: unknown) => e)).toBeInstanceOf(SendUnknown);
      expect(second.n).toBe(0);
    });

    it("a crash inside the step leaves an open record: the replay is unknown, never a second write", async () => {
      const { journal } = memJournal();
      const first = direct();
      const crashed: SendJournal = {
        ...journal,
        settle: async () => {
          throw new Error("worker killed");
        },
      };
      await expect(send(first, crashed)).rejects.toThrow("worker killed");
      expect(first.n).toBe(1);
      const replay = direct();
      expect(await send(replay, journal).catch((e: unknown) => e)).toBeInstanceOf(SendUnknown);
      expect(replay.n).toBe(0);
    });

    it("a lost insert race reads as the existing record", async () => {
      const racing: SendJournal = {
        begin: async () => ({
          won: false,
          record: { startedAt: AT, verdict: null },
        }),
        settle: async () => {},
        read: async () => null,
      };
      const sites = direct();
      expect(await send(sites, racing).catch((e: unknown) => e)).toBeInstanceOf(SendUnknown);
      expect(sites.n).toBe(0);
    });

    it("a second write to one route gets its own record", async () => {
      const { journal, rows } = memJournal();
      const j = journaledSites(runCtx().ctx, direct(), journal);
      await withSendKey(KEY, async () => {
        await j.call("reddit", "POST", "/api/submit");
        await j.call("reddit", "POST", "/api/submit");
      });
      expect([...rows.keys()]).toEqual([WRITE, `${WRITE} #2`]);
    });

    it("a read, a staging write and a write outside a scope keep the plain step and write no record", async () => {
      const { journal, rows } = memJournal();
      const { ctx, steps } = runCtx();
      const sites = direct();
      const j = journaledSites(ctx, sites, journal);
      await withSendKey(KEY, async () => {
        await j.call("reddit", "GET", "/api/me");
        await j.call("threads", "POST", "/me/threads", {});
      });
      await j.call("reddit", "POST", "/api/submit");
      expect(rows.size).toBe(0);
      expect(sites.n).toBe(3);
      expect(steps).toHaveLength(3);
      // Outside a scope a lost write is still unknown.
      const lost = journaledSites(ctx, direct(new Error("socket hang up")), journal);
      await expect(lost.call("reddit", "POST", "/api/submit")).rejects.toBeInstanceOf(SendUnknown);
    });

    it("verify-only reads the journal and never writes", async () => {
      const sites = direct();
      const empty = memJournal();
      const trace: SendTrace = { wrote: false };
      const none = await send(sites, empty.journal, { verifyOnly: true, trace }).catch(
        (e: unknown) => e,
      );
      expect(none).toBeInstanceOf(NotSent);
      expect(none).toMatchObject({ how: "before_submit" });
      expect(trace.wrote).toBe(false);
      expect(empty.log).toEqual([]);
      expect(empty.rows.size).toBe(0);
      const done = memJournal({
        [WRITE]: {
          startedAt: AT,
          verdict: {
            verdict: "sent",
            how: "answer",
            id: null,
            url: null,
            at: AT,
            output: { id: "t3_a" },
          },
        },
      });
      expect(await send(sites, done.journal, { verifyOnly: true })).toEqual({ id: "t3_a" });
      const open = memJournal({ [WRITE]: { startedAt: AT, verdict: null } });
      expect(
        await send(sites, open.journal, { verifyOnly: true }).catch((e: unknown) => e),
      ).toBeInstanceOf(SendUnknown);
      expect(sites.n).toBe(0);
      expect(open.log).toEqual([]);
    });
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
    expect(pub.id).toBe("urn:li:share:1");
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

  it("a verify-only publish asks each keyed write and never calls", async () => {
    const answers: Record<string, SendVerdict> = {
      found: {
        verdict: "sent",
        how: "verified",
        id: "v9",
        url: null,
        at: "2026-10-16T12:00:00.000Z",
      },
      sent: {
        verdict: "sent",
        how: "answer",
        id: null,
        url: null,
        at: "2026-10-16T12:00:00.000Z",
        output: { id: "p1" },
      },
      not_sent: { verdict: "not_sent", how: "verified_absent", reason: "not there" },
      unknown: { verdict: "unknown", reason: "lags", since: "2026-10-16T12:00:00.000Z" },
    };
    const run = async (verdict: SendVerdict, verifyOnly: boolean) => {
      const c = ctxOf(() => verdict);
      const content = makeContent((cx) => {
        const sites = restateSites(cx, { caller: "test", service: DESK });
        return {
          linkedin: {
            ...fakeContentChannel("linkedin"),
            publish: () => sites.call("linkedin", "POST", "/rest/posts", { text: "hi" }),
          },
        };
      }) as unknown as {
        service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;
      };
      const out = await content.service.publish?.(c.ctx, {
        platform: "linkedin",
        post: { text: "hi" },
        sendKey: "draft:1 k1",
        ...(verifyOnly ? { verifyOnly: true } : {}),
      });
      return { out, handlers: c.calls.map((x) => x.handler) };
    };
    expect(await run(answers.found as SendVerdict, true)).toMatchObject({
      out: { kind: "found", id: "v9" },
      handlers: ["verdict"],
    });
    expect(await run(answers.sent as SendVerdict, true)).toMatchObject({
      out: { kind: "sent", out: { id: "p1" } },
      handlers: ["verdict"],
    });
    expect(await run(answers.not_sent as SendVerdict, true)).toMatchObject({
      out: { kind: "not_sent", how: "verified_absent" },
      handlers: ["verdict"],
    });
    expect(await run(answers.unknown as SendVerdict, true)).toMatchObject({
      out: { kind: "unknown", reason: "lags" },
      handlers: ["verdict"],
    });
    // The same keyed publish without the flag calls the desk.
    expect((await run(answers.sent as SendVerdict, false)).handlers).toEqual(["call"]);
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
    // A refused token: held an hour while autobrowse makes it again.
    const login = new SiteCallError("meta", "GET", "/1/posts", 409, "was refused", "need_login");
    expect(holdCap(holds, "meta comments", login, 1_000)).toBe(true);
    expect(holds["meta comments"]).toBe(1_000 + LOGIN_HOLD_MS);
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

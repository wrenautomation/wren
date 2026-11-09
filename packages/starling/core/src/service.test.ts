import { SiteCallError } from "@wren/core/autobrowse";
import { ArmedStop, DESK, restateSites } from "@wren/core/autobrowse/restate";
import { NotSent, SendUnknown, type SendVerdict, SentFound } from "@wren/core/send-verdict";
import * as restate from "@wren/runtime";
import { describe, expect, it } from "vitest";
import { fakeContentChannel, gapStateOf } from "./index.js";
import { journaledHost, makeContent } from "./service.js";

const HANG = Symbol("hang");

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

describe("Content.arm", () => {
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
      ask: null,
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

describe("gapStateOf", () => {
  it("an access code picks the gap; uncoded, the status does", () => {
    const err = new SiteCallError("reddit", "GET", "/api/me", 401, "signed out", "need_login");
    expect(gapStateOf(err)).toBe("needs_william");
    expect(gapStateOf(new SiteCallError("x", "GET", "/", 403, "captcha", "platform_blocked"))).toBe(
      "error",
    );
    expect(gapStateOf(new SiteCallError("x", "GET", "/", 403, "no scope"))).toBe("needs_scope");
  });
});

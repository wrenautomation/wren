import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { SiteCallError } from "./autobrowse.js";
import { fakeContentChannel } from "./index.js";
import { makeContent, restateSites } from "./restate.js";

/** A stand-in Context whose `sites` client answers from a script and keeps every call. */
function ctxOf(answer: (handler: string, req: unknown) => unknown) {
  const calls: { handler: string; req: unknown }[] = [];
  const ctx = {
    serviceClient: () =>
      new Proxy(
        {},
        {
          get:
            (_t, handler: string) =>
            async (req: unknown): Promise<unknown> => {
              calls.push({ handler, req });
              return answer(handler, req);
            },
        },
      ),
  };
  return { ctx: ctx as unknown as restate.Context, calls };
}

describe("restateSites", () => {
  it("calls `sites/call` with the official shape and reads `via` from one status per site", async () => {
    const { ctx, calls } = ctxOf((h) =>
      h === "status"
        ? { routes: [{ method: "POST", path: "/rest/posts", via: "api" }] }
        : { id: "urn:li:share:1" },
    );
    const sites = restateSites(ctx);
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
    });
  });

  it("a terminal error from the worker is a SiteCallError with its status", async () => {
    const { ctx } = ctxOf(() => {
      throw new restate.TerminalError("no leg yet", { errorCode: 501 });
    });
    await expect(restateSites(ctx).call("youtube", "GET", "/youtube/v3/videos")).rejects.toSatisfy(
      (e: unknown) => e instanceof SiteCallError && e.status === 501,
    );
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

  it("an unconfigured platform is a terminal 404, not a retry", async () => {
    await expect(h.metrics?.(ctx, { platform: "youtube", id: "v" })).rejects.toMatchObject({
      name: "TerminalError",
      message: /no youtube channel/,
    });
  });
});

import { describe, expect, it } from "vitest";
import { fakeContentChannel } from "./index.js";
import { makeContent } from "./restate.js";

/** A stand-in Context: `run` calls through; every journaled step's name is kept. */
function ctxOf() {
  const steps: string[] = [];
  const ctx = {
    run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      steps.push(name);
      return fn();
    },
  };
  return { ctx: ctx as never, steps };
}

describe("Content service", () => {
  const linkedin = fakeContentChannel("linkedin");
  const svc = makeContent({ linkedin });
  const h = (
    svc as unknown as { service: Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>> }
  ).service;

  it("routes by platform, one journaled step per call", async () => {
    const { ctx, steps } = ctxOf();
    expect(await h.platforms?.(ctx)).toEqual(["linkedin"]);
    const pub = (await h.publish?.(ctx, { platform: "linkedin", post: { text: "hi" } })) as {
      id: string;
    };
    expect(pub.id).toBe("linkedin-1");
    const rows = (await h.list?.(ctx, { platform: "linkedin" })) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([pub.id]);
    await h.comments?.(ctx, { platform: "linkedin", id: pub.id });
    expect(steps).toEqual(["publish linkedin", "list linkedin", `comments linkedin ${pub.id}`]);
  });

  it("an unconfigured platform is a terminal 404, not a retry", async () => {
    const { ctx } = ctxOf();
    await expect(h.metrics?.(ctx, { platform: "youtube", id: "v" })).rejects.toMatchObject({
      name: "TerminalError",
      message: /no youtube channel/,
    });
  });
});

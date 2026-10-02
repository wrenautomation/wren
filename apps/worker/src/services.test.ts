import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as restate from "@restatedev/restate-sdk";
import { loadSettings } from "@wren/config";
import type { Logger } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { buildServices, POOL_CHAIN, servicesFor } from "./services.js";

/** A logger that keeps every line; pino's shape is all the worker uses. */
function logOf() {
  const lines: { level: string; msg: string }[] = [];
  const at =
    (level: string) =>
    (...args: unknown[]) => {
      const msg = args.find((a) => typeof a === "string");
      lines.push({ level, msg: String(msg ?? "") });
    };
  const log = { info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
  return { log: log as unknown as Logger, lines };
}

/**
 * A stand-in Context: every service client it hands out is recorded by name and
 * answers from `answer`; `ctx.run` records the step and returns `step(name)`
 * without running the closure, so no direct API is ever reached.
 */
function ctxOf(
  answer: (handler: string, req: unknown) => unknown,
  step: (name: string) => unknown,
) {
  const services: { name: string }[] = [];
  const calls: { service: string; handler: string; req: unknown }[] = [];
  const runs: string[] = [];
  const ctx = {
    run: async (name: string) => {
      runs.push(name);
      return step(name);
    },
    serviceClient: (service: { name: string }) => {
      services.push(service);
      return new Proxy(
        {},
        {
          get:
            (_t, handler: string) =>
            async (req: unknown): Promise<unknown> => {
              calls.push({ service: service.name, handler, req });
              return answer(handler, req);
            },
        },
      );
    },
  };
  return { ctx: ctx as unknown as restate.Context, services, calls, runs };
}

type Handlers = Record<string, (ctx: unknown, req?: unknown) => Promise<unknown>>;

const REDDIT_KEYS = {
  WREN_REDDIT_CLIENT_ID: "id",
  WREN_REDDIT_CLIENT_SECRET: "secret",
  WREN_REDDIT_REFRESH_TOKEN: "refresh",
  WREN_REDDIT_USERNAME: "WrenAutomation",
};

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

/** Build the worker's services from env alone (no database is reached) and return the Content handlers. */
async function contentOf(env: Record<string, string>) {
  const rootDir = mkdtempSync(join(tmpdir(), "wren-services-"));
  const settings = loadSettings(
    { WREN_DATABASE_URL: "postgres://wren:wren@127.0.0.1:1/wren", ...env },
    { rootDir },
  );
  const { log, lines } = logOf();
  const built = await buildServices(settings, log, { rootDir });
  closers.push(() => built.close());
  const svc = built.services.find((s) => s.name === "Content");
  const handlers = svc ? (svc as unknown as { service: Handlers }).service : null;
  return { handlers, lines };
}

const POST = { text: "hi", extra: { subreddit: "r/smallbusiness", title: "A title" } };

describe("contentFor: reddit", () => {
  it("without WREN_REDDIT_* goes through the Mac's desk, never waking the box", async () => {
    const { handlers, lines } = await contentOf({
      WREN_CONTENT_CHANNELS: "reddit",
      WREN_AUTOBROWSE_INSTANCE_ID: "i-0123456789abcdef0",
    });
    expect(lines).toContainEqual({
      level: "info",
      msg: "reddit through the Mac's desk worker (no WREN_REDDIT_* API client)",
    });
    expect(lines.filter((l) => l.level === "warn" && /reddit/.test(l.msg))).toEqual([]);
    const { ctx, services, calls, runs } = ctxOf(
      (h) =>
        h === "status"
          ? { routes: [{ method: "POST", path: "/api/submit", via: "browser" }] }
          : { json: { data: { id: "abc", url: "https://www.reddit.com/r/x/comments/abc" } } },
      () => {
        throw new Error("no step expected");
      },
    );
    expect(await handlers?.platforms?.(ctx)).toEqual(["reddit"]);
    const pub = (await handlers?.publish?.(ctx, { platform: "reddit", post: POST })) as {
      id: string;
      fetchedWith: string;
    };
    expect(pub).toMatchObject({ id: "abc", fetchedWith: "browser" });
    expect(services).toContainEqual({ name: "desk" });
    expect(calls.map((c) => `${c.service}/${c.handler}`)).toEqual(["desk/call", "desk/status"]);
    expect(calls[0]?.req).toMatchObject({ site: "reddit", method: "POST", path: "/api/submit" });
    expect(runs).toEqual([]);
  });

  it.each(Object.keys(REDDIT_KEYS))(
    "with %s missing it still falls back to the desk",
    async (key) => {
      const env: Record<string, string> = { WREN_CONTENT_CHANNELS: "reddit", ...REDDIT_KEYS };
      delete env[key];
      const { handlers } = await contentOf(env);
      const { ctx, calls, runs } = ctxOf(
        (h) => (h === "status" ? { routes: [] } : { json: { data: { id: "abc" } } }),
        () => {
          throw new Error("no step expected");
        },
      );
      await handlers?.publish?.(ctx, { platform: "reddit", post: POST });
      expect(calls.map((c) => c.service)).toEqual(["desk", "desk"]);
      expect(runs).toEqual([]);
    },
  );

  it("with all four WREN_REDDIT_* keys uses the direct API as journaled steps, no desk", async () => {
    const { handlers, lines } = await contentOf({
      WREN_CONTENT_CHANNELS: "reddit",
      WREN_AUTOBROWSE_INSTANCE_ID: "i-0123456789abcdef0",
      ...REDDIT_KEYS,
    });
    expect(lines.some((l) => /desk worker/.test(l.msg))).toBe(false);
    const { ctx, services, calls, runs } = ctxOf(
      () => {
        throw new Error("no service call expected");
      },
      () => ({ json: { data: { id: "abc" } } }),
    );
    const pub = (await handlers?.publish?.(ctx, { platform: "reddit", post: POST })) as {
      id: string;
      fetchedWith: string;
    };
    expect(pub).toMatchObject({ id: "abc", fetchedWith: "api" });
    expect(runs).toEqual(["reddit POST /api/submit"]);
    expect(services).not.toContainEqual({ name: "desk" });
    expect(calls).toEqual([]);
  });

  it("reddit off: no reddit channel, and no reddit log line", async () => {
    const { handlers, lines } = await contentOf({ WREN_CONTENT_CHANNELS: "linkedin" });
    const { ctx } = ctxOf(
      () => ({}),
      () => null,
    );
    expect(await handlers?.platforms?.(ctx)).toEqual(["linkedin"]);
    expect(lines.some((l) => /reddit/i.test(l.msg))).toBe(false);
    await expect(
      handlers?.publish?.(ctx, { platform: "reddit", post: POST }),
    ).rejects.toMatchObject({ name: "TerminalError", message: /no reddit channel/ });
  });

  it("the other channels still ride the box's `sites` next to a desk reddit", async () => {
    const { handlers } = await contentOf({
      WREN_CONTENT_CHANNELS: "reddit,linkedin",
      WREN_AUTOBROWSE_INSTANCE_ID: "i-0123456789abcdef0",
    });
    const { ctx, services } = ctxOf(
      () => ({}),
      () => null,
    );
    const platforms = (await handlers?.platforms?.(ctx)) as string[];
    expect([...platforms].sort()).toEqual(["linkedin", "reddit"]);
    expect(services).toEqual([{ name: "sites" }, { name: "desk" }]);
  });

  it("no box id: every channel rides the Mac's desk, nothing to wake", async () => {
    const { handlers } = await contentOf({ WREN_CONTENT_CHANNELS: "linkedin" });
    const { ctx, services, calls, runs } = ctxOf(
      (h) => (h === "status" ? { routes: [] } : { json: { id: "urn:li:share:1" } }),
      () => {
        throw new Error("no step expected");
      },
    );
    await handlers?.publish?.(ctx, { platform: "linkedin", post: POST });
    expect(services).toEqual([{ name: "desk" }]);
    expect(new Set(calls.map((c) => c.service))).toEqual(new Set(["desk"]));
    expect(runs).toEqual([]);
  });
});

describe("servicesFor: which side serves the pool chain", () => {
  const all = ["SendScheduler", ...POOL_CHAIN, "Content"].map((name) => ({ name })) as never[];
  const names = (s: { name: string }[]) => s.map((x) => x.name);

  it("the box serves only the chain", () => {
    expect(names(servicesFor(all, "box"))).toEqual(POOL_CHAIN);
  });

  it("Lambda drops the chain once the box hosts it", () => {
    expect(names(servicesFor(all, "lambda", "box"))).toEqual(["SendScheduler", "Content"]);
  });

  it("Lambda serves everything until then", () => {
    expect(servicesFor(all, "lambda", undefined)).toHaveLength(all.length);
  });
});

/**
 * Sites' A/B splits and a client's `/go/` links through the Worker, with a fake Restate and a
 * fake edge cache: a new visitor gets an arm and a cookie, the cookie keeps them on it, each arm
 * caches alone, bots get A uncounted, a cookie from an ended split is cleared; a `/go/` click is
 * counted (not a bot's) and hops to the page with its utm, never off the host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import worker from "../src/worker.js";

const HOST = "pages.acme.example";
const SPLIT = "5a1b2c3d-0000-4000-8000-000000000001";
const PERSON = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
let calls: { url: string; body: Record<string, unknown> }[];
let split: boolean;
let kept: Map<string, Response>;

const env = (): Env =>
  ({
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DEMO_HOST: "demo.wren.test",
    APP_HOST: "app.wren.test",
    RESTATE_INGRESS_URL: "https://restate.test:8080/",
    RESTATE_AUTH_TOKEN: "rt",
    AUTH_ORIGIN: "https://auth.test",
  }) as Env;

const get = (path: string, h: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`https://${HOST}${path}`, { headers: { "user-agent": PERSON, ...h } }),
    env(),
  );
const served = () => calls.filter((c) => c.url.endsWith("/Sites/serve"));

beforeEach(() => {
  calls = [];
  split = true;
  kept = new Map();
  vi.stubGlobal("caches", {
    default: {
      match: async (r: Request) => kept.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void kept.set(r.url, res),
    },
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/Domains/resolve"))
      return Response.json({ client: body.host === HOST ? "acme" : null });
    calls.push({ url, body });
    if (url.endsWith("/Sites/serveForm")) {
      const want = /^5a1b2c3d\.([AB])$/.exec(String(body.arm ?? ""))?.[1];
      const label = body.bot ? null : (want ?? "B");
      return Response.json({
        status: 200,
        html: `<form>${label ?? "A"}</form>`,
        split: label ? { id: SPLIT, label, cookie: `5a1b2c3d.${label}`, days: 30 } : null,
      });
    }
    if (url.endsWith("/Sites/serve")) {
      if (!split || body.bot) return Response.json({ status: 200, html: "<p>A</p>" });
      const want = /^5a1b2c3d\.([AB])$/.exec(String(body.arm ?? ""))?.[1];
      const label = want ?? (Number(body.roll) < 0.5 ? "A" : "B");
      return Response.json({
        status: 200,
        html: `<p>${label}</p>`,
        split: { id: SPLIT, label, cookie: `5a1b2c3d.${label}`, days: 30 },
      });
    }
    return Response.json({ kept: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("a split hosted form at the edge", () => {
  it("cookies the arm on the form's path, keeps it per arm, and still lets any site frame it", async () => {
    const res = await get("/o/f/quote");
    expect(await res.text()).toBe("<form>B</form>");
    expect(res.headers.get("set-cookie")).toMatch(/^wab=5a1b2c3d\.B; Path=\/o\/f\/quote;/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    const ask = calls.find((c) => c.url.endsWith("/Sites/serveForm"))?.body;
    expect(ask).toMatchObject({ client: "acme", slug: "quote", embed: false, bot: false });
    expect(kept.has(`https://${HOST}/o/f/quote?arm=5a1b2c3d.B`)).toBe(true);
    await get("/o/f/quote?embed=1", { cookie: "wab=5a1b2c3d.B" });
    expect(kept.has(`https://${HOST}/o/f/quote/embed?arm=5a1b2c3d.B`)).toBe(true);
  });
});

describe("a split page at the edge", () => {
  it("gives a new visitor an arm, a cookie on the page's path, and no browser cache", async () => {
    const res = await get("/o/roof-audit");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^wab=5a1b2c3d\.[AB]; Path=\/o\/roof-audit; Max-Age=2592000;/);
    expect(cookie).toContain("HttpOnly");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const ask = served()[0]?.body;
    expect(ask).toMatchObject({ client: "acme", slug: "roof-audit", arm: null, bot: false });
    expect(typeof ask?.roll).toBe("number");
    expect(kept.has(`https://${HOST}/o/roof-audit`)).toBe(false);
  });

  it("keeps a visitor on their arm, from the arm's own cached copy", async () => {
    const first = await get("/o/roof-audit", { cookie: "wab=5a1b2c3d.B" });
    expect(await first.text()).toBe("<p>B</p>");
    expect(first.headers.get("set-cookie")).toBeNull();
    expect(kept.has(`https://${HOST}/o/roof-audit?arm=5a1b2c3d.B`)).toBe(true);
    const again = await get("/o/roof-audit", { cookie: "x=1; wab=5a1b2c3d.B" });
    expect(await again.text()).toBe("<p>B</p>");
    expect(again.headers.get("cache-control")).toBe("private, no-store");
    expect(served()).toHaveLength(1);
  });

  it("serves bots A, never split, under their own key", async () => {
    const res = await get("/o/roof-audit", { "user-agent": "facebookexternalhit/1.1" });
    expect(await res.text()).toBe("<p>A</p>");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(served()[0]?.body).toMatchObject({ bot: true, arm: null });
    expect(kept.has(`https://${HOST}/o/roof-audit?bot=1`)).toBe(true);
  });

  it("clears a cookie once the split is over, and caches the page as one again", async () => {
    split = false;
    const res = await get("/o/roof-audit", { cookie: "wab=5a1b2c3d.B" });
    expect(await res.text()).toBe("<p>A</p>");
    expect(res.headers.get("set-cookie")).toMatch(/^wab=; Path=\/o\/roof-audit; Max-Age=0;/);
    expect(kept.has(`https://${HOST}/o/roof-audit`)).toBe(true);
  });

  it("caches a page with no split publicly, as before", async () => {
    split = false;
    const res = await get("/o/roof-audit");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("set-cookie")).toBeNull();
    await get("/o/roof-audit");
    expect(served()).toHaveLength(1);
  });
});

describe("a client's /go/ links", () => {
  it("counts the click and hops to the page with the utm", async () => {
    const res = await get("/go/ads/spring/120210000000001?to=/o/roof-audit", {
      referer: "https://m.facebook.com/",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/o/roof-audit?utm_source=meta&utm_medium=paid&utm_campaign=spring&utm_content=120210000000001",
    );
    const hop = calls.find((c) => c.url.endsWith("/Sites/hop"))?.body;
    expect(hop).toMatchObject({
      client: "acme",
      link: "ads",
      source: "meta",
      medium: "paid",
      campaign: "spring",
      content: "120210000000001",
      to: "/o/roof-audit",
      slug: "roof-audit",
      ref: "https://m.facebook.com/",
    });
  });

  it("doesn't count a bot, and never leaves the host", async () => {
    const res = await get("/go/ig/reel?to=https://evil.example/", {
      "user-agent": "Twitterbot/1.0",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/book?utm_source=instagram&utm_medium=organic&utm_campaign=reel",
    );
    expect(calls.some((c) => c.url.endsWith("/Sites/hop"))).toBe(false);
  });

  it("is a client host's only: the app host has no /go/", async () => {
    const res = await worker.fetch(
      new Request("https://app.wren.test/go/ads", { headers: { "user-agent": PERSON } }),
      env(),
    );
    expect(res.status).not.toBe(302);
    expect(calls.some((c) => c.url.endsWith("/Sites/hop"))).toBe(false);
  });
});

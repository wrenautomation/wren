import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { FetchError, type Fetcher, type FetchResponse } from "./fetcher.js";
import { HTTP_TIER, LadderFetcher } from "./ladder.js";
import type { LadderTier, TierMemory } from "./tier-memory.js";

const PAGE = "<html><body><p>Hello. A real page with some real words on it.</p></body></html>";
const SHELL = `<html><head>${"<script src=a.js></script>".repeat(4)}</head><body><div id="root"></div>${" ".repeat(2000)}</body></html>`;

type Plain = FetchResponse | FetchError;

/** An inner fetcher that answers each call from a script and logs the URLs. */
function inner(script: Plain[]): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    userAgent: "wren-test/0.1",
    urls,
    async get(url) {
      urls.push(url);
      const next = script.shift();
      if (!next) throw new Error("inner script ran out");
      if (next instanceof FetchError) throw next;
      return next;
    },
  };
}
const ok = (text = PAGE, status = 200): FetchResponse => ({
  status,
  url: "https://a.example/",
  text,
});

type Ask = { site: string; method: string; path: string; input: Record<string, unknown> };
type Answer = Record<string, unknown> | Error;

function sites(answers: Answer[]): SiteClient & { asked: Ask[] } {
  const asked: Ask[] = [];
  return {
    asked,
    async call(site, method, path, input = {}) {
      asked.push({ site, method, path, input });
      const next = answers.shift();
      if (!next) throw new Error("sites script ran out");
      if (next instanceof Error) throw next;
      return next as never;
    },
    async via() {
      return "api";
    },
  };
}
const fetched = (tier: LadderTier, over: Record<string, unknown> = {}) => ({
  url: "https://a.example/",
  finalUrl: "https://a.example/",
  status: 200,
  type: "text/html",
  html: PAGE,
  cut: 0,
  tier,
  block: null,
  tries: [{ tier, status: 200, block: null, ms: 5 }],
  ...over,
});

function memory(start: LadderTier | null = null) {
  const learned: Array<[string, LadderTier, string | null]> = [];
  const mem: TierMemory & { learned: typeof learned } = {
    learned,
    async startFor() {
      return start;
    },
    async learn(domain, tier, block) {
      learned.push([domain, tier, block]);
    },
  };
  return mem;
}

const URL_ = "https://www.A.example/team";

describe("LadderFetcher", () => {
  it("returns a plain page that is not blocked, without the ladder", async () => {
    const s = sites([]);
    const mem = memory();
    const resp = await new LadderFetcher(inner([ok()]), s, mem).get(URL_);
    expect(resp).toMatchObject({
      status: 200,
      tier: HTTP_TIER,
      steps: [{ tier: "plain", status: 200, block: null }],
    });
    expect(resp.block).toBeUndefined();
    expect(s.asked).toEqual([]);
    expect(mem.learned).toEqual([["a.example", "plain", null]]);
  });

  it("passes a 404 through as an answer", async () => {
    const s = sites([]);
    const resp = await new LadderFetcher(inner([ok("", 404)]), s, memory()).get(URL_);
    expect(resp.status).toBe(404);
    expect(s.asked).toEqual([]);
  });

  it("climbs to impersonate on a 403 and learns the rung", async () => {
    const s = sites([
      fetched("impersonate", {
        finalUrl: "https://a.example/team",
        tries: [{ tier: "impersonate", status: 200, block: null, ms: 9 }],
      }),
    ]);
    const mem = memory();
    const resp = await new LadderFetcher(inner([ok("no", 403)]), s, mem).get(URL_);
    expect(s.asked).toEqual([
      {
        site: "web",
        method: "GET",
        path: "/fetch",
        input: { url: URL_, from: "impersonate" },
      },
    ]);
    expect(resp).toMatchObject({
      status: 200,
      url: "https://a.example/team",
      text: PAGE,
      tier: "impersonate",
      block: "status-403",
      steps: [
        { tier: "plain", status: 403, block: "status-403" },
        { tier: "impersonate", status: 200, block: null },
      ],
    });
    expect(mem.learned).toEqual([["a.example", "impersonate", "status-403"]]);
  });

  it("climbs from render on a shell, and treats a 503 error as a block", async () => {
    const s = sites([fetched("render"), fetched("impersonate")]);
    const mem = memory();
    const ladder = new LadderFetcher(inner([ok(SHELL), new FetchError("down", 503)]), s, mem);
    const shell = await ladder.get(URL_);
    expect(s.asked[0]?.input).toEqual({ url: URL_, from: "render" });
    expect(shell).toMatchObject({ tier: "render", block: "shell" });
    const down = await ladder.get(URL_);
    expect(s.asked[1]?.input).toEqual({ url: URL_, from: "impersonate" });
    expect(down).toMatchObject({ tier: "impersonate", block: "status-503" });
  });

  it("returns the plain answer with the block and every step when the ladder is still blocked", async () => {
    const s = sites([
      fetched("exit", {
        status: 403,
        html: "no",
        block: "cloudflare",
        tries: [
          { tier: "impersonate", status: 403, block: "cloudflare", ms: 1 },
          { tier: "exit", status: 403, block: "cloudflare", ms: 1 },
        ],
      }),
    ]);
    const mem = memory();
    const resp = await new LadderFetcher(inner([ok("plain no", 403)]), s, mem).get(URL_);
    expect(resp).toMatchObject({
      status: 403,
      text: "plain no",
      tier: HTTP_TIER,
      block: "cloudflare",
      steps: [
        { tier: "plain", status: 403, block: "status-403" },
        { tier: "impersonate", status: 403, block: "cloudflare" },
        { tier: "exit", status: 403, block: "cloudflare" },
      ],
    });
    expect(mem.learned).toEqual([]);
  });

  it("throws the plain FetchError with the trail when the ladder cannot help", async () => {
    const s = sites([fetched("exit", { block: "no-exit", tries: [] })]);
    const err = await new LadderFetcher(inner([new FetchError("down", 503)]), s, memory())
      .get(URL_)
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err).toMatchObject({ status: 503, tier: HTTP_TIER, block: "no-exit" });
    expect(err.steps).toEqual([{ tier: "plain", status: 503, block: "status-503" }]);
  });

  it("falls back to the plain answer, block cap, when the ladder is over its cap", async () => {
    const cap = new SiteCallError("web", "GET", "/fetch", 429, "cap");
    const resp = await new LadderFetcher(inner([ok("no", 403)]), sites([cap]), memory()).get(URL_);
    expect(resp).toMatchObject({ status: 403, tier: HTTP_TIER, block: "cap" });
    expect(resp.steps).toEqual([
      { tier: "plain", status: 403, block: "status-403" },
      { tier: "impersonate", status: null, block: "cap" },
    ]);
  });

  it("falls back, block offline, on any other failure", async () => {
    const down = new SiteCallError("web", "GET", "/fetch", 503, "box off");
    const resp = await new LadderFetcher(inner([ok("no", 403)]), sites([down]), memory()).get(URL_);
    expect(resp).toMatchObject({ status: 403, block: "offline" });
    const lost = await new LadderFetcher(
      inner([ok("no", 403)]),
      sites([new Error("fetch failed")]),
      memory(),
    ).get(URL_);
    expect(lost).toMatchObject({ block: "offline" });
  });

  it("starts at the remembered rung and skips plain", async () => {
    const s = sites([fetched("render")]);
    const plain = inner([]);
    const mem = memory("render");
    const resp = await new LadderFetcher(plain, s, mem).get(URL_);
    expect(plain.urls).toEqual([]);
    expect(s.asked[0]?.input).toEqual({ url: URL_, from: "render" });
    expect(resp).toMatchObject({ tier: "render", steps: [{ tier: "render", status: 200 }] });
    expect(resp.block).toBeNull();
    expect(mem.learned).toEqual([["a.example", "render", null]]);
  });

  it("learns the block that made a remembered rung climb higher", async () => {
    const s = sites([
      fetched("exit", {
        tries: [
          { tier: "render", status: 403, block: "turnstile", ms: 1 },
          { tier: "exit", status: 200, block: null, ms: 1 },
        ],
      }),
    ]);
    const mem = memory("render");
    await new LadderFetcher(inner([]), s, mem).get(URL_);
    expect(mem.learned).toEqual([["a.example", "exit", "turnstile"]]);
  });

  it("falls back to plain when a remembered start is offline", async () => {
    const plain = inner([ok()]);
    const resp = await new LadderFetcher(
      plain,
      sites([new Error("fetch failed")]),
      memory("render"),
    ).get(URL_);
    expect(plain.urls).toEqual([URL_]);
    expect(resp).toMatchObject({ status: 200, tier: HTTP_TIER });
    expect(resp.steps).toEqual([
      { tier: "render", status: null, block: "offline" },
      { tier: "plain", status: 200, block: null },
    ]);
  });

  it("carries the block when a remembered start is offline and plain is blocked too", async () => {
    const resp = await new LadderFetcher(
      inner([ok("no", 403)]),
      sites([new Error("fetch failed")]),
      memory("exit"),
    ).get(URL_);
    expect(resp).toMatchObject({ status: 403, block: "offline" });
  });

  it("sends robots.txt to the inner fetcher only", async () => {
    const s = sites([]);
    const mem = memory("render");
    const plain = inner([ok("User-agent: *", 200)]);
    const resp = await new LadderFetcher(plain, s, mem).get("https://a.example/robots.txt");
    expect(resp.text).toBe("User-agent: *");
    expect(resp.tier).toBeUndefined();
    expect(s.asked).toEqual([]);
    expect(mem.learned).toEqual([]);
  });

  it("throws an unblocked failure with the trail and no block", async () => {
    const s = sites([]);
    const err = await new LadderFetcher(inner([new FetchError("no route", null)]), s, memory())
      .get(URL_)
      .catch((e) => e);
    expect(err).toMatchObject({ message: "no route", status: null, tier: HTTP_TIER });
    expect(err.block).toBeUndefined();
    expect(err.steps).toEqual([{ tier: "plain", status: null, block: null }]);
    expect(s.asked).toEqual([]);
  });
});

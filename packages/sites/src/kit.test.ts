/**
 * The kit's visit page list (B7), run in a bare stand-in for the browser: each load adds its
 * path to `sessionStorage`, a reload adds nothing, and a form sends the list as `pages`.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { KIT_JS } from "./kit.js";

const none = () => Object.assign([], { forEach: () => {} });

function browser(store: Map<string, string>) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const handlers: Record<string, (e: unknown) => void> = {};
  const form = {
    addEventListener: (name: string, fn: (e: unknown) => void) => {
      handlers[name] = fn;
    },
    querySelectorAll: none,
    querySelector: () => null,
    getAttribute: () => null,
    hasAttribute: () => false,
    reset: () => {},
  };
  const load = (path: string) =>
    runInNewContext(KIT_JS, {
      document: {
        currentScript: {
          src: "https://site.example.test/o/__kit.js",
          getAttribute: (k: string) => (k === "data-page" ? "page-1" : null),
          hasAttribute: () => false,
        },
        querySelectorAll: (q: string) => (q.includes("data-wren-form") ? [form] : none()),
        querySelector: () => null,
        addEventListener: () => {},
        referrer: "",
      },
      location: {
        href: `https://site.example.test${path}`,
        search: "",
        host: "site.example.test",
        pathname: path,
      },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      navigator: { sendBeacon: () => true },
      crypto: { randomUUID: () => "view-1" },
      URL,
      URLSearchParams,
      Blob,
      JSON,
      Date,
      FormData: class {
        forEach(fn: (v: string, k: string) => void) {
          fn("kim@example.test", "email");
        }
      },
      fetch: (url: string, init: { body: string }) => {
        posts.push({ url, body: JSON.parse(init.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
      innerWidth: 400,
      window: {},
      parent: null,
      self: null,
      addEventListener: () => {},
    });
  return { load, posts, submit: () => handlers.submit?.({ preventDefault: () => {} }) };
}

describe("the visit's page list", () => {
  it("adds each page once per load, skips a reload, and sends the list with a form", () => {
    const store = new Map<string, string>();
    const b = browser(store);
    b.load("/");
    b.load("/");
    b.load("/pricing");
    const kept = JSON.parse(store.get("wren_pages") ?? "[]") as { path: string; at: number }[];
    expect(kept.map((p) => p.path)).toEqual(["/", "/pricing"]);
    expect(kept.every((p) => typeof p.at === "number")).toBe(true);
    b.submit();
    const sent = b.posts.find((p) => p.url.endsWith("/o/__form"));
    expect(sent?.body.fields).toEqual({ email: "kim@example.test" });
    const pages = (sent?.body.pages ?? []) as { path: string }[];
    expect(pages.map((p) => p.path)).toEqual(["/", "/pricing"]);
  });

  it("keeps the newest 30", () => {
    const store = new Map<string, string>();
    const b = browser(store);
    for (let i = 0; i < 35; i++) b.load(`/p${i}`);
    const kept = JSON.parse(store.get("wren_pages") ?? "[]") as { path: string }[];
    expect(kept).toHaveLength(30);
    expect(kept[0]?.path).toBe("/p5");
  });
});

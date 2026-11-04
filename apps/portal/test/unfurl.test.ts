/** `/api/unfurl` (designs/2026-11-04-multi-user-runtime.md, Decision 12): head fields, refusals, inline images. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchable, headOf, preview, unfurl } from "../src/unfurl.js";

afterEach(() => vi.unstubAllGlobals());

const PAGE = `<!doctype html><html><head>
<title> Plain  title </title>
<meta name="description" content="The meta line.">
<meta property="og:title" content="Open &amp; graph title">
<meta property="og:image" content="/img/card.png">
<link rel="shortcut icon" href="/fav.png">
</head><body><meta property="og:description" content="from the body, ignored"></body></html>`;

describe("headOf", () => {
  it("takes og fields first and makes addresses whole", () => {
    expect(headOf(PAGE, "https://site.example/a/b")).toEqual({
      title: "Open & graph title",
      line: "The meta line.",
      image: "https://site.example/img/card.png",
      icon: "https://site.example/fav.png",
    });
  });
  it("falls back to <title> and /favicon.ico", () => {
    expect(headOf("<title>Only</title>", "https://x.example/p")).toEqual({
      title: "Only",
      icon: "https://x.example/favicon.ico",
    });
  });
  it("drops a javascript: image", () => {
    const h = headOf(
      `<meta property="og:image" content="javascript:alert(1)">`,
      "https://x.example/",
    );
    expect(h.image).toBeUndefined();
  });
});

describe("fetchable", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "https://site.example:8443/",
    "https://u:p@site.example/",
    "ftp://site.example/",
    "file:///etc/passwd",
    "https://printer.local/",
    "not a url",
  ])("refuses %s", (u) => expect(fetchable(u)).toBeNull());
  it("takes a plain https page", () =>
    expect(fetchable("https://site.example/a?b=1")?.host).toBe("site.example"));
});

describe("preview", () => {
  it("inlines the image and icon as data: URLs", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal("fetch", async (u: URL) => {
      const s = String(u);
      if (s === "https://www.site.example/")
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response(png, { headers: { "content-type": "image/png" } });
    });
    const p = await preview(new URL("https://www.site.example/"));
    expect(p.host).toBe("site.example");
    expect(p.title).toBe("Open & graph title");
    expect(p.image).toBe("data:image/png;base64,iVBORw==");
    expect(p.icon).toBe("data:image/png;base64,iVBORw==");
  });
  it("drops an image over its cap", async () => {
    vi.stubGlobal("fetch", async (u: URL) =>
      String(u).endsWith("/")
        ? new Response(PAGE, { headers: { "content-type": "text/html" } })
        : new Response(new Uint8Array(400 * 1024), { headers: { "content-type": "image/png" } }),
    );
    const p = await preview(new URL("https://site.example/"));
    expect(p.image).toBeUndefined();
    expect(p.icon).toBeUndefined();
  });
  it("gives the host alone for a non-HTML answer or a failure", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(await preview(new URL("https://site.example/x"))).toEqual({
      url: "https://site.example/x",
      host: "site.example",
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await preview(new URL("https://site.example/x"))).toEqual({
      url: "https://site.example/x",
      host: "site.example",
    });
  });
});

describe("unfurl route", () => {
  const ok = { signedIn: async () => "amy@wren.example", capped: async () => false };
  const get = (u: string) =>
    new Request(`https://app.test/api/unfurl?url=${encodeURIComponent(u)}`);
  it("refuses a stranger", async () => {
    const r = await unfurl(get("https://site.example/"), {
      ...ok,
      signedIn: async () => new Response(null, { status: 401 }),
    });
    expect(r.status).toBe(401);
  });
  it("refuses a private address", async () => {
    expect((await unfurl(get("http://127.0.0.1/"), ok)).status).toBe(400);
  });
  it("refuses past the cap", async () => {
    expect(
      (await unfurl(get("https://site.example/"), { ...ok, capped: async () => true })).status,
    ).toBe(429);
  });
  it("answers a preview", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<title>T</title>", { headers: { "content-type": "text/html" } }),
    );
    const r = await unfurl(get("https://site.example/"), ok);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ host: "site.example", title: "T" });
  });
});

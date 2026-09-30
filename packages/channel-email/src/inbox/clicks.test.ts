/** The lander export reader: paging, and the credential failure named without the secret. */
import { describe, expect, it } from "vitest";
import { SITE_PAGE, SiteExportError, siteExport } from "./clicks.js";

const hit = (id: number) => ({
  id,
  ts: "2026-09-29T00:00:00Z",
  visitor: "v1",
  page: "/",
  secs: 3,
  cta: 0,
  touched: 0,
  r: "",
});

describe("siteExport", () => {
  it("pages forward by id until a short page", async () => {
    const asked: string[] = [];
    const rows = await siteExport("hits", {
      baseUrl: "https://site.test/",
      exportToken: "t0ken",
      fetch: async (url, init) => {
        asked.push(url);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
        const since = Number(new URL(url).searchParams.get("since"));
        const n = since === 0 ? SITE_PAGE : 2;
        return Response.json({ hits: Array.from({ length: n }, (_, i) => hit(since + i + 1)) });
      },
    });
    expect(rows).toHaveLength(SITE_PAGE + 2);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe(`https://site.test/api/export?table=hits&since=0&limit=${SITE_PAGE}`);
    expect(new URL(asked[1] as string).searchParams.get("since")).toBe(String(SITE_PAGE));
  });
  it("names a rejected credential without quoting it", async () => {
    const err = await siteExport("applications", {
      baseUrl: "https://site.test",
      exportToken: "t0ken",
      fetch: async () => new Response(null, { status: 401 }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteExportError);
    expect(String(err)).toContain("WREN_SITE_EXPORT_TOKEN");
    expect(String(err)).not.toContain("t0ken");
  });
});

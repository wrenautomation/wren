import { describe, expect, it } from "vitest";
import { landerVisits, visitorsOf } from "./site.js";

const app = (id: number, visitor: string | null, email: string) =>
  ({ id, ts: "2026-10-01T00:00:00Z", visitor, offer: "o", fit: 1, r: "", email }) as const;

describe("visitorsOf", () => {
  it("takes the visitors who applied with the email, any case, newest first, once", () => {
    const apps = [
      app(1, "v1", "Pat@Firm.example"),
      app(2, "v2", "other@x.example"),
      app(3, "v3", "pat@firm.example "),
      app(4, "v1", "pat@firm.example"),
      app(5, null, "pat@firm.example"),
    ];
    expect(visitorsOf(apps, "pat@firm.example")).toEqual(["v1", "v3"]);
  });
});

describe("landerVisits", () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    applications: [app(1, "v1", "pat@firm.example")],
    hits: [
      { id: 1, ts: "2026-10-02T10:00:00Z", view: "a", visitor: "v1", page: "/pricing", secs: 40 },
      { id: 2, ts: "2026-10-03T10:00:00Z", view: "b", visitor: "v1", page: "/pricing", secs: 50 },
      { id: 3, ts: "2026-10-03T11:00:00Z", view: "c", visitor: "v1", page: "/", secs: 0 },
    ],
    replays: [
      {
        id: 1,
        view: "b",
        visitor: "v1",
        page: "/pricing",
        started: "2026-10-03T10:00:00Z",
        last: "2026-10-03T10:03:00Z",
      },
    ],
  };
  const asked: string[] = [];
  const fetch = async (url: string) => {
    const u = new URL(url);
    const table = u.searchParams.get("table") as string;
    asked.push(`${table}:${u.searchParams.get("visitor") ?? ""}`);
    return new Response(JSON.stringify({ [table]: tables[table] ?? [] }), { status: 200 });
  };

  it("pages seen most, then sessions; each with its source and day", async () => {
    const site = { baseUrl: "https://site.example", exportToken: "t", fetch };
    expect(await landerVisits(site)("pat@firm.example")).toEqual([
      {
        text: "Saw /pricing twice, 2 min in all",
        source: "site.example",
        href: "https://site.example/pricing",
        at: "2026-10-03",
      },
      {
        text: "Saw / once",
        source: "site.example",
        href: "https://site.example/",
        at: "2026-10-03",
      },
      {
        text: "Recorded visit to /pricing, 3 min",
        source: "Sessions",
        href: "/marketing/sessions/b",
        at: "2026-10-03",
      },
    ]);
    expect(asked.sort()).toEqual(["applications:", "hits:v1", "replays:v1"]);
  });

  it("nobody applied with the email, or the site is down: nothing", async () => {
    const site = { baseUrl: "https://site.example", exportToken: "t", fetch };
    expect(await landerVisits(site)("nobody@x.example")).toEqual([]);
    const down = { ...site, fetch: async () => new Response(null, { status: 503 }) };
    expect(await landerVisits(down)("pat@firm.example")).toEqual([]);
  });
});

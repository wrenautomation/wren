import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { eventDate, readEvents, searchEvents } from "./events.js";

const NOW = new Date("2026-10-06T12:00:00Z");
const firm = { name: "Acme Staffing LLC", domain: "acmestaffing.example" };

describe("eventDate", () => {
  it("reads Google's printed dates, its 'ago' dates and Exa's ISO dates", () => {
    expect(eventDate("Aug 21, 2026", NOW)).toBe("2026-08-21");
    expect(eventDate("Sept 3, 2026", NOW)).toBe("2026-09-03");
    expect(eventDate("3 days ago", NOW)).toBe("2026-10-03");
    expect(eventDate("2 weeks ago", NOW)).toBe("2026-09-22");
    expect(eventDate("5 hours ago", NOW)).toBe("2026-10-06");
    expect(eventDate("2026-07-01T00:00:00.000Z", NOW)).toBe("2026-07-01");
    expect(eventDate("last spring", NOW)).toBeNull();
    expect(eventDate(null, NOW)).toBeNull();
  });
});

describe("readEvents", () => {
  const hit = (
    title: string,
    date: string | null,
    url = `https://news.example/${title.length}`,
  ) => ({
    title,
    url,
    snippet: null,
    date,
  });

  it("keeps dated events about the firm in the last 6 months, by kind", () => {
    const events = readEvents(
      [
        hit("Acme Staffing acquired by Globex", "Aug 21, 2026"),
        hit("Acme Staffing and Initech merge", "3 days ago"),
        hit("Acme Staffing raises $12M Series B", "2026-06-01"),
        hit("Acme Staffing appoints Jane Roe as CEO", "Sep 1, 2026"),
      ],
      firm,
      "google",
      NOW,
    );
    expect(events.map((e) => [e.kind, e.date])).toEqual([
      ["acquisition", "2026-08-21"],
      ["merger", "2026-10-03"],
      ["funding", "2026-06-01"],
      ["leader", "2026-09-01"],
    ]);
  });

  it("never a rename, an undated or old hit, or one about another firm", () => {
    expect(
      readEvents(
        [
          hit("Acme Staffing rebrands as Acme Talent", "Sep 1, 2026"),
          hit("Acme Staffing acquired by Globex", null),
          hit("Acme Staffing acquired by Globex", "Jan 5, 2026"),
          hit("Acme Staffingworks acquires Initech", "Sep 1, 2026"),
          hit("Globex acquires Initech", "Sep 1, 2026"),
        ],
        firm,
        "google",
        NOW,
      ),
    ).toEqual([]);
  });

  it("a hit on the firm's own site counts without its name", () => {
    const events = readEvents(
      [
        hit(
          "We merged with Initech",
          "Sep 1, 2026",
          "https://www.acmestaffing.example/news/merger",
        ),
      ],
      firm,
      "google",
      NOW,
    );
    expect(events).toHaveLength(1);
  });
});

function fakeSites(routes: Record<string, (input: Record<string, unknown>) => unknown>) {
  const keys: string[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      const key = `${site} ${method} ${path}`;
      keys.push(key);
      const h = routes[key];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return h(input as Record<string, unknown>) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, keys };
}
const opts = { now: () => NOW, sleep: async () => {} };

describe("searchEvents", () => {
  it("Google first; Exa never asked when Google answered", async () => {
    const { sites, keys } = fakeSites({
      "web GET /google": () => ({
        results: [
          {
            title: "Acme Staffing acquired by Globex",
            url: "https://n.example/1",
            date: "Aug 21, 2026",
          },
        ],
      }),
    });
    const r = await searchEvents(sites, firm, { google: true, ...opts });
    expect(r).toMatchObject({ state: "found", googleStopped: false });
    expect(r.events[0]).toMatchObject({ kind: "acquisition", source: "google" });
    expect(keys).toEqual(["web GET /google"]);
  });

  it("Google stopped: Exa's search reads its publishedDate", async () => {
    const { sites, keys } = fakeSites({
      "web GET /google": () => {
        throw new SiteCallError("web", "GET", "/google", 503, "sorry page");
      },
      "web GET /search": (input) => {
        expect(input.via).toBe("exa");
        return {
          results: [
            {
              title: "Acme Staffing raises $12M",
              url: "https://n.example/2",
              raw: { publishedDate: "2026-09-10T00:00:00.000Z" },
            },
          ],
        };
      },
    });
    const r = await searchEvents(sites, firm, { google: true, ...opts });
    expect(r).toMatchObject({ state: "found", googleStopped: true });
    expect(r.events[0]).toMatchObject({ kind: "funding", date: "2026-09-10", source: "exa" });
    expect(keys).toEqual(["web GET /google", "web GET /search"]);
  });

  it("Exa's daily cap parks the firm until it lifts", async () => {
    const { sites } = fakeSites({
      "web GET /search": () => {
        throw new SiteCallError("web", "GET", "/search", 429, "exa capped, retry after 36000s");
      },
    });
    const r = await searchEvents(sites, firm, { google: false, ...opts });
    expect(r.state).toBe("capped");
    expect(r.retryAt?.getTime()).toBe(NOW.getTime() + 36_000_000);
  });
});

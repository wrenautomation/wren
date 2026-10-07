import { describe, expect, it } from "vitest";
import { directCall, directRefusal, isExaRoute } from "./vendor-direct.js";

const KEY = "synthetic-own-key-1234ABCD";

function fake(body: unknown, status = 200) {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), { status });
  };
  return { seen, fetch };
}

const PROFILE = [
  "# Avery Quinlan",
  "Head of Talent at Northwind",
  "Denver, Colorado, United States (US)",
  "500 connections • 1,200 followers",
  "## About",
  "Hiring engineers.",
  "## Experience",
  "### Head of Talent - [Northwind](https://www.linkedin.com/company/northwind) (Current)",
  "Jan 2024 - Present (1 year) in Denver",
  "## Education",
  "### BSc - [State U](https://www.linkedin.com/school/state-u)",
  "2014 - 2018",
].join("\n");

const COMPANY = [
  "# Northwind",
  "Northwind employs 12 people.",
  "## About",
  "Staffing.",
  "## Company Details",
  "- Industry: Staffing",
  "- Homepage: northwind.example",
  "- LinkedIn: https://www.linkedin.com/company/northwind-co",
].join("\n");

const call = (path: string, input: Record<string, unknown>, f: ReturnType<typeof fake>) =>
  directCall("exa", KEY, "web", path, input, f.fetch);

describe("Exa-backed web routes on an own key", () => {
  it("classes autobrowse's people and LinkedIn routes as Exa's, and runs them", () => {
    for (const p of ["/people", "/linkedin/posts", "/linkedin/profile", "/linkedin/company"]) {
      expect(isExaRoute("web", "GET", p)).toBe(true);
      expect(directRefusal("exa", "web", "GET", p)).toBeNull();
    }
    expect(isExaRoute("web", "GET", "/read")).toBe(false);
    expect(isExaRoute("linkedin", "GET", "/in/x")).toBe(false);
  });

  it("/people: Exa's people index, each profile parsed, the key in a header", async () => {
    const f = fake({ results: [{ url: "https://www.linkedin.com/in/avery", text: PROFILE }] });
    const a = await call("/people", { q: "recruiters at Northwind", n: 5 }, f);
    expect(a.ok).toBe(true);
    const body = a.body as { people: Record<string, unknown>[]; via: string };
    expect(body.via).toBe("exa");
    expect(body.people[0]).toMatchObject({
      name: "Avery Quinlan",
      url: "https://www.linkedin.com/in/avery",
      headline: "Head of Talent at Northwind",
      connections: "500",
      about: "Hiring engineers.",
      roles: [{ title: "Head of Talent", company: "Northwind", current: true }],
      education: [{ school: "State U", degree: "BSc", dates: "2014 - 2018" }],
    });
    expect(f.seen[0]?.url).toBe("https://api.exa.ai/search");
    expect(f.seen[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(f.seen[0]?.body).toMatchObject({ category: "people", numResults: 5 });
  });

  it("/linkedin/profile: Exa's copy only, never live; 404 when it holds none", async () => {
    const f = fake({ results: [{ text: PROFILE }], statuses: [{ status: "success" }] });
    const a = await call("/linkedin/profile", { url: "linkedin.com/in/avery?x=1" }, f);
    expect(a.body).toMatchObject({
      name: "Avery Quinlan",
      vanity: "avery",
      url: "https://www.linkedin.com/in/avery/",
      location: "Denver, Colorado, United States",
      roles: [{ dates: "Jan 2024 - Present", location: "Denver", current: true }],
    });
    expect(f.seen[0]?.url).toBe("https://api.exa.ai/contents");
    expect(f.seen[0]?.body).toMatchObject({
      urls: ["https://www.linkedin.com/in/avery"],
      livecrawl: "never",
    });
    const none = fake({ statuses: [{ status: "error", error: { httpStatusCode: 404 } }] });
    expect(
      await call("/linkedin/profile", { url: "https://linkedin.com/in/nobody" }, none),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    expect((await call("/linkedin/profile", { url: "https://example.com/x" }, none)).status).toBe(
      400,
    );
  });

  it("/linkedin/company: the page's facts and handle", async () => {
    const f = fake({ results: [{ text: COMPANY }], statuses: [{ status: "success" }] });
    const a = await call(
      "/linkedin/company",
      { url: "https://www.linkedin.com/company/northwind" },
      f,
    );
    expect(a.body).toMatchObject({
      name: "Northwind",
      industry: "Staffing",
      website: "https://northwind.example",
      employees: 12,
      handle: "northwind-co",
      url: "https://www.linkedin.com/company/northwind-co/",
    });
  });

  it("/linkedin/posts: limited to linkedin.com/posts, since a date", async () => {
    const f = fake({
      results: [
        {
          url: "https://www.linkedin.com/posts/avery_hiring",
          title: "Hiring",
          text: "We're hiring",
        },
        { url: "https://example.com/blog", text: "no" },
      ],
    });
    const a = await call("/linkedin/posts", { q: "Avery Northwind", since: "2026-09-01" }, f);
    expect((a.body as { posts: { url: string }[] }).posts.map((p) => p.url)).toEqual([
      "https://www.linkedin.com/posts/avery_hiring",
    ]);
    expect(f.seen[0]?.body).toMatchObject({
      includeDomains: ["linkedin.com/posts"],
      startPublishedDate: "2026-09-01",
    });
  });

  it("an Exa failure answers its status with no key in it", async () => {
    const f = fake({ error: "out of credits" }, 402);
    const a = await call("/people", { q: "x" }, f);
    expect(a).toMatchObject({ ok: false, status: 402 });
    expect(JSON.stringify(a.body)).not.toContain(KEY);
  });
});

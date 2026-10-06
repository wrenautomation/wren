/** The LinkedIn activity collector: synthetic people, a fake SiteClient answering autobrowse's shape. */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { signalRefusal } from "../findings.js";
import type { SignalDeps } from "./index.js";
import { type ActivityItem, linkedin } from "./linkedin.js";

const NOW = new Date("2026-10-06T12:00:00Z");

const personRow = (over: Record<string, unknown> = {}) => ({
  person_id: 9,
  full_name: "Test Person",
  first_name: "Test",
  last_name: "Person",
  title: "Owner",
  person_linkedin: "https://www.linkedin.com/in/Test-Person-1/",
  id: 7,
  name: "Example Staffing",
  domain: "examplestaffing.test",
  niche: null,
  country: null,
  linkedin_url: null,
  ...over,
});

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  urn: "urn:li:activity:2001",
  kind: "post",
  text: "Hiring is slow in Q4.\nHere is what we changed.",
  age: "2w",
  at: "2026-09-22T12:00:00.000Z",
  approx: true,
  reactions: 52,
  comments: 12,
  url: "https://www.linkedin.com/feed/update/urn:li:activity:2001/",
  ...over,
});

function sites(answer: () => unknown): SiteClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(site, method, path, input, account) {
      calls.push(`${site} ${method} ${path} ${JSON.stringify(input)} as ${account ?? "-"}`);
      return answer() as never;
    },
    async via() {
      return "browser";
    },
  };
}

function deps(over: Partial<SignalDeps> & { rows?: unknown[] } = {}): SignalDeps {
  const { rows = [personRow()], ...rest } = over;
  return {
    db: { execute: async () => rows } as never,
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: "linkedin@alt",
    googleLeft: 0,
    now: NOW,
    ...rest,
  };
}

const s = linkedin.settings.parse({});

describe("linkedin activity collector", () => {
  it("is built, 10 a day, every 30 days, metered, 20 items a read", () => {
    expect(linkedin).toMatchObject({ built: true, bucket: { perDay: 10 }, everyDays: 30 });
    expect(linkedin.metered).toBe(true);
    expect(s).toEqual({ max: 20 });
  });

  it("each item is a post on the person as linkedin@alt, keyed by urn, dated approx, raw whole", async () => {
    const comment = item({
      urn: "urn:li:comment:(activity:2003,9001)",
      kind: "comment",
      text: "We charge a flat fee.",
      age: "1d",
      at: "2026-10-05T12:00:00.000Z",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:2003/",
    });
    const site = sites(() => ({ activity: [item(), comment] }));
    const r = await linkedin.collect(deps({ sites: site }), "p9", s);
    expect(site.calls).toEqual([
      'linkedin GET /in/test-person-1/activity {"max":20} as linkedin@alt',
    ]);
    expect(r.state).toBe("found");
    expect(r.signals).toHaveLength(2);
    const [post, said] = r.signals;
    expect(post).toMatchObject({
      personId: 9,
      kind: "post",
      factKey: "p9:post:urn:li:activity:2001",
      via: "linkedin@alt",
      sourceUrl: "https://www.linkedin.com/feed/update/urn:li:activity:2001/",
      dated: "approx",
      signalAt: new Date("2026-09-22T12:00:00.000Z"),
      value: {
        title: "Posted: Hiring is slow in Q4. Here is what we changed.",
        topic: "post",
        age: "2w",
        reactions: 52,
        comments: 12,
        raw: item(),
      },
    });
    expect(said).toMatchObject({
      factKey: "p9:post:urn:li:comment:(activity:2003,9001)",
      value: { title: "Commented: We charge a flat fee.", topic: "comment" },
    });
    for (const d of r.signals) expect(signalRefusal(d)).toBeNull();
  });

  it("an item with no age is passed over, said in tried; no activity is none", async () => {
    const { at: _at, ...undated } = item();
    const r = await linkedin.collect(
      deps({ sites: sites(() => ({ activity: [undated] })) }),
      "p9",
      s,
    );
    expect(r.state).toBe("none");
    expect(r.tried[0]?.outcome).toBe("1 items, 1 with no urn or age");
    const empty = await linkedin.collect(deps({ sites: sites(() => ({ activity: [] })) }), "p9", s);
    expect(empty).toMatchObject({ state: "none", signals: [] });
  });

  it("never reads as Wren's or no account: unresolved with no call; his main reads as itself", async () => {
    const main = sites(() => ({ activity: [item()] }));
    await linkedin.collect(deps({ sites: main, linkedin: "linkedin" }), "p9", s);
    expect(main.calls).toEqual(['linkedin GET /in/test-person-1/activity {"max":20} as linkedin']);
    for (const account of ["linkedin@wren", null]) {
      const site = sites(() => ({ activity: [item()] }));
      const r = await linkedin.collect(deps({ sites: site, linkedin: account }), "p9", s);
      expect(site.calls).toEqual([]);
      expect(r.state).toBe("unresolved");
    }
  });

  it("a 429 is capped until the cap resets and stops the pass", async () => {
    const site = sites(() => {
      throw new SiteCallError("linkedin", "GET", "/x", 429, "retry after 43200s");
    });
    const r = await linkedin.collect(deps({ sites: site }), "p9", s);
    expect(r).toMatchObject({ state: "capped", signals: [] });
    expect(r.retryAt?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(r.stop).toMatch(/activity cap/);
  });

  it("a failed read throws, so the metered runner stops the pass; a 4xx is this person's", async () => {
    const failed = sites(() => {
      throw new SiteCallError("linkedin", "GET", "/x", 502, "no activity list");
    });
    await expect(linkedin.collect(deps({ sites: failed }), "p9", s)).rejects.toThrow(/502/);
    const refused = sites(() => {
      throw new SiteCallError("linkedin", "GET", "/x", 400, "a profile handle");
    });
    const r = await linkedin.collect(deps({ sites: refused }), "p9", s);
    expect(r).toMatchObject({ state: "unresolved", tried: [{ outcome: "refused: 400" }] });
  });

  it("a person with no /in/ link, or none at all, is unresolved", async () => {
    const site = sites(() => ({ activity: [] }));
    const bare = deps({ sites: site, rows: [personRow({ person_linkedin: null })] });
    expect((await linkedin.collect(bare, "p9", s)).tried[0]?.outcome).toBe("no /in/ link");
    expect((await linkedin.collect(deps({ sites: site, rows: [] }), "p9", s)).state).toBe(
      "unresolved",
    );
    expect(site.calls).toEqual([]);
  });

  it("subjects: people with a /in/ link, decision makers first, else the pass's order", async () => {
    const rows = [
      { id: 1, title: "Recruiter", linkedin_url: "https://www.linkedin.com/in/a-test/" },
      { id: 2, title: "Founder", linkedin_url: "https://www.linkedin.com/in/b-test/" },
      { id: 3, title: "CEO", linkedin_url: "https://www.linkedin.com/company/c-test/" },
      { id: 4, title: "Managing Partner", linkedin_url: "https://ca.linkedin.com/in/d-test" },
      { id: 5, title: "Vice President", linkedin_url: "https://www.linkedin.com/in/e-test/" },
    ];
    const db = { execute: async () => rows } as never;
    const pass = { niche: null, personIds: [1, 2, 3, 4, 5], companyIds: [] };
    expect(await linkedin.subjects?.(db, pass, s)).toEqual(["p2", "p4", "p1", "p5"]);
    expect(await linkedin.subjects?.(db, { ...pass, personIds: [] }, s)).toEqual([]);
  });
});

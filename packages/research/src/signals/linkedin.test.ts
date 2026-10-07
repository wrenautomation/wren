/** The LinkedIn activity collector: synthetic people, a fake SiteClient answering autobrowse's shape. */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { signalRefusal } from "../findings.js";
import type { SignalDeps } from "./index.js";
import { type ActivityItem, clientLinkedin, linkedin } from "./linkedin.js";

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

/** An activity id LinkedIn would mint at `iso`: epoch ms in the top bits. */
const idAt = (iso: string) => (BigInt(Date.parse(iso)) << 22n).toString();
const postUrl = (vanity: string, id: string) =>
  `https://www.linkedin.com/posts/${vanity}_hiring-update-activity-${id}-AbCd`;

type Answer = (site: string, path: string, input: unknown) => unknown;

/** A fake SiteClient: Exa and Google say nothing unless `answer` does. */
function sites(answer: Answer | (() => unknown)): SiteClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(site, method, path, input, account) {
      calls.push(`${site} ${method} ${path} ${JSON.stringify(input)} as ${account ?? "-"}`);
      const got = (answer as Answer)(site, path, input);
      if (got !== undefined) return got as never;
      if (path === "/linkedin/posts") return { posts: [] } as never;
      if (path === "/google") return { results: [] } as never;
      throw new Error(`unexpected ${site} ${path}`);
    },
    async via() {
      return "browser";
    },
  };
}

/** Only the account answers; search finds nothing. */
const accountOnly =
  (answer: () => unknown): Answer =>
  (site) =>
    site === "linkedin" ? answer() : undefined;

const EXA_CALL =
  'web GET /linkedin/posts {"q":"Test Person Example Staffing","n":10,"since":"2026-07-08"} as -';
const ACTIVITY_CALL = 'linkedin GET /in/test-person-1/activity {"max":20} as linkedin@alt';

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

describe("linkedin posts collector: search first", () => {
  const recent = idAt("2026-09-22T12:00:00.000Z");
  const older = idAt("2026-09-01T08:30:00.000Z");
  const exaPost = (vanity: string, id: string, over: Record<string, unknown> = {}) => ({
    url: postUrl(vanity, id),
    title: "Hiring update",
    author: "Test Person",
    publishedDate: "2026-09-22T00:00:00.000Z",
    text: "We placed ten engineers this quarter.",
    raw: {},
    ...over,
  });

  it("is built, 20 a day, every 30 days, metered as search, 2 recent posts enough", () => {
    expect(linkedin).toMatchObject({
      built: true,
      bucket: { perDay: 20, burst: 4 },
      everyDays: 30,
    });
    expect(linkedin.metered).toBe(true);
    expect(linkedin.vendors).toEqual(["linkedin_search"]);
    expect(s).toEqual({ max: 20, enough: 2, recentDays: 90 });
  });

  it("Exa finds enough of their own posts: no account read, dated by id, spent as search", async () => {
    const site = sites((_site, path) =>
      path === "/linkedin/posts"
        ? {
            posts: [
              exaPost("test-person-1", recent),
              exaPost("Test-Person-1", older, { text: "", title: "Our Q3 numbers" }),
              exaPost("someone-else", idAt("2026-09-23T00:00:00.000Z")),
              { ...exaPost("x", recent), url: "https://www.linkedin.com/in/test-person-1" },
            ],
          }
        : undefined,
    );
    const r = await linkedin.collect(deps({ sites: site, googleLeft: 5 }), "p9", s);
    expect(site.calls).toEqual([EXA_CALL]);
    expect(r.state).toBe("found");
    expect(r.spent).toEqual(["linkedin_search"]);
    expect(r.signals.map((d) => d.factKey)).toEqual([
      `p9:post:urn:li:activity:${recent}`,
      `p9:post:urn:li:activity:${older}`,
    ]);
    expect(r.signals[0]).toMatchObject({
      personId: 9,
      kind: "post",
      via: "exa",
      dated: "published",
      signalAt: new Date("2026-09-22T12:00:00.000Z"),
      sourceUrl: postUrl("test-person-1", recent),
      value: { title: "Posted: We placed ten engineers this quarter.", topic: "post" },
    });
    expect(r.signals[1]?.value).toMatchObject({ title: "Posted: Our Q3 numbers" });
    expect(r.tried).toContainEqual({
      step: "account",
      what: "-",
      outcome: "search found 2: not asked",
    });
    for (const d of r.signals) expect(signalRefusal(d)).toBeNull();
  });

  it("thin Exa asks Google; still thin, the account reads; its copy of a post wins", async () => {
    const site = sites((where, path) => {
      if (path === "/google")
        return {
          results: [
            { title: "Post", url: postUrl("test-person-1", recent), snippet: "From Google" },
            { title: "Other", url: postUrl("someone-else", older) },
          ],
        };
      if (where === "linkedin") return { activity: [item({ urn: `urn:li:activity:${recent}` })] };
      return undefined;
    });
    const r = await linkedin.collect(deps({ sites: site, googleLeft: 3 }), "p9", s);
    expect(site.calls).toEqual([
      EXA_CALL,
      'web GET /google {"q":"site:linkedin.com/posts/test-person-1","n":10} as -',
      ACTIVITY_CALL,
    ]);
    expect(r.spent).toEqual(["linkedin"]);
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ via: "linkedin@alt", dated: "approx" });
  });

  it("no Google left: Exa then the account", async () => {
    const site = sites(accountOnly(() => ({ activity: [item()] })));
    const r = await linkedin.collect(deps({ sites: site }), "p9", s);
    expect(site.calls).toEqual([EXA_CALL, ACTIVITY_CALL]);
    expect(r.state).toBe("found");
  });

  it("no room on the account: search only, spent as search", async () => {
    const site = sites(accountOnly(() => ({ activity: [item()] })));
    const r = await linkedin.collect(deps({ sites: site, linkedinRoom: async () => 0 }), "p9", s);
    expect(site.calls).toEqual([EXA_CALL]);
    expect(r).toMatchObject({ state: "none", spent: ["linkedin_search"] });
    expect(r.tried.at(-1)?.outcome).toBe("no account reads left today: search only");
  });

  it("a failed search is said and passed", async () => {
    const site = sites((where) => {
      if (where === "web") throw new SiteCallError("web", "GET", "/x", 404, "no such route");
      return { activity: [item()] };
    });
    const r = await linkedin.collect(deps({ sites: site }), "p9", s);
    expect(r.tried[0]).toMatchObject({ step: "exa", outcome: "refused: 404" });
    expect(r.state).toBe("found");
  });
});

describe("linkedin collector: the account fallback", () => {
  it("each item is a post on the person as linkedin@alt, keyed by urn, dated approx, raw whole", async () => {
    const comment = item({
      urn: "urn:li:comment:(activity:2003,9001)",
      kind: "comment",
      text: "We charge a flat fee.",
      age: "1d",
      at: "2026-10-05T12:00:00.000Z",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:2003/",
    });
    const site = sites(accountOnly(() => ({ activity: [item(), comment] })));
    const r = await linkedin.collect(deps({ sites: site }), "p9", s);
    expect(site.calls).toEqual([EXA_CALL, ACTIVITY_CALL]);
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
      deps({ sites: sites(accountOnly(() => ({ activity: [undated] }))) }),
      "p9",
      s,
    );
    expect(r.state).toBe("none");
    expect(r.tried.at(-1)?.outcome).toBe("1 items, 1 with no urn or age");
    const empty = await linkedin.collect(
      deps({ sites: sites(accountOnly(() => ({ activity: [] }))) }),
      "p9",
      s,
    );
    expect(empty).toMatchObject({ state: "none", signals: [] });
  });

  it("never reads as Wren's or no account: search only; his main reads as itself", async () => {
    const main = sites(accountOnly(() => ({ activity: [item()] })));
    await linkedin.collect(deps({ sites: main, linkedin: "linkedin" }), "p9", s);
    expect(main.calls).toEqual([
      EXA_CALL,
      'linkedin GET /in/test-person-1/activity {"max":20} as linkedin',
    ]);
    for (const account of ["linkedin@wren", null]) {
      const site = sites(accountOnly(() => ({ activity: [item()] })));
      const r = await linkedin.collect(deps({ sites: site, linkedin: account }), "p9", s);
      expect(site.calls).toEqual([EXA_CALL]);
      expect(r).toMatchObject({ state: "none", spent: ["linkedin_search"] });
    }
  });

  it("a client's pass reads as its own login, never Wren's outreach one", async () => {
    const own = sites(accountOnly(() => ({ activity: [item()] })));
    await linkedin.collect(
      deps({ sites: own, linkedin: null, linkedinReads: "linkedin@client-a" }),
      "p9",
      s,
    );
    expect(own.calls).toEqual([
      EXA_CALL,
      'linkedin GET /in/test-person-1/activity {"max":20} as linkedin@client-a',
    ]);
    for (const linkedinReads of ["linkedin@wren", null]) {
      const site = sites(accountOnly(() => ({ activity: [item()] })));
      const r = await linkedin.collect(
        deps({ sites: site, linkedin: "linkedin", linkedinReads }),
        "p9",
        s,
      );
      expect(site.calls).toEqual([EXA_CALL]);
      expect(r.state).toBe("none");
    }
    expect(clientLinkedin({ linkedin: " linkedin@client-a " })).toBe("linkedin@client-a");
    for (const a of ["linkedin", "linkedin@alt", "linkedin@research", "linkedin@wren", ""])
      expect(clientLinkedin({ linkedin: a })).toBeNull();
    expect(clientLinkedin({})).toBeNull();
  });

  it("an account 429 parks a person search found nothing for; never stops the pass", async () => {
    const capped = accountOnly(() => {
      throw new SiteCallError("linkedin", "GET", "/x", 429, "retry after 43200s");
    });
    const r = await linkedin.collect(deps({ sites: sites(capped) }), "p9", s);
    expect(r).toMatchObject({ state: "capped", signals: [], spent: ["linkedin_search"] });
    expect(r.retryAt?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(r.stop).toBeUndefined();
    const one = idAt("2026-09-22T12:00:00.000Z");
    const some = sites((where, path) =>
      path === "/linkedin/posts"
        ? {
            posts: [
              { url: postUrl("test-person-1", one), title: "t", publishedDate: null, text: "x" },
            ],
          }
        : capped(where, path, null),
    );
    const found = await linkedin.collect(deps({ sites: some }), "p9", s);
    expect(found).toMatchObject({ state: "found", spent: ["linkedin_search"] });
    expect(found.retryAt).toBeUndefined();
  });

  it("a failed read throws, so the metered runner stops the pass; a 4xx is this person's", async () => {
    const failed = sites(
      accountOnly(() => {
        throw new SiteCallError("linkedin", "GET", "/x", 502, "no activity list");
      }),
    );
    await expect(linkedin.collect(deps({ sites: failed }), "p9", s)).rejects.toThrow(/502/);
    const refused = sites(
      accountOnly(() => {
        throw new SiteCallError("linkedin", "GET", "/x", 400, "a profile handle");
      }),
    );
    const r = await linkedin.collect(deps({ sites: refused }), "p9", s);
    expect(r).toMatchObject({ state: "unresolved", spent: ["linkedin"] });
    expect(r.tried.at(-1)?.outcome).toBe("refused: 400");
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

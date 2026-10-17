import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { type ElsewhereSubject, nameIn, pageOf, queriesFor } from "./elsewhere.js";
import { type LookupSubject, lookUpPerson } from "./lookup.js";

type Hit = { title: string; url: string; snippet?: string };
type Route = (input: Record<string, unknown>) => unknown;

/** A SiteClient answering from a table of "site METHOD path" routes; logs every call. */
function fakeSites(routes: Record<string, Route>) {
  const calls: { key: string; input: Record<string, unknown> }[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      const key = `${site} ${method} ${path}`;
      calls.push({ key, input: input as Record<string, unknown> });
      const h = routes[key];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return h(input as Record<string, unknown>) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls, searches: () => calls.filter((c) => c.key === "web GET /search") };
}

const search = (...hits: Hit[]) => ({ hits, via: "exa" });

const who: ElsewhereSubject = {
  firstName: "Jane",
  lastName: "Doe",
  firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
  handles: [],
};

const subject = (over: Partial<LookupSubject> = {}): LookupSubject => ({
  personId: null,
  firstName: "Jane",
  lastName: "Doe",
  firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
  linkedinUrl: null,
  email: null,
  ...over,
});

describe("pageOf", () => {
  it("reads a profile page on each known platform", () => {
    const page = (url: string) => pageOf(url, "Jane Doe", who);
    expect(page("https://www.linkedin.com/in/Jane-Doe-1/")).toMatchObject({
      kind: "handle",
      platform: "linkedin",
      value: "jane-doe-1",
    });
    expect(page("https://twitter.com/janedoe/status/12")).toMatchObject({
      platform: "x",
      value: "janedoe",
    });
    expect(page("https://www.instagram.com/jane.doe/")).toMatchObject({
      platform: "instagram",
      value: "jane.doe",
    });
    expect(page("https://www.reddit.com/user/janedoe")).toMatchObject({
      platform: "reddit",
      value: "janedoe",
    });
    expect(page("https://www.youtube.com/@JaneDoe/videos")).toMatchObject({
      platform: "youtube",
      value: "@janedoe",
      url: "https://www.youtube.com/@janedoe",
    });
    expect(page("https://www.tiktok.com/@jane.doe/video/1")).toMatchObject({
      platform: "tiktok",
      value: "jane.doe",
      url: "https://www.tiktok.com/@jane.doe",
    });
    expect(page("https://www.facebook.com/jane.doe.77")).toMatchObject({
      platform: "facebook",
      value: "jane.doe.77",
      url: "https://www.facebook.com/jane.doe.77",
    });
    expect(page("https://github.com/janedoe/some-repo")).toEqual({
      kind: "link",
      platform: "github",
      value: "janedoe",
      url: "https://github.com/janedoe",
    });
    expect(page("https://www.threads.net/@janedoe")).toEqual({
      kind: "link",
      platform: "threads",
      value: "janedoe",
      url: "https://www.threads.net/@janedoe",
    });
  });

  it("drops pages that are not a person's page", () => {
    const page = (url: string) => pageOf(url, "Jane Doe", who);
    expect(page("https://www.linkedin.com/company/acme/")).toBeNull();
    expect(page("https://www.reddit.com/r/staffing/")).toBeNull();
    expect(page("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(page("https://www.facebook.com/groups/12345")).toBeNull();
    expect(page("https://github.com/orgs/acme/people")).toBeNull();
    expect(page("https://x.com/home")).toBeNull();
    expect(page("not a url")).toBeNull();
    expect(page("ftp://janedoe.com/")).toBeNull();
  });

  it("keeps a personal site only when the domain spells the name and the title is the name", () => {
    expect(pageOf("https://janedoe.com/about", "Jane Doe | About", who)).toMatchObject({
      kind: "link",
      platform: "site",
      value: "janedoe.com",
    });
    expect(pageOf("https://doeconsulting.com/", "Jane Doe - Consultant", who)).toMatchObject({
      platform: "site",
    });
    // A news site naming her is not her site.
    expect(pageOf("https://news.example.com/jane", "Jane Doe - Acme Staffing", who)).toBeNull();
    // Her name in the domain, but the page is about someone else.
    expect(pageOf("https://janedoe.com/", "John Smith | Home", who)).toBeNull();
    // The firm's own site is not hers.
    expect(
      pageOf("https://acmestaffing.com/team/jane-doe", "Jane Doe - Recruiter", {
        ...who,
        lastName: "Acme",
      }),
    ).toBeNull();
  });
});

describe("nameIn", () => {
  it("reads the name a title leads with", () => {
    expect(nameIn("Jane Doe (@janedoe) • Instagram photos and videos")).toBe("Jane Doe (@janedoe)");
    expect(nameIn("Jane Doe - Recruiter - Acme Staffing | LinkedIn")).toBe("Jane Doe");
    expect(nameIn("Jane Doe on X: hello there")).toBe("Jane Doe");
    expect(nameIn("Jane Doe | Acme")).toBe("Jane Doe");
  });
});

describe("queriesFor", () => {
  it("asks for the name and the firm, then each handle, at most three", () => {
    expect(queriesFor(who)).toEqual(["Jane Doe Acme Staffing"]);
    expect(
      queriesFor({
        ...who,
        handles: [
          { platform: "x", handle: "janedoe" },
          { platform: "instagram", handle: "janedoe" },
          { platform: "reddit", handle: "jane_d" },
          { platform: "tiktok", handle: "jd_tt" },
        ],
      }),
    ).toEqual(["Jane Doe Acme Staffing", "Jane Doe janedoe", "Jane Doe jane_d"]);
  });

  it("asks by the name alone without a firm, and by a handle without a full name", () => {
    expect(queriesFor({ ...who, firm: { name: null, domain: null } })).toEqual(["Jane Doe"]);
    expect(
      queriesFor({
        firstName: "Jane",
        lastName: null,
        firm: { name: "Acme Staffing", domain: null },
        handles: [{ platform: "x", handle: "janedoe" }],
      }),
    ).toEqual(["Jane janedoe"]);
    expect(
      queriesFor({
        firstName: null,
        lastName: null,
        firm: { name: null, domain: null },
        handles: [],
      }),
    ).toEqual([]);
  });
});

describe("lookUpPerson, elsewhere", () => {
  const routes = {
    "web GET /people": () => ({ query: "q", people: [], via: "exa" }),
  };

  it("off: makes no search call and adds nothing to the result", async () => {
    const { sites, searches } = fakeSites({
      ...routes,
      "web GET /search": () => search({ title: "Jane Doe", url: "https://x.com/janedoe" }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(searches()).toEqual([]);
    expect(r.elsewhere).toBeUndefined();
    expect(r.tried.some((t) => t.step === "elsewhere")).toBe(false);
    // The same holds when it cannot resolve anything.
    const none = await lookUpPerson(sites, subject({ lastName: null }), { linkedin: null });
    expect(searches()).toEqual([]);
    expect(none.state).toBe("unresolved");
    expect(none.elsewhere).toBeUndefined();
  });

  it("on: searches the name and firm and keeps pages by how much matched", async () => {
    const { sites, searches } = fakeSites({
      ...routes,
      "web GET /search": () =>
        search(
          {
            title: "Jane Doe - Recruiter - Acme Staffing | LinkedIn",
            url: "https://www.linkedin.com/in/jane-doe-42/",
            snippet: "Recruiter at Acme Staffing",
          },
          { title: "Jane Doe (@janedoe) on X", url: "https://x.com/janedoe" },
          { title: "John Smith", url: "https://x.com/jsmith" },
          { title: "Staffing news", url: "https://news.example.com/a" },
          { title: "Jane Doe", url: "https://github.com/janedoe" },
        ),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null, elsewhere: true });
    expect(searches().map((c) => c.input)).toEqual([{ q: "Jane Doe Acme Staffing", n: 8 }]);
    const byRef = Object.fromEntries(
      (r.elsewhere ?? []).map((h) => [`${h.platform}:${h.value}`, h]),
    );
    expect(Object.keys(byRef).sort()).toEqual([
      "github:janedoe",
      "linkedin:jane-doe-42",
      "x:janedoe",
    ]);
    // Name and firm beat name alone.
    expect(byRef["linkedin:jane-doe-42"]?.confidence).toBe(0.7);
    expect(byRef["linkedin:jane-doe-42"]?.matched).toEqual({
      name: true,
      firm: true,
      handle: false,
    });
    expect(byRef["x:janedoe"]?.confidence).toBe(0.4);
    expect(r.tried.at(-1)).toEqual({
      step: "elsewhere",
      what: "Jane Doe Acme Staffing",
      outcome: "5 results, 3 kept",
    });
  });

  it("on: a held handle in the page, with the name and the firm, is the most sure", async () => {
    const { sites, searches } = fakeSites({
      ...routes,
      "web GET /search": (input) =>
        search(
          input.q === "Jane Doe Acme Staffing"
            ? { title: "Jane Doe, Acme Staffing", url: "https://www.instagram.com/janedoe_acme/" }
            : { title: "Jane Doe", url: "https://www.reddit.com/user/janedoe_acme" },
        ),
    });
    const r = await lookUpPerson(
      sites,
      subject({ handles: [{ platform: "x", handle: "janedoe_acme" }] }),
      { linkedin: null, elsewhere: true },
    );
    expect(searches().map((c) => c.input.q)).toEqual([
      "Jane Doe Acme Staffing",
      "Jane Doe janedoe_acme",
    ]);
    const ig = r.elsewhere?.find((h) => h.platform === "instagram");
    expect(ig?.matched).toEqual({ name: true, firm: true, handle: true });
    expect(ig?.confidence).toBe(0.95);
    expect(r.elsewhere?.find((h) => h.platform === "reddit")?.confidence).toBe(0.65);
  });

  it("on: never offers back a handle we already hold", async () => {
    const { sites } = fakeSites({
      ...routes,
      "web GET /search": () => search({ title: "Jane Doe", url: "https://x.com/janedoe" }),
    });
    const r = await lookUpPerson(
      sites,
      subject({ handles: [{ platform: "x", handle: "janedoe" }] }),
      { linkedin: null, elsewhere: true },
    );
    expect(r.elsewhere).toEqual([]);
  });

  it("on: runs with no firm and with no last name", async () => {
    const { sites, searches } = fakeSites({
      "web GET /search": () => search({ title: "Jane Doe", url: "https://x.com/janedoe" }),
    });
    const noFirm = await lookUpPerson(sites, subject({ firm: { name: null, domain: null } }), {
      linkedin: null,
      elsewhere: true,
    });
    expect(noFirm.state).toBe("unresolved");
    expect(noFirm.elsewhere?.map((h) => h.value)).toEqual(["janedoe"]);
    expect(searches().map((c) => c.input.q)).toEqual(["Jane Doe"]);

    const oneWord = await lookUpPerson(
      sites,
      subject({ lastName: null, handles: [{ platform: "x", handle: "jd_77" }] }),
      { linkedin: null, elsewhere: true },
    );
    // Without a last name no page is theirs by name: the search still ran, by the handle.
    expect(searches().map((c) => c.input.q)).toEqual(["Jane Doe", "Jane jd_77"]);
    expect(oneWord.elsewhere).toEqual([]);
    expect(oneWord.tried.map((t) => t.step)).toEqual(["search", "elsewhere"]);
  });

  it("on: with nothing to search by, says so and asks nothing", async () => {
    const { sites, searches } = fakeSites({});
    const r = await lookUpPerson(
      sites,
      subject({ firstName: null, lastName: null, firm: { name: null, domain: null } }),
      { linkedin: null, elsewhere: true },
    );
    expect(searches()).toEqual([]);
    expect(r.elsewhere).toEqual([]);
    expect(r.tried.at(-1)).toEqual({
      step: "elsewhere",
      what: "-",
      outcome: "nothing to search with",
    });
  });

  it("on: a cap on the search parks the person; a refusal is a line and the rest go on", async () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const capped = fakeSites({
      ...routes,
      "web GET /search": () => {
        throw new SiteCallError("web", "GET", "/search", 429, "retry after 7200s");
      },
    });
    const c = await lookUpPerson(
      capped.sites,
      subject({ handles: [{ platform: "x", handle: "janedoe" }] }),
      { linkedin: null, elsewhere: true, now: () => now, sleep: async () => {} },
    );
    expect(c.state).toBe("capped");
    expect(c.cappedBy).toBe("web");
    expect(c.retryAt).toEqual(new Date("2026-09-29T14:00:00Z"));
    // Asked once: a cap stops the rest.
    expect(capped.searches()).toHaveLength(1);
    expect(c.tried.at(-1)?.step).toBe("capped");

    let n = 0;
    const refused = fakeSites({
      ...routes,
      "web GET /search": () => {
        n += 1;
        if (n === 1) throw new SiteCallError("web", "GET", "/search", 400, "bad query");
        return search({ title: "Jane Doe", url: "https://www.reddit.com/user/janedoe" });
      },
    });
    const r = await lookUpPerson(
      refused.sites,
      subject({ handles: [{ platform: "x", handle: "janedoe" }] }),
      { linkedin: null, elsewhere: true },
    );
    expect(r.state).toBe("unresolved");
    expect(r.tried.filter((t) => t.step === "elsewhere").map((t) => t.outcome)).toEqual([
      "refused: 400",
      "1 results, 1 kept",
    ]);
    expect(r.elsewhere?.map((h) => h.platform)).toEqual(["reddit"]);
  });

  it("on: a cap on web in the main layers skips the search", async () => {
    const { sites, searches } = fakeSites({
      "web GET /people": () => {
        throw new SiteCallError("web", "GET", "/people", 429, "retry after 7200s");
      },
      "web GET /search": () => search(),
    });
    const r = await lookUpPerson(sites, subject(), {
      linkedin: null,
      elsewhere: true,
      sleep: async () => {},
    });
    expect(r.state).toBe("capped");
    expect(searches()).toEqual([]);
    expect(r.elsewhere).toEqual([]);
  });

  it("on: a matched LinkedIn profile still comes back with the pages found elsewhere", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => ({
        query: "q",
        via: "exa",
        people: [
          {
            name: "Jane Doe",
            url: "https://www.linkedin.com/in/janedoe/",
            roles: [{ title: "Recruiter", company: "Acme Staffing", current: true }],
          },
        ],
      }),
      "web GET /search": () => search({ title: "Jane Doe", url: "https://github.com/janedoe" }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null, elsewhere: true });
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("janedoe");
    expect(r.findings.map((f) => f.kind)).toEqual(["still_there"]);
    expect(r.elsewhere?.map((h) => h.platform)).toEqual(["github"]);
    // A subject with no research row writes its findings under person 0: callers never store them.
    expect(r.findings[0]?.personId).toBe(0);
  });
});

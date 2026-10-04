/**
 * Adversarial tests for the lookup's held, Google and cache steps (R7). A false
 * match is the worst outcome; a miss is fine. Google failing must never fail
 * the lookup; Exa failing must stop the run. Tests here state what SHOULD
 * happen. A failing one is a bug, not a flaky test.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { type LookupSubject, lookUpPerson } from "./lookup.js";

type Handler = (input: Record<string, unknown>) => unknown;

function fakeSites(routes: Record<string, Handler>) {
  const calls: { key: string; input: Record<string, unknown> }[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      const key = `${site} ${method} ${path}`;
      calls.push({ key, input: input as Record<string, unknown> });
      const h = routes[key];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return (await h(input as Record<string, unknown>)) as never;
    },
    async via() {
      return "api";
    },
  };
  const keys = () => calls.map((c) => c.key);
  return { sites, calls, keys };
}

const subject = (over: Partial<LookupSubject> = {}): LookupSubject => ({
  personId: 7,
  firstName: "Jane",
  lastName: "Doe",
  firm: { name: "Acme Staffing Inc.", domain: "acmestaffing.example" },
  linkedinUrl: null,
  email: null,
  ...over,
});
type Role = { title: string; company: string; current: boolean };
const role = (title: string, company: string, current = true): Role => ({
  title,
  company,
  current,
});
/** A cached profile as `/linkedin/profile` returns it. */
const cached = (name: string, vanity: string, roles: Role[]) => ({
  name,
  vanity,
  url: `https://www.linkedin.com/in/${vanity}/`,
  roles,
  education: [],
  text: `${name}\n${roles.map((r) => `${r.title} at ${r.company}`).join("\n")}`,
  source: "exa",
});
/** A cache that holds these profiles, by vanity; anything else is a 404. */
const cache =
  (...profiles: ReturnType<typeof cached>[]): Handler =>
  (input) => {
    const p = profiles.find((x) => x.url === input.url);
    if (!p) throw new SiteCallError("web", "GET", "/linkedin/profile", 404, "no cached copy");
    return p;
  };
const serp = (...results: { title: string; url: string; snippet?: string }[]) => ({
  query: "q",
  overview: null,
  results: results.map((r, i) => ({ position: i + 1, site: "LinkedIn", shown: r.url, ...r })),
  ads: [],
  questions: [],
});
const noPeople = () => ({ people: [], via: "exa" });
const NOW = new Date("2026-10-03T15:00:00Z");
const opts = { linkedin: null, now: () => NOW, sleep: async () => {} };

describe("held links", () => {
  it("the profile we hold, read from the cache, needs only the name: no people search", async () => {
    const { sites, keys } = fakeSites({
      "web GET /linkedin/profile": cache(
        cached("Jane Doe", "jane-doe-1", [role("Recruiter", "Globex Talent")]),
      ),
    });
    const r = await lookUpPerson(
      sites,
      subject({ linkedinUrl: "https://ca.linkedin.com/in/Jane-Doe-1" }),
      opts,
    );
    expect(r.state).toBe("matched");
    expect(r.findings[0]).toMatchObject({
      kind: "job_change",
      via: "exa-cache",
      confidence: 0.8,
      value: { to: "Globex Talent" },
    });
    expect(r.findings[0]?.document?.kind).toBe("profile");
    expect(r.pages.map((p) => p.url)).toEqual(["https://www.linkedin.com/in/jane-doe-1/"]);
    expect(keys()).toEqual(["web GET /linkedin/profile"]);
  });

  it("a held profile whose cached name is someone else's is never trusted again, even by search", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": cache(
        cached("John Roe", "jane-doe-1", [role("Driver", "Globex Talent")]),
      ),
      "web GET /people": () => ({
        people: [
          {
            name: "Jane Doe",
            url: "https://www.linkedin.com/in/jane-doe-1/",
            roles: [role("Recruiter", "Globex Talent")],
          },
        ],
        via: "exa",
      }),
    });
    const r = await lookUpPerson(
      sites,
      subject({ linkedinUrl: "https://www.linkedin.com/in/jane-doe-1/" }),
      opts,
    );
    expect(r.state).toBe("unresolved");
    expect(r.findings).toEqual([]);
    // The stranger's page is still kept: nothing read is dropped.
    expect(r.pages).toHaveLength(1);
  });

  it("no cached copy of the held profile: search still trusts it on the name", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": cache(),
      "web GET /people": () => ({
        people: [
          {
            name: "Jane Doe",
            url: "https://www.linkedin.com/in/jane-doe-1/",
            roles: [role("Recruiter", "Globex Talent")],
          },
        ],
        via: "exa",
      }),
    });
    const r = await lookUpPerson(
      sites,
      subject({ linkedinUrl: "https://www.linkedin.com/in/jane-doe-1/" }),
      opts,
    );
    expect(r.state).toBe("matched");
    expect(r.findings[0]).toMatchObject({ kind: "job_change", via: "search" });
    expect(r.tried.find((t) => t.step === "cache")?.outcome).toBe("no cached copy");
  });

  it("a link on the firm's page needs a role at the firm, not just the name", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": cache(
        cached("Jane Doe", "jane-doe-2", [role("Nurse", "Initech Health")]),
        cached("Jane Doe", "jane-doe-3", [role("Recruiter", "Acme Staffing")]),
      ),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(
      sites,
      subject({
        pageLinks: [
          "https://www.linkedin.com/in/jane-doe-2",
          "https://www.linkedin.com/in/jane-doe-3",
        ],
      }),
      opts,
    );
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("jane-doe-3");
    expect(r.findings[0]).toMatchObject({ kind: "still_there", via: "exa-cache" });
    expect(r.pages).toHaveLength(2);
  });

  it("a page link alone, name matching but no role at the firm: unresolved", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": cache(
        cached("Jane Doe", "jane-doe-2", [role("Nurse", "Initech Health")]),
      ),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(
      sites,
      subject({ pageLinks: ["https://www.linkedin.com/in/jane-doe-2"] }),
      opts,
    );
    expect(r.state).toBe("unresolved");
    expect(r.findings).toEqual([]);
  });
});

describe("Google", () => {
  it("is off unless the caller allows it", async () => {
    const { sites, keys } = fakeSites({ "web GET /people": noPeople });
    await lookUpPerson(sites, subject(), opts);
    expect(keys()).toEqual(["web GET /people"]);
  });

  it("searches the name and the bare firm name; a hit naming the firm is read from the cache", async () => {
    const { sites, calls } = fakeSites({
      "web GET /google": () =>
        serp(
          {
            title: "Jane Doe - Nurse - Initech Health | LinkedIn",
            url: "https://www.linkedin.com/in/jane-doe-2",
          },
          {
            title: "Jane Doe - Recruiter - Acme Staffing | LinkedIn",
            url: "https://www.linkedin.com/in/jane-doe-3",
            snippet: "Springfield · Recruiter · Acme Staffing",
          },
        ),
      "web GET /linkedin/profile": cache(
        cached("Jane Doe", "jane-doe-3", [role("Recruiter", "Acme Staffing")]),
      ),
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(calls[0]?.input).toEqual({
      q: 'site:linkedin.com/in "Jane Doe" "Acme Staffing"',
      n: 10,
    });
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("jane-doe-3");
    // Only the hit naming the firm was read; search never ran.
    expect(calls.map((c) => [c.key, c.input.url ?? null])).toEqual([
      ["web GET /google", null],
      ["web GET /linkedin/profile", "https://www.linkedin.com/in/jane-doe-3/"],
    ]);
  });

  it("a hit with a stranger's name is never read", async () => {
    const { sites, keys } = fakeSites({
      "web GET /google": () =>
        serp({
          title: "Janet Doerr - Recruiter - Acme Staffing | LinkedIn",
          url: "https://www.linkedin.com/in/janet-doerr",
        }),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("unresolved");
    expect(keys()).toEqual(["web GET /google", "web GET /people"]);
  });

  it("a name-matched hit whose cached profile has no role at the firm stays a candidate", async () => {
    const { sites } = fakeSites({
      "web GET /google": () =>
        serp({
          title: "Jane Doe - Nurse | LinkedIn",
          url: "https://www.linkedin.com/in/jane-doe-2",
        }),
      "web GET /linkedin/profile": cache(
        cached("Jane Doe", "jane-doe-2", [role("Nurse", "Initech Health")]),
      ),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("unresolved");
    expect(r.findings).toEqual([]);
  });

  it("zero results is no answer, not an error: search runs", async () => {
    const { sites, keys } = fakeSites({
      "web GET /google": () => serp(),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(r.googleStopped).toBeNull();
    expect(keys()).toEqual(["web GET /google", "web GET /people"]);
  });

  it("a Google cap stops Google until it lifts, and the lookup goes on", async () => {
    const { sites } = fakeSites({
      "web GET /google": () => {
        throw new SiteCallError("web", "GET", "/google", 429, "cap: retry after 7200s");
      },
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("unresolved");
    expect(r.googleStopped?.until).toEqual(new Date(NOW.getTime() + 7_200_000));
    expect(r.tried.find((t) => t.step === "google")?.outcome).toMatch(/^stopped: /);
  });

  it("a sorry page or CAPTCHA (a failed read) stops Google for the day, never the lookup", async () => {
    const { sites } = fakeSites({
      "web GET /google": () => {
        throw new SiteCallError("web", "GET", "/google", 502, "captcha");
      },
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(r.state).toBe("unresolved");
    expect(r.googleStopped).toEqual({ until: null, why: expect.stringContaining("captcha") });
  });

  it("reads at most three profiles from the cache per person", async () => {
    const hits = [1, 2, 3, 4, 5].map((n) => ({
      title: `Jane Doe - Recruiter - Acme Staffing | LinkedIn`,
      url: `https://www.linkedin.com/in/jane-doe-${n}`,
    }));
    const { sites, keys } = fakeSites({
      "web GET /google": () => serp(...hits),
      "web GET /linkedin/profile": (input) =>
        cached("Jane Doe", String(input.url).split("/")[4] as string, [role("Nurse", "Initech")]),
      "web GET /people": noPeople,
    });
    const r = await lookUpPerson(sites, subject(), { ...opts, google: true });
    expect(keys().filter((k) => k === "web GET /linkedin/profile")).toHaveLength(3);
    expect(r.pages).toHaveLength(3);
  });
});

describe("Exa failing", () => {
  it("an Exa cap parks the person: the run stops asking", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": () => {
        throw new SiteCallError("web", "GET", "/linkedin/profile", 429, "retry after 30000s");
      },
    });
    const r = await lookUpPerson(
      sites,
      subject({ linkedinUrl: "https://www.linkedin.com/in/jane-doe-1/" }),
      opts,
    );
    expect(r.state).toBe("capped");
    expect(r.cappedBy).toBe("web");
  });

  it("a failed cache read is thrown, never swallowed: the runner stops the site", async () => {
    const { sites } = fakeSites({
      "web GET /linkedin/profile": () => {
        throw new SiteCallError("web", "GET", "/linkedin/profile", 502, "exa failed");
      },
    });
    await expect(
      lookUpPerson(
        sites,
        subject({ linkedinUrl: "https://www.linkedin.com/in/jane-doe-1/" }),
        opts,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
});

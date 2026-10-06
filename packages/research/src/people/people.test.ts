import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { type LookupSubject, lookUpPerson } from "./lookup.js";
import { domainLabel, isFirm, mentionsFirm, sameCompany, sameName } from "./names.js";
import { linkedinProfile } from "./profile-link.js";

describe("sameName", () => {
  const jane = { firstName: "Jane", lastName: "Doe" };
  it("matches as platforms show names", () => {
    expect(sameName(jane, "Jane Doe")).toBe(true);
    expect(sameName(jane, "Dr. Jane Doe, MBA")).toBe(true);
    expect(sameName(jane, "Jane (Smith) Doe")).toBe(true);
    expect(sameName({ firstName: "José", lastName: "Núñez" }, "Jose Nunez")).toBe(true);
    expect(sameName({ firstName: "Chris", lastName: "Lee" }, "Christopher Lee")).toBe(true);
  });
  it("never matches a stranger or half a name", () => {
    expect(sameName(jane, "Jane Smith")).toBe(false);
    expect(sameName(jane, "John Doe")).toBe(false);
    expect(sameName({ firstName: "Al", lastName: "Doe" }, "Alan Doe")).toBe(false);
    expect(sameName({ firstName: null, lastName: "Doe" }, "Jane Doe")).toBe(false);
    expect(sameName({ firstName: "Mary Jane", lastName: "Van Der Berg" }, "Mary Berg")).toBe(false);
  });
});

describe("firms", () => {
  it("reads a domain's label", () => {
    expect(domainLabel("acme-staffing.co.uk")).toBe("acme staffing");
    expect(domainLabel("www.globex.com")).toBe("globex");
  });
  it("sameCompany", () => {
    expect(sameCompany("The Acme Group, Inc.", "Acme Group")).toBe(true);
    expect(sameCompany("HireRight", "Hire Right LLC")).toBe(true);
    expect(sameCompany("Acme", "Acme Staffing Group")).toBe(true);
    expect(sameCompany("Acme Staffing", "Acme Health")).toBe(false);
    expect(sameCompany("Disney", "The Walt Disney Company")).toBe(true);
    expect(sameCompany("CBS", "Paramount")).toBe(false);
    expect(sameCompany("Inc.", "Inc.")).toBe(false);
  });
  it("mentionsFirm and isFirm", () => {
    const firm = { name: "Acme Staffing", domain: "acmestaffing.com" };
    expect(mentionsFirm("Recruiter at Acme Staffing · Toronto", firm)).toBe(true);
    expect(mentionsFirm("jane@acmestaffing.com", firm)).toBe(true);
    expect(mentionsFirm("Recruiter at Acme Staffingly", firm)).toBe(false);
    expect(isFirm("Acme Staffing Inc.", firm)).toBe(true);
    expect(isFirm("Globex", firm)).toBe(false);
  });
});

describe("profile links", () => {
  it("canonicalizes profile urls", () => {
    expect(linkedinProfile("https://ca.linkedin.com/in/Jane-Doe-123?trk=x")).toEqual({
      url: "https://www.linkedin.com/in/jane-doe-123/",
      vanity: "jane-doe-123",
    });
    expect(linkedinProfile("https://www.linkedin.com/company/acme")).toBeNull();
    expect(linkedinProfile("https://evil.com/in/jane")).toBeNull();
  });
});

type Handler = (input: Record<string, unknown>, account?: string) => unknown;

/** A SiteClient answering from a table of "site METHOD path" handlers; logs every call. */
function fakeSites(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}, account) {
      const k = `${site} ${method} ${path}`;
      calls.push(account ? `${k} @${account}` : k);
      const h = routes[k];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return (await h(input as Record<string, unknown>, account)) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

const subject = (over: Partial<LookupSubject> = {}): LookupSubject => ({
  personId: 7,
  firstName: "Jane",
  lastName: "Doe",
  firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
  linkedinUrl: null,
  email: null,
  ...over,
});
type Role = { title: string; company: string; current: boolean; companyUrl?: string | null };
const people = (...p: { name: string; url: string; roles: Role[] }[]) => ({
  query: "q",
  people: p,
  via: "exa",
});
const role = (title: string, company: string, current = true): Role => ({
  title,
  company,
  current,
});
const NOW = new Date("2026-09-29T12:00:00Z");

describe("lookUpPerson", () => {
  it("email: a rejecting mailbox says left, a live one still there, freemail nothing", async () => {
    const { sites } = fakeSites({ "web GET /people": () => people() });
    const gone = await lookUpPerson(
      sites,
      subject({ email: { address: "jane@acmestaffing.com", result: "invalid", verifier: "smtp" } }),
      { linkedin: null },
    );
    expect(gone.findings.map((f) => [f.kind, f.value.reason])).toEqual([
      ["left", "the mailbox rejects mail"],
    ]);
    const free = await lookUpPerson(
      sites,
      subject({ email: { address: "jane@gmail.com", result: "invalid", verifier: "smtp" } }),
      { linkedin: null },
    );
    expect(free.findings).toEqual([]);
  });

  it("search: a profile with a role at the firm is the match; its current role says where they are", async () => {
    const { sites, calls } = fakeSites({
      "web GET /people": () =>
        people(
          {
            name: "Jane Doe",
            url: "https://linkedin.com/in/other",
            roles: [role("Recruiter", "Other Co")],
          },
          {
            name: "Jane Doe",
            url: "https://www.linkedin.com/in/janedoe/",
            roles: [role("Account Manager", "Globex"), role("Recruiter", "Acme Staffing", false)],
          },
        ),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("janedoe");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      kind: "job_change",
      value: { from: "Acme Staffing", to: "Globex", title: "Account Manager" },
      via: "search",
      confidence: 0.8,
    });
    // Search settled it: no LinkedIn read.
    expect(calls.filter((c) => c.startsWith("linkedin"))).toEqual([]);
  });

  it("search: the query is the name and the firm", async () => {
    const { sites } = fakeSites({});
    const seen: unknown[] = [];
    const spy = {
      ...sites,
      async call(...a: Parameters<typeof sites.call>) {
        seen.push(a[3]);
        return people() as never;
      },
    };
    await lookUpPerson(spy, subject(), { linkedin: null });
    expect(seen).toEqual([{ q: "Jane Doe Acme Staffing", n: 5 }]);
  });

  it("search without a role at the firm goes to LinkedIn, and trusts the profile only with a role at the firm", async () => {
    const { sites, calls } = fakeSites({
      "web GET /people": () =>
        people(
          { name: "Jane Doe", url: "https://www.linkedin.com/in/jd1/", roles: [] },
          { name: "Jane Doe", url: "https://www.linkedin.com/in/jd2/", roles: [] },
        ),
      "linkedin GET /in/jd1": () => ({
        name: "Jane Doe",
        roles: [{ title: "Nurse", company: "General Hospital", companyUrl: "", current: true }],
      }),
      "linkedin GET /in/jd2": () => ({
        name: "Jane Doe",
        roles: [
          { title: "VP Sales", company: "Globex", companyUrl: "https://li/globex", current: true },
          { title: "Recruiter", company: "Acme Staffing Inc.", companyUrl: "", current: false },
        ],
      }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("jd2");
    expect(r.findings[0]).toMatchObject({
      kind: "job_change",
      value: { to: "Globex", companyUrl: "https://li/globex" },
      via: "linkedin@research",
      confidence: 0.9,
    });
    expect(calls).toContain("linkedin GET /in/jd1 @linkedin@research");
  });

  it("no role at the firm and no LinkedIn account: unresolved, never a guess", async () => {
    const { sites } = fakeSites({
      "web GET /people": () =>
        people({
          name: "Jane Doe",
          url: "https://www.linkedin.com/in/jd/",
          roles: [role("Recruiter", "Globex")],
        }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(r.profile).toBeNull();
    expect(r.findings).toEqual([]);
  });

  it("the profile we already hold needs no role at the firm", async () => {
    const { sites } = fakeSites({
      "web GET /people": () =>
        people({
          name: "Jane Doe",
          url: "https://www.linkedin.com/in/JaneDoe",
          roles: [role("Recruiter", "Globex")],
        }),
    });
    const r = await lookUpPerson(
      sites,
      subject({ linkedinUrl: "https://ca.linkedin.com/in/janedoe/" }),
      { linkedin: null },
    );
    expect(r.state).toBe("matched");
    expect(r.findings[0]).toMatchObject({ kind: "job_change", value: { to: "Globex" } });
  });

  it("an indexed profile with a past role at the firm and no current role: left", async () => {
    const { sites } = fakeSites({
      "web GET /people": () =>
        people({
          name: "Jane Doe",
          url: "https://www.linkedin.com/in/jd/",
          roles: [role("Recruiter", "Acme Staffing", false)],
        }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.findings[0]).toMatchObject({
      kind: "left",
      value: { reason: "no current role" },
      confidence: 0.5,
    });
  });

  it("a LinkedIn cap parks the person until the cap lifts, keeping what search found", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => people(),
      "linkedin GET /search/results/people": () => {
        throw new SiteCallError(
          "linkedin",
          "GET",
          "/search/results/people",
          429,
          "linkedin search cap for linkedin@research is used (25/25 today); retry after 600s",
        );
      },
    });
    const r = await lookUpPerson(
      sites,
      subject({ email: { address: "jane@acmestaffing.com", result: "valid", verifier: "smtp" } }),
      { linkedin: "linkedin@research", now: () => NOW },
    );
    expect(r.state).toBe("capped");
    expect(r.cappedBy).toBe("linkedin");
    expect(r.retryAt?.toISOString()).toBe("2026-09-29T12:10:00.000Z");
    expect(r.findings.map((f) => f.kind)).toEqual(["still_there"]);
  });

  it("a cap hit earlier this run parks at step 3 without asking LinkedIn", async () => {
    const until = new Date("2026-09-30T00:00:00Z");
    const { sites, calls } = fakeSites({ "web GET /people": () => people() });
    const r = await lookUpPerson(sites, subject(), {
      linkedin: "linkedin@research",
      linkedinCappedUntil: until,
      now: () => NOW,
    });
    expect(r).toMatchObject({ state: "capped", cappedBy: "linkedin", retryAt: until });
    expect(calls.every((c) => c.startsWith("web"))).toBe(true);
  });

  it("no first or last name: unresolved without a search", async () => {
    const { sites, calls } = fakeSites({});
    const r = await lookUpPerson(sites, subject({ lastName: null }), { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(calls).toEqual([]);
  });
});

describe("domainLabel by the public suffix list", () => {
  it("reads the registrable label under any suffix, private ones too", () => {
    expect(domainLabel("acme.on.ca")).toBe("acme");
    expect(domainLabel("acme-staffing.myshopify.com")).toBe("acme staffing");
    expect(domainLabel("careers.acme.com.br")).toBe("acme");
  });
});

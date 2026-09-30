/**
 * Adversarial tests for person lookup (R7). A false match, or a false fact about
 * the right person, is the worst outcome; a miss is fine. Tests here state what
 * SHOULD happen. A failing one is a bug, not a flaky test.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { emailFindings, type LookupSubject, lookUpPerson } from "./lookup.js";
import {
  companyPhrase,
  domainLabel,
  firmNames,
  isFirm,
  mentionsFirm,
  sameCompany,
  sameName,
} from "./names.js";
import { linkedinProfile } from "./profile-link.js";

type Handler = (input: Record<string, unknown>, account?: string) => unknown;

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
type Role = { title: string; company: string; current: boolean };
type Person = { name: string; url: string; headline?: string; roles: Role[] };
const people = (...p: Person[]) => ({ query: "q", people: p, via: "exa" });
const role = (title: string, company: string, current = true): Role => ({
  title,
  company,
  current,
});
const NOW = new Date("2026-09-29T12:00:00Z");

/** One indexed profile for every search. */
const oneHit = (name: string, roles: Role[], url = "https://www.linkedin.com/in/janedoe/") =>
  fakeSites({ "web GET /people": () => people({ name, url, roles }) });
const jd = (v: string, roles: Role[] = []): Person => ({
  name: "Jane Doe",
  url: `https://www.linkedin.com/in/${v}/`,
  roles,
});

// ---------------------------------------------------------------------------
// sameName
// ---------------------------------------------------------------------------

describe("sameName: false matches (worst outcome)", () => {
  it("does not match a name with first and last swapped (James Taylor vs Taylor James)", () => {
    expect(sameName({ firstName: "James", lastName: "Taylor" }, "Taylor James")).toBe(false);
  });

  it("does not match a different person whose surname starts with our first name", () => {
    // Order-blind + prefix rule: "Taylor Johnson" reads as John Taylor.
    expect(sameName({ firstName: "John", lastName: "Taylor" }, "Taylor Johnson")).toBe(false);
    expect(sameName({ firstName: "Will", lastName: "Scott" }, "Scott Williams")).toBe(false);
    expect(sameName({ firstName: "Rob", lastName: "Lee" }, "Lee Robinson")).toBe(false);
  });

  it("does not treat a different full given name as a short form (Eric vs Erica)", () => {
    expect(sameName({ firstName: "Eric", lastName: "Smith" }, "Erica Smith")).toBe(false);
    expect(sameName({ firstName: "Daniel", lastName: "Lee" }, "Danielle Lee")).toBe(false);
    expect(sameName({ firstName: "Robert", lastName: "King" }, "Roberta King")).toBe(false);
    expect(sameName({ firstName: "Paul", lastName: "Chen" }, "Paula Chen")).toBe(false);
  });

  it("holds: strangers, half names, abbreviated surnames, LinkedIn Member", () => {
    const jane = { firstName: "Jane", lastName: "Doe" };
    expect(sameName(jane, "Jane D.")).toBe(false);
    expect(sameName(jane, "LinkedIn Member")).toBe(false);
    expect(sameName(jane, "")).toBe(false);
    expect(sameName(jane, "Jane Doeman")).toBe(false);
    expect(sameName({ firstName: "Jane", lastName: "" }, "Jane Doe")).toBe(false);
    expect(sameName({ firstName: "Jane", lastName: "--" }, "Jane Doe")).toBe(false);
    expect(sameName({ firstName: "Al", lastName: "Doe" }, "Alice Doe")).toBe(false);
  });

  it("holds: inverted, credentials, emoji, casing, hyphenated names", () => {
    const jane = { firstName: "Jane", lastName: "Doe" };
    expect(sameName(jane, "Doe, Jane")).toBe(true);
    expect(sameName(jane, "JANE DOE, CPA")).toBe(true);
    expect(sameName(jane, "Jane Doe 🚀")).toBe(true);
    expect(sameName({ firstName: "Mary-Jane", lastName: "Doe" }, "Mary-Jane Doe")).toBe(true);
    expect(sameName({ firstName: "Jane", lastName: "Smith-Jones" }, "Jane Smith-Jones")).toBe(true);
    expect(sameName({ firstName: "Jane", lastName: "Smith-Jones" }, "Jane Jones")).toBe(false);
  });
});

describe("sameName: cheap false negatives", () => {
  it("matches an apostrophe surname written without it (O'Brien / OBrien)", () => {
    expect(sameName({ firstName: "Jane", lastName: "O'Brien" }, "Jane OBrien")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// firms
// ---------------------------------------------------------------------------

describe("mentionsFirm / sameCompany / domainLabel", () => {
  it("a firm domain matches as a domain, not as a substring of another domain", () => {
    const firm = { name: "Zenith Partners", domain: "acme.co" };
    expect(mentionsFirm("Contact me at jane@acme.com", firm)).toBe(false);
    const hire = { name: "Zenith Partners", domain: "hire.com" };
    expect(mentionsFirm("Recruiter at Globex · gohire.com", hire)).toBe(false);
  });

  it("legal-form words that are real name words do not merge different firms (SA vs AG)", () => {
    expect(sameCompany("SA Recruiting", "AG Recruiting")).toBe(false);
  });

  it("domainLabel of a subdomain on a short registrable name is the firm, not the subdomain", () => {
    expect(domainLabel("careers.ibm.com")).toBe("ibm");
    expect(domainLabel("jobs.abc.com")).toBe("abc");
    // so a firm on jobs.gap.com is not "named" by every snippet saying "jobs"
    expect(
      mentionsFirm("Posting new jobs daily", { name: "Gap Inc.", domain: "jobs.gap.com" }),
    ).toBe(false);
  });

  it("holds: public suffixes, www, trailing dot", () => {
    expect(domainLabel("acme.com.au")).toBe("acme");
    expect(domainLabel("acme-staffing.co.uk")).toBe("acme staffing");
    expect(domainLabel("WWW.Globex.COM")).toBe("globex");
    expect(domainLabel("acme.com.")).toBe("acme");
    expect(domainLabel("")).toBe("");
  });

  it("holds: short and legal-only firm names never become a match phrase", () => {
    expect(firmNames({ name: "HP", domain: "hp.com" })).toEqual([]);
    expect(firmNames({ name: "The Company, Inc.", domain: null })).toEqual([]);
    expect(companyPhrase("The Acme Group, Inc.")).toBe("acme group");
    expect(isFirm("Inc.", { name: "Acme", domain: null })).toBe(false);
    expect(sameCompany("", "")).toBe(false);
  });

  it("holds: whole-word firm phrase, accents folded", () => {
    const firm = { name: "Société Générale", domain: null };
    expect(mentionsFirm("Analyst at Societe Generale · Paris", firm)).toBe(true);
    expect(mentionsFirm("Analyst at SocieteGenerale", firm)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// profile links
// ---------------------------------------------------------------------------

describe("linkedinProfile", () => {
  it("does not merge two member-id URLs that differ only by case", () => {
    // LinkedIn search rows for out-of-network people link /in/ACoAA… ids, which are case-sensitive.
    const a = linkedinProfile("https://www.linkedin.com/in/ACoAAAbCdEf");
    const b = linkedinProfile("https://www.linkedin.com/in/ACoAAABcDeF");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.vanity).not.toBe(b?.vanity);
  });

  it("holds: never throws, rejects lookalike hosts, canonicalizes", () => {
    for (const bad of [
      "",
      "not a url",
      "https://www.linkedin.com/in/%E0%A4%A",
      "https://linkedin.com.evil.com/in/jane",
      "https://notlinkedin.com/in/jane",
      "https://www.linkedin.com@evil.com/in/jane",
      "https://evil.com/?u=https://www.linkedin.com/in/jane",
      "https://www.linkedin.com/in/",
      "https://www.linkedin.com/in/j",
      "https://www.linkedin.com/pub/jane-doe/1/2/3",
      "javascript:alert(1)//linkedin.com/in/jane",
    ])
      expect(() => linkedinProfile(bad)).not.toThrow();
    expect(linkedinProfile("https://linkedin.com.evil.com/in/jane")).toBeNull();
    expect(linkedinProfile("https://www.linkedin.com@evil.com/in/jane")).toBeNull();
    expect(linkedinProfile("https://evil.com/?u=https://www.linkedin.com/in/jane")).toBeNull();
    expect(linkedinProfile("http://linkedin.com/in/jane-doe/details/experience/?x=1")?.url).toBe(
      "https://www.linkedin.com/in/jane-doe/",
    );
    expect(linkedinProfile("https://www.linkedin.com/in/józef-nowak")?.vanity).toBe(
      linkedinProfile("https://www.linkedin.com/in/J%C3%B3zef-Nowak/")?.vanity,
    );
  });
});

// ---------------------------------------------------------------------------
// emailFindings
// ---------------------------------------------------------------------------

describe("emailFindings", () => {
  it("a live mailbox at another firm's domain does not say they are still at this firm", () => {
    const f = emailFindings(
      subject({ email: { address: "jane@globex.com", result: "valid", verifier: "smtp" } }),
    );
    expect(f.filter((x) => x.kind === "still_there")).toEqual([]);
  });

  it("a typo domain the local check rejects does not say they left", () => {
    const f = emailFindings(
      subject({ email: { address: "jane@acmestafing.com", result: "invalid", verifier: "local" } }),
    );
    expect(f.filter((x) => x.kind === "left")).toEqual([]);
  });

  it("holds: malformed and freemail addresses give nothing; risky gives nothing", () => {
    expect(
      emailFindings(subject({ email: { address: "jane", result: "invalid", verifier: "smtp" } })),
    ).toEqual([]);
    expect(
      emailFindings(subject({ email: { address: "jane@", result: "invalid", verifier: "smtp" } })),
    ).toEqual([]);
    expect(
      emailFindings(
        subject({ email: { address: "jane@GMAIL.com", result: "valid", verifier: "smtp" } }),
      ),
    ).toEqual([]);
    expect(
      emailFindings(
        subject({ email: { address: "jane@acmestaffing.com", result: "risky", verifier: "smtp" } }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lookUpPerson: false matches and false facts end to end
// ---------------------------------------------------------------------------

describe("lookUpPerson: false match", () => {
  it("a firm named after the person's surname is not matched by their own name", async () => {
    // Jane Doe at "Doe LLC": a nurse called Jane Doe is a stranger.
    const { sites } = oneHit(
      "Jane Doe",
      [role("Nurse", "General Hospital")],
      "https://www.linkedin.com/in/nurse-jane-doe/",
    );
    const r = await lookUpPerson(sites, subject({ firm: { name: "Doe LLC", domain: null } }), {
      linkedin: null,
    });
    expect(r.state).toBe("unresolved");
    expect(r.findings.filter((f) => f.kind === "job_change")).toEqual([]);
  });

  it("a swapped-name stranger at the firm is not trusted (John Taylor vs Taylor Johnson)", async () => {
    const { sites } = oneHit(
      "Taylor Johnson",
      [role("Account Manager", "Globex"), role("Recruiter", "Acme Staffing", false)],
      "https://www.linkedin.com/in/taylorjohnson/",
    );
    const r = await lookUpPerson(sites, subject({ firstName: "John", lastName: "Taylor" }), {
      linkedin: null,
    });
    expect(r.state).toBe("unresolved");
    expect(r.profile).toBeNull();
  });

  it("the firm named only in a title at another company does not tie a namesake to it", async () => {
    const { sites } = oneHit("Jane Doe", [
      role("Recruiter placing nurses at Acme Staffing", "Globex"),
    ]);
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.state).toBe("unresolved");
    expect(r.findings).toEqual([]);
  });

  it("the firm named only in a headline does not tie a namesake to it", async () => {
    const { sites } = fakeSites({
      "web GET /people": () =>
        people({
          ...jd("janedoe", [role("Nurse", "General Hospital")]),
          headline: "ex-Acme Staffing",
        }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.state).toBe("unresolved");
  });
});

describe("lookUpPerson: false facts about the right person", () => {
  it("two current roles, one at the firm: still there, not moved", async () => {
    const { sites } = oneHit("Jane Doe", [
      role("Advisor", "Globex"),
      role("Senior Recruiter", "Acme Staffing Inc."),
    ]);
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.findings.map((f) => f.kind)).toEqual(["still_there"]);
  });

  it("a past role at the firm and a current one elsewhere is a move, to the current one", async () => {
    const { sites } = oneHit("Jane Doe", [
      role("Recruiter", "Acme Staffing", false),
      role("Talent Lead", "Globex"),
      role("Coordinator", "Initech", false),
    ]);
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.findings[0]).toMatchObject({
      kind: "job_change",
      value: { from: "Acme Staffing", to: "Globex", title: "Talent Lead" },
    });
  });

  it("an indexed match is trusted less than a logged-in read", async () => {
    const { sites } = oneHit("Jane Doe", [role("Recruiter", "Acme Staffing")]);
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.findings[0]?.confidence).toBeLessThan(0.9);
  });

  it("an indexed match settles it: no LinkedIn read spent", async () => {
    const { sites, calls } = oneHit("Jane Doe", [role("Recruiter", "Acme Staffing")]);
    await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(calls.filter((c) => c.startsWith("linkedin"))).toEqual([]);
  });

  it("a profile read with no roles at all does not say they left", async () => {
    // Search matched the name only; the read returns no roles.
    const { sites } = fakeSites({
      "web GET /people": () => people(jd("janedoe")),
      "linkedin GET /in/janedoe": () => ({ name: "Jane Doe" }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.findings.filter((f) => f.kind === "left")).toEqual([]);
  });

  it("a name-only search match the logged-in read contradicts (different name) is not matched", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => people(jd("janedoe")),
      "linkedin GET /in/janedoe": () => ({
        name: "Priya Patel",
        roles: [{ title: "Engineer", company: "Initech", companyUrl: "", current: true }],
      }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.state).not.toBe("matched");
    expect(r.profile).toBeNull();
  });

  it("holds: a person search with no LinkedIn url, or a malformed one, is skipped", async () => {
    const { sites } = fakeSites({
      "web GET /people": () =>
        people(
          {
            name: "Jane Doe",
            url: "https://example.com/jane",
            roles: [role("Recruiter", "Acme Staffing")],
          },
          { name: "Jane Doe", url: "not a url", roles: [role("Recruiter", "Acme Staffing")] },
        ),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: null });
    expect(r.state).toBe("unresolved");
  });
});

describe("lookUpPerson: caps and reads", () => {
  it("does not spend a LinkedIn search when the profile-read budget is already used", async () => {
    const maybes = ["jd1", "jd2", "jd3", "jd4"];
    const routes: Record<string, Handler> = {
      "web GET /people": () => people(...maybes.map((v) => jd(v))),
      "linkedin GET /search/results/people": () => ({
        people: [
          { name: "Jane Doe", url: "https://www.linkedin.com/in/jd9/", headline: "Acme Staffing" },
        ],
      }),
    };
    for (const v of maybes)
      routes[`linkedin GET /in/${v}`] = () => ({
        name: "Jane Doe",
        roles: [{ title: "Nurse", company: "General Hospital", companyUrl: "", current: true }],
      });
    const { sites, calls } = fakeSites(routes);
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(calls.filter((c) => c.startsWith("linkedin GET /in/"))).toHaveLength(3);
    expect(r.state).toBe("unresolved");
    expect(calls.filter((c) => c.startsWith("linkedin GET /search/results/people"))).toEqual([]);
  });

  it("holds: a profile-read 429 parks the person with retryAt from the message", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => people(jd("jd1")),
      "linkedin GET /in/jd1": () => {
        throw new SiteCallError("linkedin", "GET", "/in/jd1", 429, "cap used; retry after 1200s");
      },
    });
    const r = await lookUpPerson(sites, subject(), {
      linkedin: "linkedin@research",
      now: () => NOW,
    });
    expect(r).toMatchObject({ state: "capped", cappedBy: "linkedin" });
    expect(r.retryAt?.toISOString()).toBe("2026-09-29T12:20:00.000Z");
  });

  it("holds: a web 429 with no retry-after parks for an hour, capped by web", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => {
        throw new SiteCallError("web", "GET", "/people", 429, "slow down");
      },
    });
    const r = await lookUpPerson(sites, subject(), {
      linkedin: "linkedin@research",
      now: () => NOW,
    });
    expect(r).toMatchObject({ state: "capped", cappedBy: "web" });
    expect(r.retryAt?.toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });

  it("holds: a refused profile read (403) moves on to the next candidate", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => people(jd("jd1"), jd("jd2")),
      "linkedin GET /in/jd1": () => {
        throw new SiteCallError("linkedin", "GET", "/in/jd1", 403, "private");
      },
      "linkedin GET /in/jd2": () => ({
        name: "Jane Doe",
        roles: [{ title: "Recruiter", company: "Acme Staffing", companyUrl: "", current: true }],
      }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.state).toBe("matched");
    expect(r.profile?.vanity).toBe("jd2");
    expect(r.findings.map((f) => f.kind)).toEqual(["still_there"]);
  });

  it("holds: a stranger with the same name and no role at the firm is never trusted via LinkedIn search", async () => {
    const { sites } = fakeSites({
      "web GET /people": () => people(),
      "linkedin GET /search/results/people": () => ({
        people: [{ name: "Jane Doe", url: "https://www.linkedin.com/in/jdx/", headline: "Nurse" }],
      }),
      "linkedin GET /in/jdx": () => ({
        name: "Jane Doe",
        roles: [{ title: "Nurse", company: "General Hospital", companyUrl: "", current: true }],
      }),
    });
    const r = await lookUpPerson(sites, subject(), { linkedin: "linkedin@research" });
    expect(r.state).toBe("unresolved");
    expect(r.findings).toEqual([]);
  });
});

describe("lookUpPerson: fact keys", () => {
  const moved = (company: string) => [
    role("Account Manager", company),
    role("Recruiter", "Acme Staffing", false),
  ];
  it("the same move seen as 'Globex Inc.' and 'Globex' is one fact", async () => {
    const a = await lookUpPerson(oneHit("Jane Doe", moved("Globex Inc.")).sites, subject(), {
      linkedin: null,
    });
    const b = await lookUpPerson(oneHit("Jane Doe", moved("Globex")).sites, subject(), {
      linkedin: null,
    });
    expect(a.findings[0]?.kind).toBe("job_change");
    expect(a.findings[0]?.factKey).toBe(b.findings[0]?.factKey);
  });

  it("holds: the same reading twice gives the same key", async () => {
    const run = () =>
      lookUpPerson(
        oneHit("Jane Doe", moved("Globex")).sites,
        subject({
          email: { address: "jane@acmestaffing.com", result: "invalid", verifier: "smtp" },
        }),
        { linkedin: null },
      );
    const [a, b] = [await run(), await run()];
    expect(a.findings.map((f) => f.factKey)).toEqual(b.findings.map((f) => f.factKey));
    expect(new Set(a.findings.map((f) => f.factKey)).size).toBe(a.findings.length);
  });
});

import { describe, expect, it } from "vitest";
import type { ElsewhereHit } from "./elsewhere.js";
import type { LookupResult } from "./lookup.js";
import {
  errorWords,
  findingsOf,
  firmOf,
  firmOfRole,
  type ProfileFacts,
  subjectOf,
} from "./profile-research.js";

const facts = (over: Partial<ProfileFacts> = {}): ProfileFacts => ({
  name: "Jane Doe",
  emails: [],
  handles: [],
  person: null,
  employers: [],
  ...over,
});

describe("subjectOf", () => {
  it("splits the profile name; a one-word name has no last name", () => {
    expect(subjectOf(facts())).toMatchObject({
      personId: null,
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(subjectOf(facts({ name: "Dr. Jane Q. Doe, MBA" }))).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(subjectOf(facts({ name: "Jane" }))).toMatchObject({ firstName: "Jane", lastName: null });
    expect(subjectOf(facts({ name: null }))).toMatchObject({ firstName: null, lastName: null });
  });

  it("falls back to the research person's name when the profile has none", () => {
    const person = {
      fullName: "John Smith",
      firstName: "John",
      lastName: "Smith",
      title: null,
      company: null,
      domain: null,
      linkedinUrl: null,
    };
    expect(subjectOf(facts({ name: null, person }))).toMatchObject({
      firstName: "John",
      lastName: "Smith",
    });
  });

  it("carries the handles it holds, and the LinkedIn page one of them or the person names", () => {
    const s = subjectOf(
      facts({
        handles: [
          { platform: "x", handle: "janedoe", url: "https://x.com/janedoe" },
          { platform: "linkedin", handle: "jane-doe-1", url: null },
        ],
      }),
    );
    expect(s.handles).toEqual([
      { platform: "x", handle: "janedoe" },
      { platform: "linkedin", handle: "jane-doe-1" },
    ]);
    expect(s.linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe-1/");
    // A URN names no page.
    expect(
      subjectOf(
        facts({ handles: [{ platform: "linkedin", handle: "urn:li:member:123", url: null }] }),
      ).linkedinUrl,
    ).toBeNull();
    expect(
      subjectOf(
        facts({
          person: {
            fullName: "Jane Doe",
            firstName: "Jane",
            lastName: "Doe",
            title: null,
            company: null,
            domain: null,
            linkedinUrl: "https://ca.linkedin.com/in/JDoe",
          },
        }),
      ).linkedinUrl,
    ).toBe("https://www.linkedin.com/in/jdoe/");
  });
});

describe("firmOf", () => {
  const person = (company: string | null, domain: string | null) => ({
    fullName: "Jane Doe",
    firstName: "Jane",
    lastName: "Doe",
    title: "Recruiter",
    company,
    domain,
    linkedinUrl: null,
  });

  it("takes the research person's company first", () => {
    expect(
      firmOf(
        facts({
          person: person("Acme Staffing", "acmestaffing.com"),
          emails: ["jane@other.example"],
          employers: ["Lead at Globex"],
        }),
      ),
    ).toEqual({ name: "Acme Staffing", domain: "acmestaffing.com" });
  });

  it("then a work email's domain, skipping free mail", () => {
    expect(firmOf(facts({ emails: ["jane@gmail.com", "jane@acmestaffing.com"] }))).toEqual({
      name: null,
      domain: "acmestaffing.com",
    });
    expect(firmOf(facts({ emails: ["jane@gmail.com"] }))).toEqual({ name: null, domain: null });
  });

  it("then a kept employer finding", () => {
    expect(firmOf(facts({ employers: ["Account Manager at Globex"] }))).toEqual({
      name: "Globex",
      domain: null,
    });
    // A company row with neither a name nor a domain says nothing.
    expect(
      firmOf(facts({ person: person(null, null), employers: ["Recruiter at Acme Staffing"] })),
    ).toEqual({ name: "Acme Staffing", domain: null });
  });

  it("reads the firm out of 'Title at Firm'", () => {
    expect(firmOfRole("Recruiter at Acme Staffing")).toBe("Acme Staffing");
    expect(firmOfRole("Head at Home Care at Acme Staffing")).toBe("Acme Staffing");
    expect(firmOfRole("Acme Staffing")).toBe("Acme Staffing");
  });
});

const result = (over: Partial<LookupResult> = {}): LookupResult => ({
  state: "unresolved",
  profile: null,
  findings: [],
  tried: [],
  retryAt: null,
  cappedBy: null,
  pages: [],
  googleStopped: null,
  accountReads: 0,
  ...over,
});

const hit = (over: Partial<ElsewhereHit>): ElsewhereHit => ({
  kind: "handle",
  platform: "x",
  value: "janedoe",
  url: "https://x.com/janedoe",
  title: "Jane Doe",
  confidence: 0.4,
  matched: { name: true, firm: false, handle: false },
  query: "Jane Doe",
  ...over,
});

describe("findingsOf", () => {
  const matched = result({
    state: "matched",
    profile: { url: "https://www.linkedin.com/in/jane-doe-1/", vanity: "jane-doe-1" },
    tried: [{ step: "cache", what: "jane-doe-1 (held)", outcome: "matched" }],
    findings: [
      {
        kind: "still_there",
        personId: 0,
        factKey: "k",
        value: { company: "Acme Staffing", title: "Recruiter" },
        confidence: 0.8,
        via: "exa-cache",
        sourceUrl: null,
        document: null,
      },
    ],
  });

  it("gives the matched LinkedIn page and the current role", () => {
    const rows = findingsOf(matched);
    expect(rows.map((r) => [r.kind, r.platform, r.value, r.source])).toEqual([
      ["handle", "linkedin", "jane-doe-1", "cache"],
      ["employer", null, "Recruiter at Acme Staffing", "cache"],
    ]);
    expect(rows[0]?.ref).toBe("handle:linkedin:jane-doe-1");
    expect(rows[1]?.ref).toBe("employer::acme staffing");
  });

  it("names the step that matched: the account, search, Google", () => {
    const by = (step: string, what: string, outcome: string) =>
      findingsOf({ ...matched, tried: [{ step: step as never, what, outcome }] })[0];
    expect(by("profile", "jane-doe-1", "matched")?.source).toBe("linkedin");
    expect(by("profile", "jane-doe-1", "matched")?.confidence).toBe(0.9);
    expect(by("search", "Jane Doe Acme", "1 people via exa; jane-doe-1: matched")?.source).toBe(
      "search",
    );
    expect(by("cache", "jane-doe-1 (google)", "matched")?.source).toBe("google");
  });

  it("a job change gives the new role", () => {
    const moved = result({
      ...matched,
      findings: [
        {
          kind: "job_change",
          personId: 0,
          factKey: "k",
          value: { from: "Acme Staffing", to: "Globex", title: "Account Manager" },
          confidence: 0.8,
          via: "exa-cache",
          sourceUrl: null,
          document: null,
        },
      ],
    });
    expect(findingsOf(moved).find((r) => r.kind === "employer")?.value).toBe(
      "Account Manager at Globex",
    );
    // Left, or an email check alone, names no role.
    expect(
      findingsOf({
        ...matched,
        findings: [
          {
            ...(matched.findings[0] as LookupResult["findings"][number]),
            kind: "left",
            value: { from: "Acme" },
          },
        ],
      }).some((r) => r.kind === "employer"),
    ).toBe(false);
  });

  it("every page found elsewhere is a finding; links keep the title as their value", () => {
    const rows = findingsOf(
      result({
        elsewhere: [
          hit({}),
          hit({
            kind: "link",
            platform: "github",
            value: "janedoe",
            url: "https://github.com/janedoe",
            title: "Jane Doe (janedoe)",
            confidence: 0.5,
          }),
        ],
      }),
    );
    expect(rows.map((r) => [r.ref, r.value, r.source])).toEqual([
      ["link:github:janedoe", "Jane Doe (janedoe)", "elsewhere"],
      ["handle:x:janedoe", "janedoe", "elsewhere"],
    ]);
  });

  it("the same page found twice keeps the surer reading; a handle held is no finding", () => {
    const rows = findingsOf(
      result({
        state: "matched",
        profile: matched.profile,
        tried: matched.tried,
        elsewhere: [
          hit({
            platform: "linkedin",
            value: "jane-doe-1",
            url: "https://www.linkedin.com/in/jane-doe-1/",
            confidence: 0.95,
          }),
          hit({ platform: "x", value: "janedoe" }),
        ],
      }),
      [{ platform: "x", handle: "janedoe" }],
    );
    expect(rows.map((r) => [r.ref, r.source, r.confidence])).toEqual([
      ["handle:linkedin:jane-doe-1", "elsewhere", 0.95],
    ]);
    expect(findingsOf(matched, [{ platform: "linkedin", handle: "jane-doe-1" }])).toHaveLength(1);
  });
});

describe("errorWords", () => {
  it("says what stopped, in a line", () => {
    expect(errorWords(new Error("connect ECONNREFUSED\n127.0.0.1"))).toBe(
      "connect ECONNREFUSED 127.0.0.1",
    );
    expect(errorWords("")).toBe("The run failed.");
  });
});

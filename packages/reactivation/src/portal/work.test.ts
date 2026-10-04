import { describe, expect, it } from "vitest";
import {
  checkSteps,
  factOf,
  hasWork,
  lookupSteps,
  moverStep,
  pageOf,
  unlinkMasked,
} from "./work.js";

const CAP_WHY = "LinkedIn 429 for owner@example.com: daily limit";

describe("lookupSteps", () => {
  it("turns a search into a query, a count and each profile weighed", () => {
    const [email, search] = lookupSteps([
      { step: "email", what: "dana@acme.com", outcome: "still_there: the mailbox takes mail" },
      {
        step: "search",
        what: "Dana Reyes Acme",
        outcome:
          "5 people via exa; dana-r: name differs (Dan Ray); dana-reyes-1: name matches, no role at the firm; dana-reyes: matched",
      },
    ]);
    expect(email).toMatchObject({
      icon: "mail",
      query: null,
      result: "dana@acme.com: the mailbox takes mail",
    });
    expect(search).toMatchObject({
      icon: "search",
      did: "Searched the web",
      query: "Dana Reyes Acme",
      result: "5 people found",
      tone: "kept",
    });
    expect(search?.options.map((o) => [o.page.label, o.verdict, o.kept])).toEqual([
      ["https://www.linkedin.com/in/dana-r", "A different name", false],
      ["https://www.linkedin.com/in/dana-reyes-1", "Same name, no sign of the firm", false],
      ["https://www.linkedin.com/in/dana-reyes", "Same person", true],
    ]);
    expect(search?.options[2]?.page.href).toBe("https://www.linkedin.com/in/dana-reyes");
    expect(search?.queryHref).toBe("https://www.google.com/search?q=Dana%20Reyes%20Acme");
  });

  it("never names the vendor a search went through", () => {
    const [s] = lookupSteps([{ step: "search", what: "A B C", outcome: "0 people via exa" }]);
    expect(JSON.stringify(s)).not.toContain("exa");
    expect(s?.result).toBe("0 people found");
  });

  it("says why it couldn't search", () => {
    const [s] = lookupSteps([{ step: "search", what: "-", outcome: "no firm name to match on" }]);
    expect(s).toMatchObject({
      did: "Couldn't search",
      query: null,
      result: "No firm name to match on",
    });
  });

  it("shows a cap as a pause with a day, never the cap's own message", () => {
    const steps = lookupSteps([
      { step: "capped", what: CAP_WHY, outcome: "retry at 2026-10-02T09:00:00.000Z" },
    ]);
    expect(steps[0]).toMatchObject({ icon: "wait", did: "Paused for the day" });
    expect(steps[0]?.result).toContain("Oct 2");
    expect(JSON.stringify(steps)).not.toMatch(/429|@|LinkedIn/);
  });

  it("marks a refused profile read as a dead end", () => {
    const [s] = lookupSteps([{ step: "profile", what: "dana", outcome: "refused: 999" }]);
    expect(s).toMatchObject({ tone: "dropped", result: "LinkedIn didn't answer" });
  });

  it("keeps an unknown step instead of dropping it", () => {
    expect(lookupSteps([{ step: "phone", what: "x", outcome: "y" }])[0]?.did).toBe("Phone");
  });

  it("leaves the raw trail off; operators get it from portalWork", () => {
    const [s] = lookupSteps([{ step: "email", what: "a@b.co", outcome: "left: bounced" }]);
    expect(s?.detail).toBeNull();
    expect(s?.tone).toBe("kept");
  });
});

describe("checkSteps", () => {
  it("reads a careers page and its board", () => {
    const steps = checkSteps([
      { step: "careers", what: "https://www.acme.com/careers/", outcome: "greenhouse board acme" },
      {
        step: "board",
        what: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
        outcome: "3 open roles",
      },
    ]);
    expect(steps[0]).toMatchObject({
      page: { label: "https://www.acme.com/careers/", href: "https://www.acme.com/careers/" },
      result: "Links to their Greenhouse job board",
      tone: "kept",
    });
    expect(steps[1]).toMatchObject({
      page: {
        label: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
        href: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      },
      result: "3 open roles",
      tone: "kept",
    });
  });

  it("says what each dead end was", () => {
    const res = checkSteps([
      { step: "careers", what: "https://a.co/careers", outcome: "HTTP 404" },
      { step: "careers", what: "https://a.co/jobs", outcome: "HTTP 503" },
      { step: "careers", what: "https://a.co/x", outcome: "unreachable: ETIMEDOUT" },
      { step: "careers", what: "https://a.co/y", outcome: "leaves the site for b.co" },
      { step: "careers", what: "https://a.co/z", outcome: "no board named" },
      { step: "board", what: "https://jobs.lever.co/a", outcome: "unreadable: 500" },
    ]);
    expect(res.map((s) => s.result)).toEqual([
      "No page there",
      "The page didn't load",
      "Couldn't reach it",
      "Goes to another site",
      "No job board on it",
      "Couldn't read it",
    ]);
    expect(res.every((s) => s.tone === "dropped")).toBe(true);
  });

  it("weighs LinkedIn company pages by their website", () => {
    const res = checkSteps([
      { step: "linkedin page", what: "Acme", outcome: "2 pages by name" },
      {
        step: "linkedin page",
        what: "https://www.linkedin.com/company/acme/",
        outcome: "website acme.com: the firm's",
      },
      {
        step: "linkedin page",
        what: "https://www.linkedin.com/company/acme2/",
        outcome: "website x.com: not the firm's",
      },
      { step: "linkedin page", what: "-", outcome: "no LinkedIn account for this client" },
    ]);
    expect(res.map((s) => [s.did, s.result, s.tone])).toEqual([
      ["Searched LinkedIn for their page", "2 pages by name", "plain"],
      ["Read a LinkedIn company page", "The website on it is theirs", "kept"],
      ["Read a LinkedIn company page", "Another firm's page", "dropped"],
      ["Skipped LinkedIn", "No LinkedIn check on this list", "plain"],
    ]);
  });

  it("hides a cap's message here too", () => {
    const steps = checkSteps([{ step: "capped", what: CAP_WHY, outcome: "retry at nonsense" }]);
    expect(steps[0]?.result).toContain("later");
    expect(JSON.stringify(steps)).not.toContain("@");
  });
});

describe("factOf", () => {
  it("lists what a finding says, how sure, and where", () => {
    const f = factOf({
      kind: "still_there",
      value: { title: "VP Sales", company: "Acme", dates: "2021 - now", companyUrl: "x" },
      confidence: 0.8,
      source_url: "https://www.linkedin.com/in/dana-reyes",
      title: "Dana Reyes",
      seen: new Date("2026-09-30T12:00:00Z"),
    });
    expect(f).toMatchObject({
      kind: "Still there",
      sure: 0.8,
      page: { label: "https://www.linkedin.com/in/dana-reyes" },
      seen: "2026-09-30T12:00:00.000Z",
    });
    expect(f.fields).toEqual([
      ["At", "Acme"],
      ["Role", "VP Sales"],
      ["Dates", "2021 - now"],
    ]);
  });

  it("names open roles from a hiring finding", () => {
    const f = factOf({
      kind: "hiring",
      value: { count: 4, roles: [{ title: "SDR" }, "AE", { nope: 1 }], board: "b" },
      confidence: null,
      source_url: null,
      title: null,
      seen: null,
    });
    expect(f.kind).toBe("Hiring");
    expect(f.fields).toEqual([
      ["Open roles", "4"],
      ["Roles", "SDR, AE"],
    ]);
    expect(f.page).toBeNull();
  });
});

describe("helpers", () => {
  it("pageOf keeps the full address and refuses junk", () => {
    expect(pageOf("https://www.acme.com/a?b=1")?.label).toBe("https://www.acme.com/a?b=1");
    expect(pageOf("-")).toBeNull();
    expect(pageOf("not a url")).toBeNull();
  });
  it("hasWork covers the steps that keep work", () => {
    const steps = ["verify", "lookup", "signals", "movers", "score", "brief", "compose"];
    expect(steps.filter(hasWork)).toEqual([
      "lookup",
      "signals",
      "movers",
      "score",
      "brief",
      "compose",
    ]);
  });
  it("a mover's step says what came of the hunt", () => {
    expect(moverStep("found", "globex.example")).toMatchObject({
      did: "Looked for their email at globex.example",
      tone: "kept",
    });
    expect(moverStep("no_domain", null).did).toBe("Looked for the new firm's website");
    expect(moverStep("catch_all", "globex.example").tone).toBe("plain");
  });
});

describe("unlinkMasked", () => {
  it("drops links the mask changes and keeps the rest", () => {
    const shown = (s: string) => s.replace(/\/in\/[^/]+/, "/in/•••");
    const steps = lookupSteps([
      { step: "search", what: "q", outcome: "1 people via exa; dana-reyes: matched" },
    ]);
    const careers = checkSteps([
      { step: "careers", what: "https://acme.com/jobs", outcome: "HTTP 404" },
    ]);
    const out = unlinkMasked(
      {
        step: "lookup",
        subject: "D",
        personId: 1,
        steps: [...steps, ...careers],
        facts: [],
        reasons: [],
        at: null,
      },
      shown,
    );
    expect(out.steps[0]?.options[0]?.page).toEqual({
      label: "https://www.linkedin.com/in/dana-reyes",
      href: null,
    });
    expect(out.steps[1]?.page?.href).toBe("https://acme.com/jobs");
  });
});

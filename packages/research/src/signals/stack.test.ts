/** The stack collector: synthetic firms, stored pages and DNS answers, no network. */
import { describe, expect, it } from "vitest";
import { signalRefusal } from "../findings.js";
import { memoryPageStore } from "../pages.js";
import type { SignalDeps } from "./index.js";
import { bareDomain, dnsPrints, pagePrints, type StackDns, stackCollector } from "./stack.js";
import { STACK_PRINTS } from "./stack-prints.js";

const NOW = new Date("2026-10-01T12:00:00Z");
const FETCHED = "2026-09-20T08:00:00Z";
const FIRM = {
  id: 7,
  name: "Acme Staffing",
  domain: "https://www.acmestaffing.test/",
  niche: null,
  country: null,
  linkedin_url: null,
};

const page = (over: Record<string, unknown> = {}) => ({
  id: 1,
  url: "https://acmestaffing.test/",
  title: "Acme",
  fetched_at: FETCHED,
  html: null,
  html_key: null,
  ...over,
});

const HTML = `<html><head>
<meta name="generator" content="WordPress 6.5">
<script src="https://js.hs-scripts.com/123.js"></script>
<script src="https://widgets.leadconnectorhq.com/loader.js"></script>
<script>!function(f){f.src='https:\\/\\/connect.facebook.net\\/en_US\\/fbevents.js'}()</script>
</head><body><a href="https://jobs.lever.co/acme">Careers</a>
<a href="https://notcalendly.com/x">not a booking link</a></body></html>`;

function dns(
  txt: string[][] | Error,
  mx: { exchange: string; priority: number }[] | Error,
): StackDns & {
  asked: string[];
} {
  const asked: string[] = [];
  const answer = <T>(a: T | Error) => (a instanceof Error ? Promise.reject(a) : Promise.resolve(a));
  return {
    asked,
    resolveTxt: (n) => {
      asked.push(`TXT ${n}`);
      return answer(txt);
    },
    resolveMx: (n) => {
      asked.push(`MX ${n}`);
      return answer(mx);
    },
  };
}
const err = (code: string) => Object.assign(new Error(code), { code });

function deps(pages: unknown[], over: Partial<SignalDeps> = {}): SignalDeps {
  let call = 0;
  return {
    db: { execute: async () => (call++ === 0 ? [FIRM] : pages) } as never,
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
    googleLeft: 0,
    now: NOW,
    ...over,
  };
}

const defaults = stackCollector().settings.parse({});

describe("prints", () => {
  it("about 40 tools, each named once, each with a print", () => {
    const tools = STACK_PRINTS.map((p) => p.tool);
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools.length).toBeGreaterThanOrEqual(35);
    expect(tools).toContain("gohighlevel");
    for (const p of STACK_PRINTS)
      expect(
        (p.scripts ?? []).length +
          (p.meta ?? []).length +
          (p.spf ?? []).length +
          (p.txt ?? []).length +
          (p.mx ?? []).length,
      ).toBeGreaterThan(0);
  });

  it("matches hosts and subdomains, never a longer name", () => {
    const hits = pagePrints(HTML);
    expect([...hits.keys()].sort()).toEqual([
      "gohighlevel",
      "hubspot",
      "lever",
      "meta-ads",
      "wordpress",
    ]);
    expect(hits.get("hubspot")).toEqual([{ how: "script", match: "hs-scripts.com" }]);
    expect(pagePrints('<a href="https://cal.com.evil.test/x">').size).toBe(0);
    expect(pagePrints('<a href="https://app.cal.com/acme">').has("cal-com")).toBe(true);
  });

  it("reads SPF includes, verification TXT and MX", () => {
    const hits = dnsPrints(
      [
        "v=spf1 include:_spf.google.com include:servers.mcsv.net ~all",
        "facebook-domain-verification=abc",
        "MS=ms123",
      ],
      ["ASPMX.L.GOOGLE.COM.", "acme-test.mail.protection.outlook.com"],
    );
    expect([...hits.keys()].sort()).toEqual([
      "google-workspace",
      "mailchimp",
      "meta-ads",
      "microsoft-365",
    ]);
    expect(hits.get("google-workspace")?.map((m) => m.how)).toEqual(["spf", "mx"]);
  });

  it("bare domains", () => {
    expect(bareDomain("https://www.Acme.test/about?x")).toBe("acme.test");
  });
});

describe("the stack collector", () => {
  it("one dated, linked, raw finding per tool from pages and DNS", async () => {
    const r = dns(
      [["v=spf1 include:_spf.google.com ~all"], ["facebook-domain-verification=", "abc"]],
      [{ exchange: "aspmx.l.google.com", priority: 1 }],
    );
    const got = await stackCollector(() => r).collect(deps([page({ html: HTML })]), "c7", defaults);
    expect(r.asked).toEqual(["TXT acmestaffing.test", "MX acmestaffing.test"]);
    expect(got.state).toBe("found");
    const by = Object.fromEntries(got.signals.map((s) => [s.factKey, s]));
    expect(Object.keys(by).sort()).toEqual([
      "c7:stack:gohighlevel",
      "c7:stack:google-workspace",
      "c7:stack:hubspot",
      "c7:stack:lever",
      "c7:stack:meta-ads",
      "c7:stack:wordpress",
    ]);
    for (const s of got.signals) expect(signalRefusal(s)).toBeNull();

    const hub = by["c7:stack:hubspot"];
    expect(hub?.value).toMatchObject({
      title: "Uses HubSpot",
      topic: "crm",
      page: "https://acmestaffing.test/",
    });
    expect(hub?.signalAt).toEqual(new Date(FETCHED));
    expect(hub?.dated).toBe("seen");
    expect(hub?.document).toMatchObject({ url: "https://acmestaffing.test/", text: HTML });
    expect(by["c7:stack:lever"]?.value).toMatchObject({ title: "Uses Lever", topic: "ats" });

    // Page first, then DNS: one finding, both pieces of evidence.
    const meta = by["c7:stack:meta-ads"];
    expect(meta?.sourceUrl).toBe("https://acmestaffing.test/");
    expect(((meta?.value.evidence ?? []) as { how: string }[]).map((e) => e.how)).toEqual([
      "script",
      "txt",
    ]);

    const g = by["c7:stack:google-workspace"];
    expect(g?.sourceUrl).toBe("https://dns.google/resolve?name=acmestaffing.test&type=TXT");
    expect(g?.signalAt).toEqual(NOW);
    expect(g?.document?.kind).toBe("snippet");
    expect(JSON.parse(g?.document?.text ?? "")).toMatchObject({
      name: "acmestaffing.test",
      type: "TXT",
    });
    expect(
      ((g?.value.evidence ?? []) as { how: string; page: string }[]).map((e) => [e.how, e.page]),
    ).toEqual([
      ["spf", "https://dns.google/resolve?name=acmestaffing.test&type=TXT"],
      ["mx", "https://dns.google/resolve?name=acmestaffing.test&type=MX"],
    ]);
  });

  it("reads an archived page from the store", async () => {
    const store = memoryPageStore();
    await store.put("pages/1.html.gz", HTML);
    const got = await stackCollector(() => dns(err("ENOTFOUND"), err("ENOTFOUND"))).collect(
      deps([page({ html_key: "pages/1.html.gz" })], { pages: store }),
      "c7",
      { ...defaults, dns: false },
    );
    expect(got.state).toBe("found");
    expect(got.signals).toHaveLength(5);
  });

  it("pages and DNS but no print: none", async () => {
    const got = await stackCollector(() =>
      dns(err("ENODATA"), [{ exchange: "mx.example.test", priority: 1 }]),
    ).collect(deps([page({ html: "<html>plain</html>" })]), "c7", defaults);
    expect(got).toMatchObject({ state: "none", signals: [] });
  });

  it("an empty DNS answer is still an answer", async () => {
    const got = await stackCollector(() => dns(err("ENODATA"), err("ENODATA"))).collect(
      deps([]),
      "c7",
      defaults,
    );
    expect(got.state).toBe("none");
  });

  it("no stored page and no DNS answer: unresolved", async () => {
    const store = memoryPageStore();
    const got = await stackCollector(() => dns(err("ESERVFAIL"), err("ETIMEOUT"))).collect(
      // An archived page whose object is gone counts as unseen.
      deps([page({ html_key: "pages/9.html.gz" })], { pages: store }),
      "c7",
      defaults,
    );
    expect(got.state).toBe("unresolved");
    expect(got.tried.map((t) => t.outcome)).toEqual([
      "0 of 1 read",
      "failed: ESERVFAIL",
      "failed: ETIMEOUT",
    ]);
  });

  it("an unknown firm is unresolved", async () => {
    const got = await stackCollector().collect(
      { ...deps([]), db: { execute: async () => [] } as never },
      "c99",
      defaults,
    );
    expect(got.state).toBe("unresolved");
  });
});

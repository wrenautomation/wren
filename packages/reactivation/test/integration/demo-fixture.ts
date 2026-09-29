/**
 * The demo seed on fakes: the agency's site names two customers and search
 * finds three people who hire there (Cara has moved on).
 */
import type { SiteClient } from "@wren/core/content";
import { FakeLlm } from "@wren/llm";
import type { Fetcher } from "@wren/research/fetch";

const PAGES: Record<string, string> = {
  "https://northside.example": `<title>Northside Talent | Recruiting in Toronto</title>
    <a href="/clients">Clients</a>`,
  "https://northside.example/clients": `<p>Our clients</p>
    <a href="https://umbrellahealth.com">Umbrella Health</a><img alt="Globex">`,
  "https://umbrellahealth.com": "<title>Umbrella Health</title><p>Umbrella Health</p>",
  "https://globex.com": "<title>Globex</title><p>Globex makes widgets</p>",
};
const fetcher: Fetcher = {
  userAgent: "test",
  async get(url) {
    const u = url.replace(/\/$/, "");
    const text = PAGES[u];
    return text === undefined ? { status: 404, url, text: "" } : { status: 200, url: u, text };
  },
};
const llm = new FakeLlm({
  default: JSON.stringify({
    customers: [
      { name: "Umbrella Health", website: "https://umbrellahealth.com" },
      { name: "Globex" },
    ],
  }),
});
const li = (v: string) => `https://www.linkedin.com/in/${v}`;
const HITS: Record<string, { title: string; url: string; snippet: string | null }[]> = {
  "Umbrella Health": [
    {
      title: "Jane Doe - Talent Lead - Umbrella Health | LinkedIn",
      url: li("jane-doe"),
      snippet: null,
    },
    {
      title: "Cara Lim - Senior Recruiter | LinkedIn",
      url: li("cara-lim"),
      snippet:
        "Experience: Initech · Formerly Talent Partner at Umbrella Health · Location: Toronto",
    },
  ],
  Globex: [
    { title: "Bob Roe - HR Manager - Globex | LinkedIn", url: li("bob-roe"), snippet: null },
  ],
};
const sites: SiteClient = {
  async call(_site, _method, _path, input = {}) {
    const q = String((input as { q: string }).q);
    const firm = Object.keys(HITS).find((k) => q.includes(`"${k}"`)) ?? "";
    return { hits: HITS[firm] ?? [], via: "ddg" } as never;
  },
  async via() {
    return "api";
  },
};
export const deps = { fetcher, sites, llm, resolves: async (d: string) => d === "globex.com" };
export const today = new Date("2026-09-29T12:00:00Z");

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
type Role = { title: string; company: string; current: boolean };
const PEOPLE: Record<string, { name: string; url: string; roles: Role[] }[]> = {
  "Umbrella Health": [
    {
      name: "Jane Doe",
      url: li("jane-doe"),
      roles: [{ title: "Talent Lead", company: "Umbrella Health", current: true }],
    },
    {
      name: "Cara Lim",
      url: li("cara-lim"),
      roles: [
        { title: "Senior Recruiter", company: "Initech", current: true },
        { title: "Talent Partner", company: "Umbrella Health", current: false },
      ],
    },
  ],
  Globex: [
    {
      name: "Bob Roe",
      url: li("bob-roe"),
      roles: [{ title: "HR Manager", company: "Globex", current: true }],
    },
  ],
};
const sites: SiteClient = {
  async call(_site, _method, _path, input = {}) {
    const q = String((input as { q: string }).q);
    const firm = Object.keys(PEOPLE).find((k) => q.endsWith(` at ${k}`)) ?? "";
    return { people: PEOPLE[firm] ?? [], via: "exa" } as never;
  },
  async via() {
    return "api";
  },
};
export const deps = { fetcher, sites, llm, resolves: async (d: string) => d === "globex.com" };
export const today = new Date("2026-09-29T12:00:00Z");

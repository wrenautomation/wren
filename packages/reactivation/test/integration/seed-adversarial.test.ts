/**
 * Adversarial `crm seed-demo` runs on fakes: a bad day on the agency's site,
 * the agency's own staff in search, names the importer can't read, a second
 * agency. Tests state what SHOULD happen; a failing one is a bug.
 */
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import type { Fetcher } from "@wren/research/fetch";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, ["crm_contacts", "sightings", "import_errors", "people", "companies", "imports"]),
);
const db = () => pg.db;

type Person = {
  name: string;
  url: string;
  roles: { title: string; company: string; current: boolean }[];
};
const li = (v: string) => `https://www.linkedin.com/in/${v}`;
const today = new Date("2026-09-29T12:00:00Z");

const NORTHSIDE: Record<string, string> = {
  "https://northside.example": `<title>Northside Talent | Recruiting in Toronto</title>
    <p>Our clients</p><a href="https://umbrellahealth.example">Umbrella Health</a>`,
  "https://umbrellahealth.example": "<title>Umbrella Health</title><p>Umbrella Health</p>",
};

function fetcher(pages: Record<string, string>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  return {
    userAgent: "test",
    asked,
    async get(url) {
      asked.push(url);
      const u = url.replace(/\/$/, "");
      const text = pages[u];
      return text === undefined ? { status: 404, url, text: "" } : { status: 200, url: u, text };
    },
  };
}
const says = (customers: { name: string; website?: string }[]) =>
  new FakeLlm({ default: JSON.stringify({ customers }) });
function search(hits: Record<string, Person[]>): SiteClient {
  return {
    async call(_site, _method, _path, input = {}) {
      const q = String((input as { q: string }).q);
      const firm = Object.keys(hits).find((k) => q.endsWith(` at ${k}`)) ?? "";
      return { people: hits[firm] ?? [], via: "exa" } as never;
    },
    async via() {
      return "api";
    },
  };
}
const northside = (hits: Person[], pages = NORTHSIDE) => ({
  fetcher: fetcher(pages),
  sites: search({ "Umbrella Health": hits }),
  llm: says([{ name: "Umbrella Health", website: "https://umbrellahealth.example" }]),
  resolves: async () => false,
});
const JANE: Person = {
  name: "Jane Doe",
  url: li("jane-doe"),
  roles: [{ title: "Talent Lead", company: "Umbrella Health", current: true }],
};
const count = async (table: string) =>
  (await db().execute(sql.raw(`select count(*)::int as n from ${table}`)))[0]?.n;

describe("seedDemo: a bad run", () => {
  // Was a bug: the reset runs even when nothing was found, so one 503 from the agency's site right before a call wipes the demo list that was there.
  it("a run that finds no customers leaves the last list in place", async () => {
    await seedDemo(db(), northside([JANE]), { agency: "northside.example", today });
    expect(await count("people")).toBe(1);
    const down: Fetcher = {
      userAgent: "test",
      async get(url) {
        return { status: 503, url, text: "" };
      },
    };
    await seedDemo(
      db(),
      { ...northside([JANE]), fetcher: down },
      {
        agency: "northside.example",
        today,
      },
    ).catch(() => null);
    expect(await count("people")).toBe(1);
  });

  // Was a bug: the agency's name is read from its home page before robots.txt is checked, so the seed fetches a page the site told it not to (findCustomers stops on the same file).
  it("a robots.txt that disallows the agency's site stops every read of it", async () => {
    const deps = northside([JANE], {
      ...NORTHSIDE,
      "https://northside.example/robots.txt": "User-agent: *\nDisallow: /",
    });
    await seedDemo(db(), deps, { agency: "northside.example", today }).catch(() => null);
    expect(deps.fetcher.asked).not.toContain("https://northside.example");
  });
});

describe("seedDemo: who lands in the list", () => {
  // Was a bug: the agency's own recruiter, who lists the customer before, is kept as someone who left the customer; the demo shows the agency its own staff with a guessed address at the customer.
  it("the agency's own recruiter is not a contact at its customer", async () => {
    const fox: Person = {
      name: "Sam Fox",
      url: li("sam-fox"),
      roles: [
        { title: "Senior Recruiter", company: "Northside Talent", current: true },
        { title: "Recruiter", company: "Umbrella Health", current: false },
      ],
    };
    await seedDemo(db(), northside([fox, JANE]), {
      agency: "northside.example",
      perCompany: 5,
      today,
    });
    const rows = await db().execute(sql`select last_name from people order by last_name`);
    expect(rows.map((r) => r.last_name)).toEqual(["Doe"]);
  });

  // Was a bug: the import's name key keeps only a-z and 0-9, so every non-Latin name keys to "" and two different people at one company merge into one.
  it("two people with non-Latin names stay two people", async () => {
    const hits: Person[] = [
      {
        name: "Иван Петров",
        url: li("ivan"),
        roles: [{ title: "HR Manager", company: "Umbrella Health", current: true }],
      },
      {
        name: "Мария Смирнова",
        url: li("maria"),
        roles: [{ title: "Recruiter", company: "Umbrella Health", current: true }],
      },
    ];
    const { stats } = await seedDemo(db(), northside(hits), {
      agency: "northside.example",
      today,
    });
    expect(stats.people).toBe(2);
    const rows = await db().execute(sql`select full_name from people order by full_name`);
    expect(rows.map((r) => r.full_name)).toEqual(["Иван Петров", "Мария Смирнова"]);
  });

  it("holds: accents, apostrophes, hyphens, commas and emoji survive the CSV and the import", async () => {
    const hits: Person[] = [
      {
        name: "Zoë O'Brien-Núñez",
        url: li("zoe"),
        roles: [
          { title: "Director, Talent & Culture 🚀", company: "Umbrella Health", current: true },
        ],
      },
    ];
    await seedDemo(db(), northside(hits), { agency: "northside.example", today });
    const rows = await db().execute(sql`select first_name, last_name, title from people`);
    expect(rows.map((r) => [r.first_name, r.last_name])).toEqual([["Zoë", "O'Brien-Núñez"]]);
    const title = rows[0]?.title;
    if (title != null) expect(title).toBe("Director, Talent & Culture 🚀");
    const emails = await db().execute(sql`select email from contact_candidates`);
    expect(emails.map((r) => r.email)).toEqual(["zoe.obriennunez@umbrellahealth.example"]);
  });
});

describe("seedDemo: a second agency", () => {
  it("holds: nothing from the first agency's list is left", async () => {
    await seedDemo(db(), northside([JANE]), { agency: "northside.example", today });
    const southpoint = {
      fetcher: fetcher({
        "https://southpoint.example": `<title>Southpoint Staffing</title><p>Trusted by Initrode</p>
          <a href="https://initrode.example">Initrode</a>`,
        "https://initrode.example": "<title>Initrode</title><p>Initrode</p>",
      }),
      sites: search({
        Initrode: [
          {
            name: "Bo Chen",
            url: li("bo-chen"),
            roles: [{ title: "Recruiter", company: "Initrode", current: true }],
          },
        ],
      }),
      llm: says([{ name: "Initrode", website: "initrode.example" }]),
      resolves: async () => false,
    };
    await seedDemo(db(), southpoint, { agency: "southpoint.example", today });
    const people = await db().execute(
      sql`select p.last_name, c.name from people p join companies c on c.id = p.company_id`,
    );
    expect(people.map((r) => [r.last_name, r.name])).toEqual([["Chen", "Initrode"]]);
    const leftovers = await db().execute(
      sql`select (select count(*) from contact_candidates where email not like '%@initrode.example')::int as emails,
                 (select count(*) from imports)::int as imports,
                 (select count(*) from companies where name ilike '%umbrella%')::int as companies`,
    );
    expect(leftovers[0]).toEqual({ emails: 0, imports: 1, companies: 0 });
  });
});

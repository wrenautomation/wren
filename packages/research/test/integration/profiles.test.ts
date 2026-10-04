/**
 * The `profiles` stage against the migrated schema, with a fake `web` site:
 * people in the queue's order, links read off the firm's own pages, each unit
 * written before the next (a rerun resumes), a firm looked up once, an Exa cap
 * parking the stage, a failed read stopping the run, and Google's daily share.
 */
import { openRun } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  googleLeft,
  PROFILES_COMMAND,
  profilesParkedUntil,
  profileWork,
  runProfiles,
} from "../../src/enrichment/profiles.js";
import { documents } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "companies",
    "people",
    "documents",
    "findings",
    "person_lookups",
    "company_lookups",
    "runs",
  ]),
);
const db = () => pg.db;

const TZ = "America/Chicago";
/** 03:00 in Chicago: no Google. */
const NIGHT = new Date("2026-10-03T08:00:00Z");
/** 10:00 in Chicago. */
const DAY = new Date("2026-10-03T15:00:00Z");

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
  return { sites, calls, keys: () => calls.map((c) => c.key) };
}

const profile = (name: string, vanity: string, company: string) => ({
  name,
  vanity,
  url: `https://www.linkedin.com/in/${vanity}/`,
  roles: [{ title: "Partner", company, current: true }],
  education: [],
  text: `${name}\nPartner at ${company}`,
  source: "exa",
});
const companyPage = (handle: string, website: string) => ({
  name: "Acme Staffing",
  handle,
  url: `https://www.linkedin.com/company/${handle}/`,
  website,
  industry: "Staffing and Recruiting",
  text: "Acme Staffing\nStaffing and Recruiting",
  source: "exa",
});
const byUrl =
  (path: string, ...pages: { url: string }[]): Handler =>
  (input) => {
    const p = pages.find((x) => x.url === input.url);
    if (!p) throw new SiteCallError("web", "GET", path, 404, "no cached copy");
    return p;
  };

/** The cache holds Jane and Acme's page; people and company search find nobody. */
const routes = (over: Record<string, Handler> = {}) => ({
  "web GET /linkedin/profile": byUrl(
    "/linkedin/profile",
    profile("Jane Doe", "jane-doe", "Acme Staffing"),
  ),
  "web GET /linkedin/company": byUrl(
    "/linkedin/company",
    companyPage("acme-staffing", "https://www.acmestaffing.example"),
  ),
  "web GET /people": () => ({ people: [], via: "exa" }),
  "web GET /companies": () => ({ companies: [] }),
  ...over,
});

const TEAM = `<html><body><h1>Team</h1>
<div><h3>Jane Doe</h3><a href="https://www.linkedin.com/in/jane-doe/">in</a></div>
<div><h3>Bob Roe</h3><p>Recruiter</p></div>
<footer><a href="https://www.linkedin.com/company/acme-staffing/">LinkedIn</a></footer>
</body></html>`;

async function person(companyId: number, first: string, last: string) {
  const [row] = await db()
    .insert(people)
    .values({
      companyId,
      fullName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      title: "Partner",
      isCompliance: false,
      origin: "website",
      originRef: "https://firm.example/team",
      raw: {},
    })
    .returning();
  if (!row) throw new Error("no person");
  return row.id;
}

async function seed() {
  const acme = await makeCompany(db(), {
    key: "a",
    domain: "acmestaffing.example",
    name: "Acme Staffing LLC",
  });
  const globex = await makeCompany(db(), {
    key: "b",
    domain: "globextalent.example",
    name: "Globex Talent",
  });
  await db().insert(documents).values({
    companyId: acme.id,
    url: "https://acmestaffing.example/team",
    kind: "webpage",
    contentHash: "t1",
    text: "Team",
    html: TEAM,
  });
  const jane = await person(acme.id, "Jane", "Doe");
  const bob = await person(acme.id, "Bob", "Roe");
  const ann = await person(globex.id, "Ann", "Poe");
  return { acme, globex, jane, bob, ann };
}

const run = (s: SiteClient, ids: number[], over: Partial<Parameters<typeof runProfiles>[2]> = {}) =>
  runProfiles(db(), s, {
    personIds: ids,
    timezone: TZ,
    now: () => NIGHT,
    sleep: async () => {},
    ...over,
  });
const rows = async (table: "person_lookups" | "company_lookups") =>
  (await db().execute(
    sql`select * from ${sql.raw(table)} order by looked_up_at, ${sql.raw(table === "person_lookups" ? "person_id" : "company_id")}`,
  )) as unknown as {
    state: string;
    person_id?: number;
    company_id?: number;
    run_id: string | null;
  }[];

describe("profileWork", () => {
  it("keeps the queue's order and reads links off the firm's own pages, beside the right name", async () => {
    const { jane, bob, ann, acme } = await seed();
    const work = await profileWork(db(), [ann, bob, jane]);
    expect(work.map((w) => w.person.personId)).toEqual([ann, bob, jane]);
    const of = (id: number) => work.find((w) => w.person.personId === id);
    expect(of(jane)?.person.pageLinks).toEqual(["https://www.linkedin.com/in/jane-doe/"]);
    expect(of(bob)?.person.pageLinks).toEqual([]);
    expect(of(bob)?.company).toMatchObject({
      companyId: acme.id,
      pageLinks: ["https://www.linkedin.com/company/acme-staffing/"],
    });
    expect(of(ann)?.company.pageLinks).toEqual([]);
  });

  it("an id that is no person is skipped, not an error; no ids, no query", async () => {
    const { jane } = await seed();
    expect((await profileWork(db(), [999_999, jane])).map((w) => w.person.personId)).toEqual([
      jane,
    ]);
    expect(await profileWork(db(), [])).toEqual([]);
  });
});

describe("runProfiles", () => {
  it("each person, then their firm once; every page read kept; a rerun picks nobody", async () => {
    const { jane, bob, ann, acme, globex } = await seed();
    const { sites, keys } = fakeSites(routes());
    const stats = await run(sites, [jane, bob, ann]);
    expect(stats).toMatchObject({
      selected: 3,
      people_matched: 1,
      people_unresolved: 2,
      companies_matched: 1,
      companies_unresolved: 1,
      google: 0,
      errors: 0,
      stopped: null,
    });
    // Acme is read once, through Jane; Bob finds it done.
    expect(keys().filter((k) => k === "web GET /linkedin/company")).toHaveLength(1);
    expect(keys()).not.toContain("web GET /google");
    expect((await rows("person_lookups")).map((r) => [r.person_id, r.state])).toEqual(
      expect.arrayContaining([
        [jane, "matched"],
        [bob, "unresolved"],
        [ann, "unresolved"],
      ]),
    );
    expect((await rows("company_lookups")).map((r) => [r.company_id, r.state])).toEqual(
      expect.arrayContaining([
        [acme.id, "matched"],
        [globex.id, "unresolved"],
      ]),
    );
    const [held] = await db().select().from(people).where(sql`${people.id} = ${jane}`);
    expect(held?.linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe/");
    const kept = await db().execute<{ n: number }>(
      sql`select count(*)::int n from documents where kind = 'profile'`,
    );
    expect(kept[0]?.n).toBeGreaterThanOrEqual(2);

    const again = fakeSites(routes());
    expect((await run(again.sites, [jane, bob, ann])).selected).toBe(0);
    expect(again.calls).toHaveLength(0);
    expect((await run(again.sites, [jane], { again: true })).selected).toBe(1);
  });

  it("an Exa cap parks the stage until it lifts: the next run asks nothing", async () => {
    const { jane, bob, ann } = await seed();
    const ledger = await openRun(db(), { command: PROFILES_COMMAND, argv: {} });
    const capped = fakeSites(
      routes({
        "web GET /people": () => {
          throw new SiteCallError("web", "GET", "/people", 429, "cap reached, retry after 3600s");
        },
      }),
    );
    // Bob has no link, so he needs people search: the cap lands on him and stops the run.
    // The real clock: retry_at is compared with the database's now().
    const stats = await run(capped.sites, [bob, jane, ann], {
      runId: ledger.id,
      now: () => new Date(),
    });
    expect(stats.selected).toBe(3);
    expect(stats.stopped).toMatch(/cap/);
    expect(stats.people_matched + stats.people_unresolved).toBe(0);
    const parked = await profilesParkedUntil(db());
    expect(parked).not.toBeNull();
    expect((parked as Date).getTime()).toBeGreaterThan(Date.now());

    const next = fakeSites(routes());
    const later = await run(next.sites, [bob, jane, ann]);
    expect(later.stopped).toMatch(/parked/);
    expect(next.calls).toHaveLength(0);
  });

  it("a cap from some other command does not park this stage", async () => {
    const { bob } = await seed();
    const other = await openRun(db(), { command: "reactivation lookups", argv: {} });
    await db().execute(sql`insert into person_lookups (person_id, state, tried, retry_at, run_id)
      values (${bob}, 'capped', '[]'::jsonb, now() + interval '1 hour', ${other.id})`);
    expect(await profilesParkedUntil(db())).toBeNull();
  });

  it("a failed Exa read stops the run at that person; nobody after is asked", async () => {
    const { jane, bob, ann } = await seed();
    const broken = fakeSites(
      routes({
        "web GET /linkedin/profile": () => {
          throw new SiteCallError("web", "GET", "/linkedin/profile", 502, "exa failed");
        },
      }),
    );
    const stats = await run(broken.sites, [jane, bob, ann]);
    expect(stats.stopped).toMatch(/failed a read/);
    expect(stats.errors).toBe(1);
    expect(broken.calls).toHaveLength(1);
    // Nothing written for Jane: she is still due next run.
    expect(await rows("person_lookups")).toEqual([]);
    expect((await profileWork(db(), [jane])).length).toBe(1);
  });

  it("Google: only by day, within the day's share, and none after it was stopped", async () => {
    const { bob, ann } = await seed();
    const google = fakeSites(routes({ "web GET /google": () => ({ results: [] }) }));
    const stats = await run(google.sites, [bob, ann], { now: () => DAY, googlePerDay: 1 });
    // One search: Bob's, by name; Ann's lookups and both firms get none.
    expect(stats.google).toBe(1);
    expect(google.keys().filter((k) => k === "web GET /google")).toHaveLength(1);
    expect(await googleLeft(db(), { now: DAY, timezone: TZ, perDay: 1 })).toBe(0);
    expect(await googleLeft(db(), { now: DAY, timezone: TZ, perDay: 3 })).toBe(2);
    expect(await googleLeft(db(), { now: NIGHT, timezone: TZ, perDay: 3 })).toBe(0);
  });

  it("a CAPTCHA'd Google search is spent for the day, not just for the run", async () => {
    const { bob, ann } = await seed();
    const stopped = fakeSites(
      routes({
        "web GET /google": () => {
          throw new SiteCallError("web", "GET", "/google", 503, "captcha");
        },
      }),
    );
    const stats = await run(stopped.sites, [bob, ann], { now: () => DAY });
    // Google failing never fails the lookup, and the run goes on without it.
    expect(stats.stopped).toBeNull();
    expect(stats.people_unresolved).toBe(2);
    expect(stopped.keys().filter((k) => k === "web GET /google")).toHaveLength(1);
    expect(await googleLeft(db(), { now: DAY, timezone: TZ })).toBe(0);
  });
});

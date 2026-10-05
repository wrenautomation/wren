/**
 * The `team` stage against the migrated schema, with a fake `web` site: one
 * search per firm, current staff kept as people, a held person filled not
 * doubled, a profile held elsewhere a sighting, every profile kept on the
 * marker row, a searched firm never picked again, and an Exa cap parking it.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  countTeamUnit,
  emptyTeamStats,
  teamParkedUntil,
  teamUnit,
  teamWork,
} from "../../src/enrichment/team.js";
import { teamSearches } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "people", "team_searches", "runs"]));
const db = () => pg.db;

const prof = (name: string, vanity: string, company: string, current = true) => ({
  name,
  url: `https://www.linkedin.com/in/${vanity}/`,
  headline: `${name} at ${company}`,
  roles: [{ title: "Partner", company, current, dates: "2020 - Present" }],
});

function fakeSites(people: (q: string) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      if (`${site} ${method} ${path}` !== "web GET /people")
        throw new SiteCallError(site, method, path, 404, "no route");
      calls.push(input as Record<string, unknown>);
      return { people: people(String((input as { q: string }).q)), via: "exa" } as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

async function held(companyId: number, first: string, last: string, linkedinUrl: string | null) {
  const [row] = await db()
    .insert(people)
    .values({
      companyId,
      fullName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      title: null,
      isCompliance: false,
      origin: "website",
      originRef: "https://firm.example/team",
      linkedinUrl,
      raw: {},
    })
    .returning();
  if (!row) throw new Error("no person");
  return row.id;
}

describe("team stage", () => {
  it("keeps current staff, fills a held person, and marks the firm with every profile", async () => {
    const acme = await makeCompany(db(), {
      key: "a",
      domain: "acmestaffing.example",
      name: "Acme Staffing LLC",
    });
    const jane = await held(acme.id, "Jane", "Doe", null);
    const { sites, calls } = fakeSites(() => [
      prof("Jane Doe", "jane-doe", "Acme Staffing"),
      prof("Bob Roe", "bob-roe", "Acme Staffing"),
      prof("Old Timer", "old-timer", "Acme Staffing", false),
      prof("Ann Lee", "ann-lee", "Acme Robotics"),
    ]);
    const [work] = await teamWork(db(), [acme.id]);
    if (!work) throw new Error("no work");
    const u = await teamUnit(db(), sites, work);
    expect(u).toMatchObject({ state: "matched", added: 1, filled: 1, error: null });
    expect(calls).toEqual([{ q: "Acme Staffing", n: 25 }]);

    const rows = await db().select().from(people).where(eq(people.companyId, acme.id));
    expect(rows.map((r) => [r.fullName, r.title, r.linkedinUrl, r.origin, r.sourceKey])).toEqual(
      expect.arrayContaining([
        ["Jane Doe", "Partner", "https://www.linkedin.com/in/jane-doe/", "website", null],
        ["Bob Roe", "Partner", "https://www.linkedin.com/in/bob-roe/", "linkedin", "li:bob-roe"],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === jane)?.linkedinUrl).toBe(
      "https://www.linkedin.com/in/jane-doe/",
    );
    const [mark] = await db().select().from(teamSearches);
    expect(mark).toMatchObject({ companyId: acme.id, state: "matched", kept: 2 });
    expect(mark?.profiles).toHaveLength(4);

    // Searched once: never picked again.
    expect(await teamWork(db(), [acme.id])).toEqual([]);
  });

  it("a profile held at another firm is a sighting, and a firm with no one is unresolved", async () => {
    const acme = await makeCompany(db(), {
      key: "a",
      domain: "acmestaffing.example",
      name: "Acme Staffing",
    });
    const globex = await makeCompany(db(), {
      key: "b",
      domain: "globextalent.example",
      name: "Globex Talent",
    });
    const { sites } = fakeSites((q) =>
      q === "Acme Staffing" ? [prof("Bob Roe", "bob-roe", "Acme Staffing")] : [],
    );
    for (const w of await teamWork(db(), [acme.id, globex.id])) await teamUnit(db(), sites, w);
    await db().delete(teamSearches).where(eq(teamSearches.companyId, acme.id));
    // Bob now also lists Globex; a second search of Acme must not make a second Bob.
    const again = await teamUnit(db(), sites, {
      companyId: acme.id,
      name: "Acme Staffing",
      domain: "acmestaffing.example",
    });
    expect(again).toMatchObject({ state: "matched", added: 0 });
    expect(await db().select().from(people)).toHaveLength(1);
    const marks = await db().select().from(teamSearches);
    expect(marks.find((m) => m.companyId === globex.id)?.state).toBe("unresolved");
  });

  it("an Exa cap parks the stage and stops the run", async () => {
    const acme = await makeCompany(db(), {
      key: "a",
      domain: "acme.example",
      name: "Acme Staffing",
    });
    const sites: SiteClient = {
      async call() {
        throw new SiteCallError("web", "GET", "/people", 429, "cap reached, retry after 3600s");
      },
      async via() {
        return "api";
      },
    };
    const u = await teamUnit(db(), sites, {
      companyId: acme.id,
      name: acme.name,
      domain: acme.domain,
    });
    expect(u).toMatchObject({ state: "capped", capped: true });
    const stats = emptyTeamStats();
    expect(countTeamUnit(stats, u, { errors: 0 })).toMatch(/cap/);
    expect(await teamParkedUntil(db())).toBeInstanceOf(Date);
    expect(await teamWork(db(), [acme.id])).toEqual([]);
  });
});

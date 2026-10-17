/**
 * The ProfileResearch virtual object end to end on a fake site: a queued run reads the web,
 * writes its lookup row and findings, and a rerun keeps what a person dropped. alwaysReplay
 * re-runs the journal after every step, so a read outside ctx.run fails loudly. Synthetic rows.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { runs } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { decideFindings, queueProfileResearch } from "@wren/core/profile-findings";
import { resolveProfile } from "@wren/core/profiles";
import { profileFindings, profileLookups } from "@wren/core/profiles-schema";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  makeProfileResearch,
  type ProfileResearch,
  type ProfileResearchStats,
} from "../../src/restate/profile-research.js";

type Route = (input: Record<string, unknown>) => unknown;

/** A SiteClient answering from a table of "site METHOD path" routes; logs every call. */
function fakeSites(routes: Record<string, Route>) {
  const calls: string[] = [];
  const sites: SiteClient = {
    async call(site, method, path, input = {}) {
      const key = `${site} ${method} ${path}`;
      calls.push(key);
      const h = routes[key];
      if (!h) throw new SiteCallError(site, method, path, 404, "no route");
      return (await h(input as Record<string, unknown>)) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

const page = {
  name: "Jane Doe",
  url: "https://www.linkedin.com/in/jane-doe-1/",
  roles: [{ title: "Recruiter", company: "Acme Staffing", current: true }],
};
const PAGES: Route = () => ({ people: [page], via: "exa" });
const AROUND: Route = () => ({
  hits: [
    { title: "Jane Doe (@janedoe) on X", url: "https://x.com/janedoe" },
    { title: "Jane Doe", url: "https://github.com/janedoe" },
  ],
  via: "exa",
});
let pages = PAGES;
let around = AROUND;
const web = fakeSites({
  "web GET /people": (i) => pages(i),
  "web GET /search": (i) => around(i),
  "web GET /google": () => ({ results: [] }),
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [makeProfileResearch({ db: pg.db, sites: web.sites, timezone: "America/Chicago" })],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "profile_findings",
    "profile_lookups",
    "profile_keys",
    "profiles",
    "social_handles",
    "runs",
  ]);
  web.calls.length = 0;
  pages = PAGES;
  around = AROUND;
});

const client = (profileId: number) =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ProfileResearch>({ name: "ProfileResearch" }, String(profileId));

/** Jane, known by a work email: the firm comes from its domain. */
async function jane() {
  const r = await resolveProfile(
    pg.db,
    [{ kind: "email", value: "jane@acmestaffing.example" }],
    "t",
    { name: "Jane Doe" },
  );
  return (r as { id: number }).id;
}

/** Queue a run and carry it out, as the portal's action does. */
async function research(profileId: number): Promise<ProfileResearchStats> {
  const { lookupId } = await queueProfileResearch(pg.db, profileId, "william");
  return (await client(profileId).run({ lookupId })) as ProfileResearchStats;
}

const findings = () => pg.db.select().from(profileFindings).orderBy(profileFindings.ref);

describe("ProfileResearch virtual object", () => {
  it("a run writes its lookup row and every page it found as a finding", async () => {
    const id = await jane();
    const stats = await research(id);
    expect(stats).toMatchObject({ state: "matched", findings: 4 });

    const [row] = await pg.db.select().from(profileLookups);
    expect(row).toMatchObject({ profileId: id, state: "done", outcome: "matched", by: "william" });
    expect(row?.startedAt).toBeTruthy();
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.subject).toMatchObject({ firstName: "Jane", lastName: "Doe" });
    const steps = ((row?.tried ?? []) as { step: string }[]).map((t) => t.step);
    expect(steps).toContain("search");
    expect(steps).toContain("elsewhere");

    const got = await findings();
    expect(got.map((f) => [f.ref, f.state])).toEqual([
      ["employer::acme staffing", "found"],
      ["handle:linkedin:jane-doe-1", "found"],
      ["handle:x:janedoe", "found"],
      ["link:github:janedoe", "found"],
    ]);
    expect(web.calls).toContain("web GET /search");
    // One ledger run for the handler.
    const ledger = await pg.db.select().from(runs);
    expect(ledger.map((r) => r.command)).toEqual(["people research"]);
  });

  it("a rerun updates what it found again but keeps a dropped finding dropped", async () => {
    const id = await jane();
    await research(id);
    const before = await findings();
    const idOf = (ref: string) => before.find((f) => f.ref === ref)?.id as number;
    await decideFindings(pg.db, [idOf("handle:x:janedoe")], "dropped", "william");
    await decideFindings(pg.db, [idOf("link:github:janedoe")], "kept", "william");
    around = () => ({
      hits: [
        { title: "Jane Doe (@janedoe) on X, Acme Staffing", url: "https://x.com/janedoe" },
        { title: "Jane Doe", url: "https://github.com/janedoe" },
        { title: "Jane Doe", url: "https://www.instagram.com/jane.doe/" },
      ],
      via: "exa",
    });
    expect((await research(id)).state).toBe("matched");
    const after = await findings();
    const state = (ref: string) => after.find((f) => f.ref === ref)?.state;
    expect(state("handle:x:janedoe")).toBe("dropped");
    expect(state("link:github:janedoe")).toBe("kept");
    expect(state("handle:instagram:jane.doe")).toBe("found");
    // The dropped one was found again: the run that saw it moves, who decided stays.
    const x = after.find((f) => f.ref === "handle:x:janedoe");
    const was = before.find((f) => f.ref === "handle:x:janedoe");
    expect(x?.lookupId).toBeGreaterThan(was?.lookupId ?? 0);
    expect(x?.decidedBy).toBe("william");
    expect(await pg.db.select().from(profileLookups)).toHaveLength(2);
  });

  it("a site error ends the run as failed, with the reason; the handler does not throw", async () => {
    const id = await jane();
    pages = () => {
      throw new SiteCallError("web", "GET", "/people", 500, "upstream down");
    };
    const stats = await research(id);
    expect(stats.state).toBe("failed");
    expect(stats.error).toContain("upstream down");
    const [row] = await pg.db.select().from(profileLookups);
    expect(row?.state).toBe("failed");
    expect(row?.error).toContain("upstream down");
    expect(await findings()).toEqual([]);
    // A failed run frees the profile for the next one.
    pages = PAGES;
    expect((await research(id)).state).toBe("matched");
  });

  it("a run that was already finished does nothing when sent again", async () => {
    const id = await jane();
    const { lookupId } = await queueProfileResearch(pg.db, id, "william");
    await client(id).run({ lookupId });
    web.calls.length = 0;
    const again = (await client(id).run({ lookupId })) as ProfileResearchStats;
    expect(again.findings).toBe(0);
    expect(web.calls).toEqual([]);
    const [count] = (await pg.db.execute(
      sql`select count(*)::int n from profile_lookups`,
    )) as unknown as { n: number }[];
    expect(count?.n).toBe(1);
  });
});

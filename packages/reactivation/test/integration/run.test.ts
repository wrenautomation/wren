/**
 * `crm status` / `crm run` against the migrated schema: status names the due
 * stages in order, run does them and stops at an abort, a second run is a no-op.
 * A fetcher that finds no page and no LinkedIn account, so company checks end
 * unresolved; the fake LLM cites the first fact it is given.
 */
import { FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import type { Fetcher } from "@wren/research/fetch";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { runCrm } from "../../src/run.js";
import { crmStatus } from "../../src/status.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "briefs",
    "contact_scores",
    "company_checks",
    "findings",
    "person_lookups",
    "documents",
    "runs",
    "verifications",
    "contact_candidates",
    "crm_contacts",
    "sightings",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]),
);
const db = () => pg.db;

const CSV = [
  "ID,Name,Email,Company,Website",
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
].join("\n");
const importCsv = async () => {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(db(), new CrmCsvSource(f, "export.csv", new TextEncoder().encode(CSV)));
};
const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

/** Search answers with nothing, or is down; LinkedIn is never asked (no account). */
function sites(down = false): SiteClient {
  return {
    async call(site, method, path, input = {}) {
      if (down || site !== "web") throw new SiteCallError(site, method, path, 502, "backend down");
      return {
        query: String((input as { q?: string }).q),
        ...(path === "/people"
          ? { people: [], via: "exa" }
          : { hits: [], via: "ddg", tried: ["ddg"] }),
      } as never;
    },
    async via() {
      return "api";
    },
  };
}
/** Cites the first fact in the prompt, as the real one should. */
const llm = new FakeLlm({
  respond: (prompt) => {
    const mark = /\[(f\d+)\]/.exec(prompt)?.[1] ?? "f0";
    return JSON.stringify({ sentences: [`Still there. [${mark}]`] });
  },
});
const nothingThere: Fetcher = {
  userAgent: "test",
  async get(url) {
    return { status: 404, url, text: "" };
  },
};
const deps = (down = false) => ({
  verifier: new FakeVerifier({ authoritative: true }),
  checker,
  sites: sites(down),
  fetcher: nothingThere,
  llm,
});
const ALL = ["verify", "lookup", "signals", "score", "brief"];

describe("crm status", () => {
  it("empty: import first, nothing due", async () => {
    const s = await crmStatus(db());
    expect(s.due).toEqual([]);
    expect(s.next).toMatch(/crm import/);
  });

  it("after import: verify, look up, check companies, score; briefs wait for findings", async () => {
    await importCsv();
    const s = await crmStatus(db());
    expect(s.due).toEqual(["verify", "lookup", "signals", "score"]);
    expect(s.lookup).toMatchObject({ due: 2, matched: 0 });
    expect(s.signals).toMatchObject({ due: 1, hiring: 0 });
    expect(s.next).toBe(
      "`wren --client <id> crm run`: verify 2 addresses, then look up 2 people, then check 1 companies for open roles, then score 2 people",
    );
  });

  it("a parked person is waiting, not due, until the cap lifts", async () => {
    await importCsv();
    await runCrm(db(), deps(), { linkedin: null });
    await db().execute(
      sql`update person_lookups set state = 'capped', retry_at = now() + interval '1 hour'`,
    );
    const s = await crmStatus(db());
    expect(s.due).toEqual([]);
    expect(s.lookup).toMatchObject({ capped: 2, due: 0 });
    expect(s.lookup.waitingUntil).not.toBeNull();
    expect(s.next).toMatch(/^wait: parked on a daily cap: 2 people until/);

    await db().execute(sql`update person_lookups set retry_at = now() - interval '1 minute'`);
    expect((await crmStatus(db())).due).toEqual(["lookup"]);
  });
});

describe("crm run", () => {
  it("does the due stages in order; a second run does nothing", async () => {
    await importCsv();
    const seen: string[] = [];
    const stages = await runCrm(db(), deps(), { linkedin: null }, (r) => seen.push(r.stage));
    expect(seen).toEqual(ALL);
    expect(stages[1]?.stats).toMatchObject({ selected: 2, unresolved: 2, aborted: null });
    expect(stages[2]?.stats).toMatchObject({ selected: 1, unresolved: 1 });
    expect(stages[3]?.stats).toMatchObject({ selected: 2, stillThere: 2 });
    expect(stages[4]?.stats).toMatchObject({ selected: 2, written: 2, dropped: 0 });
    const s = await crmStatus(db());
    expect(s.due).toEqual([]);
    expect(s.next).toMatch(/^nothing due/);
    expect(await runCrm(db(), deps(), { linkedin: null })).toEqual([]);
  });

  it("--limit caps each stage; the next run picks up the rest", async () => {
    await importCsv();
    const first = await runCrm(db(), deps(), { linkedin: null, limit: 1 });
    expect(first.map((r) => [r.stage, r.stats.selected])).toEqual([
      ["verify", 1],
      ["lookup", 1],
      ["signals", 1],
      ["score", 2],
      ["brief", 1],
    ]);
    // Score ran last, over everyone: it is not stale until something new lands.
    expect((await crmStatus(db())).due).toEqual(["verify", "lookup"]);
    await runCrm(db(), deps(), { linkedin: null });
    expect((await crmStatus(db())).due).toEqual([]);
  });

  it("an aborted stage stops the run; the stages after it wait", async () => {
    await importCsv();
    const broken = {
      ...deps(),
      verifier: {
        ...new FakeVerifier({ authoritative: true }),
        name: "broken",
        async verify(): Promise<never> {
          throw new Error("prober down");
        },
      },
    };
    const stages = await runCrm(db(), broken, { linkedin: null });
    expect(stages.map((r) => r.stage)).toEqual(["verify"]);
    expect(stages[0]?.stats.aborted).toMatch(/prober down/);
    expect((await crmStatus(db())).due).toEqual(["verify", "lookup", "signals", "score"]);
  });

  it("lookup errors leave people due for the next run", async () => {
    await importCsv();
    const stages = await runCrm(db(), deps(true), { linkedin: null });
    expect(stages[1]?.stats).toMatchObject({ errors: 2, aborted: null });
    expect((await crmStatus(db())).due).toEqual(["lookup"]);
  });

  it("no LLM: briefs stop the run and say why; the rest is done", async () => {
    await importCsv();
    const stages = await runCrm(db(), { ...deps(), llm: null }, { linkedin: null });
    expect(stages.map((r) => r.stage)).toEqual(ALL);
    expect(stages[4]?.stats.aborted).toMatch(/briefs need an LLM/);
    expect((await crmStatus(db())).due).toEqual(["brief"]);
  });
});

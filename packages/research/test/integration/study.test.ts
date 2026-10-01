/**
 * A study against the migrated schema: one row per unit, a re-run does only
 * what is left, a cap or a failed page holds the claims back, redo throws a
 * step away. Fake sites and a fake model; no network, no sleeping.
 */
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documents, studySteps } from "../../src/schema.js";
import { questionStudy } from "../../src/studies/recipes.js";
import { studyReport } from "../../src/studies/report.js";
import { openStudy, runStudy, studyView } from "../../src/studies/run.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["studies", "documents", "runs"]));
const db = () => pg.db;

const QUOTE = "38% of placements came from repeat clients in 2025";
const pageText = (url: string) =>
  `${url}\n${QUOTE}.\n${"Recruiting firms talk about repeat clients and referrals. ".repeat(8)}`;
const slugOf = (q: string) => q.replace(/\W+/g, "-");

type Fault = (path: string, input: Record<string, unknown>) => Error | null;

/** `web` search and read: one hit per query, every page readable unless `fault` says otherwise. */
function fakeSites(fault: Fault = () => null) {
  const calls: string[] = [];
  const sites: SiteClient = {
    async call<T>(site: string, method: string, path: string, input: Record<string, unknown> = {}) {
      calls.push(`${site} ${path} ${String(input.q ?? input.url ?? "")}`);
      const err = fault(path, input);
      if (err) throw err;
      if (path === "/search") {
        const url = `https://site.example/${slugOf(String(input.q))}`;
        return { hits: [{ title: String(input.q), url, snippet: null }], via: "exa" } as T;
      }
      if (path === "/read") {
        const url = String(input.url);
        return { url, title: `Page ${url}`, text: pageText(url), via: "jina", cut: 0 } as T;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    via: async () => "api",
  };
  return { sites, calls };
}

/** Plans two queries an angle, claims the quote from the first page shown, drafts one item. */
function fakeModel() {
  const prompts: string[] = [];
  const llm = new FakeLlm({
    respond: (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith("You plan")) {
        const angle = /Angle: (.*)/.exec(prompt)?.[1] ?? "";
        return JSON.stringify({ queries: [`${angle} survey`, `${angle} forum`] });
      }
      if (prompt.startsWith("You pull facts")) {
        const url = /=== (\S+)/.exec(prompt)?.[1] ?? "";
        return JSON.stringify({
          claims: [
            {
              claim: "A 2025 survey says 38% of placements are repeat clients.",
              quote: QUOTE,
              source_url: url,
            },
            { claim: "Firms double revenue with 90% retention.", quote: QUOTE, source_url: url },
          ],
        });
      }
      return JSON.stringify({
        items: [
          { title: "Win back the 38%", body: "Most repeat work is waiting [1].", cites: [1] },
        ],
      });
    },
  });
  return { llm, prompts };
}

const input = () => ({
  ...questionStudy("Where do recruiting firms get placements?", ["repeat", "referrals"]),
  drafts: [{ key: "offers", ask: "Write offers." }],
});
const rows = (step: string) =>
  db()
    .select()
    .from(studySteps)
    .where(eq(studySteps.step, step as "read"));
const noSleep = async () => {};

describe("runStudy", () => {
  it("runs every unit once, and a re-run does nothing", async () => {
    await openStudy(db(), "placements", input());
    const { sites, calls } = fakeSites();
    const { llm, prompts } = fakeModel();
    const stats = await runStudy(db(), { sites, llm, sleep: noSleep }, "placements");
    expect(stats).toMatchObject({
      planned: 2,
      searched: 4,
      read: 4,
      claimed: 2,
      kept: 2,
      dropped: 2,
      drafted: 1,
    });
    expect(stats.waiting).toBe(0);
    expect(await db().select().from(documents)).toHaveLength(4);

    const md = studyReport(await studyView(db(), "placements"));
    expect(md).toContain("A 2025 survey says 38% of placements are repeat clients. [1]");
    expect(md).toContain("### Win back the 38%");
    expect(md).toContain("Cites [1]");

    const before = [calls.length, prompts.length];
    const again = await runStudy(db(), { sites, llm, sleep: noSleep }, "placements");
    expect([calls.length, prompts.length]).toEqual(before);
    expect(again).toMatchObject({ planned: 0, searched: 0, read: 0, claimed: 0, drafted: 0 });
  });

  it("a daily cap stops gathering; claims wait and the next run finishes", async () => {
    await openStudy(db(), "capped", input());
    let reads = 0;
    const capped = fakeSites((path) =>
      path === "/read" && ++reads === 2
        ? new SiteCallError("web", "GET", "/read", 429, "retry after 3600s")
        : null,
    );
    const { llm, prompts } = fakeModel();
    const first = await runStudy(db(), { sites: capped.sites, llm, sleep: noSleep }, "capped");
    expect(first.capped?.site).toBe("web");
    expect(first.claimed).toBe(0);
    expect(prompts.filter((p) => p.startsWith("You pull facts"))).toHaveLength(0);

    const second = await runStudy(
      db(),
      { sites: fakeSites().sites, llm, sleep: noSleep },
      "capped",
    );
    expect(second).toMatchObject({ read: 3, claimed: 2, drafted: 1, capped: null });
  });

  it("a failed page is tried again; a refused one is final", async () => {
    await openStudy(db(), "faults", input());
    const { llm } = fakeModel();
    const flaky = fakeSites((path, i) => {
      if (path !== "/read") return null;
      if (String(i.url).includes("repeat-survey"))
        return new SiteCallError("web", "GET", "/read", 404, "gone");
      if (String(i.url).includes("referrals-forum"))
        return new SiteCallError("web", "GET", "/read", 502, "bad gateway");
      return null;
    });
    const first = await runStudy(db(), { sites: flaky.sites, llm, sleep: noSleep }, "faults");
    expect(first).toMatchObject({ refused: 1, failed: 1, claimed: 1, drafted: 0 });
    expect(first.waiting).toBe(2);

    const second = await runStudy(
      db(),
      { sites: fakeSites().sites, llm, sleep: noSleep },
      "faults",
    );
    expect(second).toMatchObject({ read: 1, claimed: 1, drafted: 1, waiting: 0 });
    const outcomes = (await rows("read")).map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["ok", "ok", "ok", "refused"]);
  });

  it("redo throws away a step and the ones after it, nothing before", async () => {
    await openStudy(db(), "redo", input());
    const { sites, calls } = fakeSites();
    const { llm, prompts } = fakeModel();
    await runStudy(db(), { sites, llm, sleep: noSleep }, "redo");
    const [siteCalls, asks] = [calls.length, prompts.length];
    const stats = await runStudy(db(), { sites, llm, sleep: noSleep }, "redo", { redo: "claims" });
    expect(calls.length).toBe(siteCalls);
    expect(prompts.length).toBe(asks + 3);
    expect(stats).toMatchObject({ claimed: 2, drafted: 1 });
  });

  it("a provider failure stops the run and keeps what was done", async () => {
    await openStudy(db(), "down", input());
    const { sites } = fakeSites();
    let asks = 0;
    const llm = new FakeLlm({
      respond: (prompt) => {
        if (++asks > 1) throw new LlmError("provider down");
        return JSON.stringify({ queries: [`${prompt.length}`] });
      },
    });
    const stats = await runStudy(db(), { sites, llm, sleep: noSleep }, "down");
    expect(stats.aborted).toContain("provider down");
    expect(await rows("plan")).toHaveLength(1);
  });

  it("refuses a second study under a slug that asks something else", async () => {
    await openStudy(db(), "same", input());
    await expect(openStudy(db(), "same", input())).resolves.toMatchObject({ slug: "same" });
    await expect(openStudy(db(), "same", questionStudy("Other?"))).rejects.toThrow(/already asks/);
  });
});

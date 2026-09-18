/**
 * Scan → pick → apply-picks against the migrated schema, plus the shell → render
 * tier handoff. Everything runs on fakes: no network, no LLM spend.
 */
import { companies, leads, people, sightings } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../src/enrichment/crawler.js";
import { PICK_VERSION } from "../../src/enrichment/email-pick/graph.js";
import { applyPicks, runEmailPick } from "../../src/enrichment/email-pick/run.js";
import { runScan } from "../../src/enrichment/email-scan.js";
import { applyExtractions, runExtraction } from "../../src/enrichment/extraction.js";
import { runRender } from "../../src/enrichment/render.js";
import { documents, enrichments } from "../../src/schema.js";
import { FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

const ROECO_HOME = `<html><head><title>Roe & Co</title></head><body>
<p>Roe & Co builds storefronts.</p>
<a href="mailto:info@roeco.example">Email us</a>
<a href="/team">Our Team</a>
</body></html>`;
const ROECO_TEAM = `<html><body><h1>Team</h1>
<p>Jane A. Roe, Founder — jane@roeco.example</p></body></html>`;
const SOLO_HOME = `<html><head><title>Solo Studio</title></head><body>
<p>One-person Shopify studio.</p>
<a href="mailto:hello@solo.example">Say hi</a>
</body></html>`;
const PAGES = {
  "https://roeco.example": ROECO_HOME,
  "https://roeco.example/team": ROECO_TEAM,
  "https://solo.example": SOLO_HOME,
};
// Extraction names the founder but "misses" her printed email, so the ONLY path
// her address can take is scan → email pick → sighting.
const ROECO_EXTRACTION =
  '{"people": [{"full_name": "Jane A. Roe", "title": "Founder", "email": null}], "generic_emails": []}';
const ROECO_VERDICT =
  '{"emails": [{"email": "jane@roeco.example", "classification": "person", "person_name": "Jane A. Roe"}, {"email": "info@roeco.example", "classification": "role"}], "best_send_to": "jane@roeco.example"}';

const agency = (domain: string, name: string) =>
  makeCompany(db(), { key: null, domain, name, niche: "agencies" });
const rendered = (html: string) => async (url: string) => ({
  html,
  finalUrl: url,
  statusCode: 200,
});
const SHELL_HOME = `<html><head><script src='/a.js'></script><script src='/b.js'></script><script src='/c.js'></script></head><body><div id="root"></div>${"<!-- pad -->".repeat(200)}</body></html>`;
const RENDERED_HOME = `<html><head><title>SPA Studio</title></head><body>
<p>We are a storefront studio.</p>
<a href="mailto:team@spa.example">Write to us</a>
</body></html>`;

async function seed() {
  const roeco = await agency("roeco.example", "Roe & Co");
  const solo = await agency("solo.example", "Solo Studio");
  await runCrawl(db(), new FakeFetcher(PAGES), { limit: 10 });
  await runExtraction(
    db(),
    new FakeLlm({ respond: (p) => (p.includes("roeco") ? ROECO_EXTRACTION : '{"people": []}') }),
  );
  await applyExtractions(db());
  return { roeco, solo };
}

describe("email pick", () => {
  it("scan → pick → apply lands the person email and the role leads", async () => {
    const { roeco, solo } = await seed();
    const scan = await runScan(db());
    expect(scan.signals).toBeGreaterThanOrEqual(3); // info@ + jane@ (roeco), hello@ (solo)

    // Solo: one on-domain signal, no people → auto-accepted, zero LLM calls. Roeco classifies.
    const llmCalls: string[] = [];
    const llm = new FakeLlm({
      respond: (p) => {
        llmCalls.push(p);
        return ROECO_VERDICT;
      },
    });
    const stats = await runEmailPick(db(), llm);
    expect(stats.picked).toBe(2);
    expect(stats.auto_accepted).toBe(1);
    expect(stats.classified).toBe(1);
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain("roeco");

    const applied = await applyPicks(db());
    expect(applied.picks_applied).toBe(2);
    // "Jane A. Roe" must still reconnect to the person row keyed (Jane, Roe).
    expect(applied.person_emails).toBe(1);
    // BOTH role inboxes land: solo's hello@ and roeco's non-best info@.
    expect(applied.role_leads).toBe(2);

    const [jane] = await db().select().from(people).where(eq(people.companyId, roeco.id));
    const seen = await db()
      .select({ raw: sightings.raw })
      .from(sightings)
      .where(eq(sightings.personId, jane?.id as number));
    expect(seen.map((s) => (s.raw as { email?: string }).email).filter(Boolean)).toEqual([
      "jane@roeco.example",
    ]);

    const [lead] = await db().select().from(leads).where(eq(leads.email, "hello@solo.example"));
    expect(lead?.companyId).toBe(solo.id);
    expect(lead?.source).toBe("email-pick");

    // Idempotent and cached.
    expect((await applyPicks(db())).picks_applied).toBe(0);
    expect((await runEmailPick(db(), llm)).selected).toBe(0);
  });

  it("no-signal companies get free empty verdicts", async () => {
    await agency("quiet.example", "Quiet Co");
    await runCrawl(
      db(),
      new FakeFetcher({
        "https://quiet.example": "<html><body><p>No contact info.</p></body></html>",
      }),
      { limit: 10 },
    );
    await runScan(db());
    const calls: string[] = [];
    const stats = await runEmailPick(
      db(),
      new FakeLlm({
        respond: (p) => {
          calls.push(p);
          return "{}";
        },
      }),
    );
    expect(stats.no_signals).toBe(1);
    expect(calls).toEqual([]);
    const [pick] = await db().select().from(enrichments).where(eq(enrichments.kind, "email_pick"));
    expect(
      (pick?.output as { pick: { best_send_to: unknown } } | undefined)?.pick.best_send_to,
    ).toBeNull();
    expect((await applyPicks(db())).companies_without_send_to).toBe(1);
  });

  it("all-shell companies get recorded no-content picks", async () => {
    const ghost = await agency("ghost.example", "Ghost Co");
    await runCrawl(db(), new FakeFetcher({ "https://ghost.example": SHELL_HOME }), { limit: 10 });
    await runScan(db()); // refuses the shell: zero email_scan rows exist
    const calls: string[] = [];
    const stats = await runEmailPick(
      db(),
      new FakeLlm({
        respond: (p) => {
          calls.push(p);
          return "{}";
        },
      }),
    );
    expect(stats.no_content).toBe(1);
    expect(calls).toEqual([]);
    const [pick] = await db()
      .select()
      .from(enrichments)
      .where(and(eq(enrichments.kind, "email_pick"), eq(enrichments.companyId, ghost.id)));
    expect((pick?.output as { pick: { method: string } } | undefined)?.pick.method).toBe(
      "no_scannable_content",
    );
  });

  it("registry people never block the free route", async () => {
    const solo = await agency("solo.example", "Solo Studio");
    await db().insert(people).values({
      companyId: solo.id,
      fullName: "Reg Istry",
      firstName: "Reg",
      lastName: "Istry",
      isCompliance: false,
      origin: "registry",
      originRef: "adv:1",
      raw: {},
    });
    await runCrawl(db(), new FakeFetcher({ "https://solo.example": SOLO_HOME }), { limit: 10 });
    await runScan(db());
    const calls: string[] = [];
    const stats = await runEmailPick(
      db(),
      new FakeLlm({
        respond: (p) => {
          calls.push(p);
          return "{}";
        },
      }),
    );
    expect(stats.auto_accepted).toBe(1);
    expect(calls).toEqual([]);
  });

  it("stale version picks are never applied", async () => {
    const firm = await agency("stale.example", "Stale Co");
    await db()
      .insert(enrichments)
      .values({
        companyId: firm.id,
        kind: "email_pick",
        model: "fake",
        promptVersion: "v1",
        output: {
          pick: {
            method: "classify",
            emails: [{ email: "old@stale.example", classification: "role" }],
            best_send_to: "old@stale.example",
          },
        },
      });
    expect((await applyPicks(db())).picks_applied).toBe(0);
    expect(await db().select().from(leads).where(eq(leads.email, "old@stale.example"))).toEqual([]);
  });

  it("every grounded role address becomes a lead", async () => {
    const firm = await agency("multi.example", "Multi Co");
    await db()
      .insert(enrichments)
      .values({
        companyId: firm.id,
        kind: "email_pick",
        model: "fake",
        promptVersion: PICK_VERSION,
        output: {
          pick: {
            method: "classify",
            emails: [
              { email: "info@multi.example", classification: "role" },
              { email: "careers@multi.example", classification: "role" },
              { email: "cited@other.example", classification: "other_company" },
            ],
            best_send_to: "info@multi.example",
          },
        },
      });
    const stats = await applyPicks(db());
    expect(stats.role_leads).toBe(2); // other_company stays unpromoted by design
    const emails = await db()
      .select({ email: leads.email })
      .from(leads)
      .where(eq(leads.companyId, firm.id));
    expect(new Set(emails.map((e) => e.email))).toEqual(
      new Set(["info@multi.example", "careers@multi.example"]),
    );
  });
});

describe("render tier", () => {
  it("shell sites route through the render tier", async () => {
    const spa = await agency("spa.example", "SPA Studio");
    const crawl = await runCrawl(db(), new FakeFetcher({ "https://spa.example": SHELL_HOME }), {
      limit: 10,
    });
    expect(crawl.shells_stored).toBe(1);
    expect((await runScan(db())).selected).toBe(0);

    const stats = await runRender(db(), rendered(RENDERED_HOME), new FakeFetcher({}), {
      jitter: [0, 0],
    });
    expect(stats.companies_rendered).toBe(1);
    expect(stats.pages_stored).toBe(1);
    const [browserDoc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, spa.id), eq(documents.fetchTier, "browser")));
    expect(browserDoc?.isShell).toBe(false);
    expect(browserDoc?.html).toContain("team@spa.example");

    // Render-once: a second pass selects nothing.
    const again = await runRender(db(), rendered(RENDERED_HOME), new FakeFetcher({}), {
      jitter: [0, 0],
    });
    expect(again.companies_rendered).toBe(0);

    // The scan now reads the browser-tier sibling.
    const scan = await runScan(db());
    expect(scan.selected).toBe(1);
    expect(scan.signals).toBe(1);
  });

  it("render collision tombstones instead of looping", async () => {
    await agency("loop.example", "Loop Studio");
    await runCrawl(db(), new FakeFetcher({ "https://loop.example": SHELL_HOME }), { limit: 10 });
    // Byte-identical markup: (url, hash) collides and no content row can land.
    const stats = await runRender(db(), rendered(SHELL_HOME), new FakeFetcher({}), {
      jitter: [0, 0],
    });
    expect(stats.pages_stored).toBe(0);
    const again = await runRender(db(), rendered(SHELL_HOME), new FakeFetcher({}), {
      jitter: [0, 0],
    });
    expect(again.companies_rendered).toBe(0);
  });

  it("warn-mode fetch over a disallow is stamped on the document", async () => {
    const walled = await agency("walled.example", "Walled Co");
    const stats = await runCrawl(
      db(),
      new FakeFetcher({
        "https://walled.example/robots.txt": "User-agent: *\nDisallow: /",
        "https://walled.example": "<html><body><p>owner@walled.example</p></body></html>",
      }),
      { limit: 10 },
    );
    expect(stats.robots_warned).toBeGreaterThanOrEqual(1);
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, walled.id), ne(documents.text, "")));
    expect(doc?.robotsDisallowed).toBe(true);
    expect(await db().select().from(companies)).toHaveLength(1);
  });
});

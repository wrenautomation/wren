/**
 * The run ledger and the audit views over it: a stage invocation is a row, what it
 * bought points back at it, and one SQL shape sums every provider's usage.
 */
import { openRun, recordedRun } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, type LlmClient, type LlmResponse } from "@wren/llm";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backfillCallRecords } from "../../src/enrichment/audit-backfill.js";
import { runCrawl } from "../../src/enrichment/crawler.js";
import { applyPicks, runEmailPick } from "../../src/enrichment/email-pick/run.js";
import { runScan } from "../../src/enrichment/email-scan.js";
import { runExtraction } from "../../src/enrichment/extraction.js";
import { upsertEnrichment } from "../../src/enrichment/store.js";
import { documents, enrichments } from "../../src/schema.js";
import { crawlPages, EXTRACTION_JSON, FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

const crawledCompany = async (domain = "ledger.example") => {
  const company = await makeCompany(db(), {
    key: "crd:940001",
    domain,
    name: "Ledger Co",
    niche: "agencies",
  });
  await runCrawl(db(), new FakeFetcher(crawlPages(domain)), { limit: 10 });
  return company;
};

/** A fake whose body reports usage the OpenAI-compatible way, so the view's arithmetic is exercised. */
const usageFakeLlm: LlmClient = {
  name: "groq:fake-model",
  provider: "groq",
  async complete(): Promise<LlmResponse> {
    return {
      text: EXTRACTION_JSON,
      raw: {
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
      latencyMs: 50,
    };
  },
};

const runIdsFor = async (kind: "email_scan" | "people_extraction" | "email_pick") =>
  new Set(
    (
      await db()
        .select({ runId: enrichments.runId })
        .from(enrichments)
        .where(eq(enrichments.kind, kind))
    ).map((r) => r.runId),
  );

describe("run ledger", () => {
  it("stage outputs point back at their run", async () => {
    await crawledCompany();
    const scan = await recordedRun(db(), { command: "enrich scan", argv: {} }, (run) =>
      runScan(db(), { runId: run.id }),
    );
    const extract = await recordedRun(
      db(),
      { command: "enrich extract", argv: {}, model: "groq:fake-model" },
      (run) => runExtraction(db(), usageFakeLlm, { runId: run.id }),
    );
    expect(extract.stats.extracted).toBeGreaterThan(0);
    const pick = await recordedRun(
      db(),
      { command: "enrich pick", argv: {}, model: "fake" },
      (run) => runEmailPick(db(), new FakeLlm(), { runId: run.id }),
    );
    expect(await runIdsFor("email_scan")).toEqual(new Set([scan.run.id]));
    expect(await runIdsFor("people_extraction")).toEqual(new Set([extract.run.id]));
    expect(await runIdsFor("email_pick")).toEqual(new Set([pick.run.id]));
  });

  it("llm calls and stage costs sum normalized usage", async () => {
    await crawledCompany();
    const { run, stats } = await recordedRun(
      db(),
      { command: "enrich extract", argv: {}, model: "groq:fake-model" },
      (r) => runExtraction(db(), usageFakeLlm, { runId: r.id }),
    );
    const calls = await db().execute(
      sql`SELECT provider, input_tokens, output_tokens, total_tokens, latency_ms, finish_reason, rejected, parse_failed, has_call_record FROM email_llm_calls WHERE run_id = ${run.id}`,
    );
    expect(calls).toHaveLength(stats.selected);
    for (const c of calls) {
      expect(c).toEqual({
        provider: "groq",
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        latency_ms: 50,
        finish_reason: "stop",
        rejected: false,
        parse_failed: false,
        has_call_record: true,
      });
    }
    const [cost] = await db().execute(
      sql`SELECT calls, total_tokens, avg_latency_ms, command, kind FROM email_stage_costs WHERE run_id = ${run.id}`,
    );
    expect(cost).toEqual({
      calls: String(stats.selected),
      total_tokens: String(120 * stats.selected),
      avg_latency_ms: 50,
      command: "enrich extract",
      kind: "people_extraction",
    });
    // Deterministic scan rows never appear: nothing was bought.
    await runScan(db());
    const [n] = await db().execute(
      sql`SELECT count(*)::int AS n FROM email_llm_calls WHERE kind = 'email_scan'`,
    );
    expect(n?.n).toBe(0);
  });

  it("free pick routes store the uniform envelope", async () => {
    const company = await makeCompany(db(), {
      key: null,
      domain: "solo.example",
      name: "Solo",
      niche: "agencies",
    });
    const home = '<html><body><a href="mailto:hello@solo.example">x</a></body></html>';
    await runCrawl(db(), new FakeFetcher({ "https://solo.example": home }), { limit: 10 });
    await runScan(db());
    await runEmailPick(db(), new FakeLlm());
    const [row] = await db()
      .select()
      .from(enrichments)
      .where(and(eq(enrichments.kind, "email_pick"), eq(enrichments.companyId, company.id)));
    const output = row?.output as Record<string, unknown> & { pick: { method: string } };
    expect(output.pick.method).toBe("auto_accept");
    for (const key of ["raw_text", "api", "call", "parse_error", "provider_rejected"])
      expect(key in output).toBe(true);
    expect(output.call).toBeNull();
    const [n] = await db().execute(
      sql`SELECT count(*)::int AS n FROM email_llm_calls WHERE enrichment_id = ${row?.id}`,
    );
    expect(n?.n).toBe(0);
    expect((await applyPicks(db())).role_leads).toBe(1);
  });

  it("backfill gives legacy rows the record and one layout", async () => {
    const company = await makeCompany(db(), {
      key: null,
      domain: "legacy.example",
      name: "Legacy",
      niche: "agencies",
    });
    const [doc] = await db()
      .insert(documents)
      .values({
        companyId: company.id,
        url: "https://legacy.example",
        kind: "webpage",
        contentHash: "x".repeat(64),
        text: "hi",
      })
      .returning();
    const [legacyPick] = await db()
      .insert(enrichments)
      .values({
        companyId: company.id,
        kind: "email_pick",
        model: "cohere:command-a-03-2025",
        promptVersion: "v3",
        output: {
          pick: { method: "classify", emails: [], best_send_to: null },
          parse_error: null,
          provider_rejected: null,
          llm: {
            raw_text: "{}",
            api: {
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
              choices: [{ finish_reason: "stop" }],
            },
          },
        },
      })
      .returning();
    const [rejectedExtraction] = await db()
      .insert(enrichments)
      .values({
        documentId: doc?.id,
        kind: "people_extraction",
        model: "gemini:gemini-2.5-flash",
        promptVersion: "v1",
        output: {
          raw_text: null,
          parsed: null,
          parse_error: null,
          provider_rejected: "HTTP 422",
          ungrounded_emails: [],
          api: null,
        },
      })
      .returning();
    const [legacyFreePick] = await db()
      .insert(enrichments)
      .values({
        companyId: company.id,
        kind: "email_pick",
        model: "fake",
        promptVersion: "v3",
        output: {
          pick: { method: "auto_accept", emails: [], best_send_to: "hi@legacy.example" },
          parse_error: null,
          provider_rejected: null,
          llm: null,
        },
      })
      .returning();

    const stats = await backfillCallRecords(db());
    expect(stats).toEqual({ selected: 3, backfilled: 3, legacy_pick_lifted: 1, free_routes: 1 });
    const outputOf = async (id: number | undefined) =>
      (
        await db()
          .select()
          .from(enrichments)
          .where(eq(enrichments.id, id as number))
      )[0]?.output as Record<string, unknown>;
    const free = await outputOf(legacyFreePick?.id);
    expect("llm" in free).toBe(false);
    expect(free.call).toBeNull();
    const [n] = await db().execute(
      sql`SELECT count(*)::int AS n FROM email_llm_calls WHERE enrichment_id = ${legacyFreePick?.id}`,
    );
    expect(n?.n).toBe(0);
    const pick = await outputOf(legacyPick?.id);
    expect("llm" in pick).toBe(false);
    expect(pick.raw_text).toBe("{}");
    const call = pick.call as { provider: string; usage: { total: number }; run_id: unknown };
    expect(call.provider).toBe("cohere");
    expect(call.usage.total).toBe(12);
    expect(call.run_id).toBeNull();
    const rejected = (await outputOf(rejectedExtraction?.id)).call as {
      rejected: boolean;
      provider: string;
    };
    expect(rejected.rejected).toBe(true);
    expect(rejected.provider).toBe("gemini");
    // Idempotent.
    expect((await backfillCallRecords(db())).selected).toBe(0);
    // And the view now sums them.
    const [total] = await db().execute(
      sql`SELECT sum(total_tokens)::int AS total FROM email_llm_calls WHERE has_call_record`,
    );
    expect(total?.total).toBe(12);
  });

  it("upsert retry keeps the failed attempts record", async () => {
    const company = await makeCompany(db(), {
      key: null,
      domain: "retry.example",
      name: "Retry",
      niche: "agencies",
    });
    const first = await openRun(db(), { command: "enrich pick", argv: {} });
    const second = await openRun(db(), { command: "enrich pick", argv: {} });
    await upsertEnrichment(db(), {
      companyId: company.id,
      kind: "email_pick",
      model: "fake",
      promptVersion: "v3",
      output: { pick: {}, parse_error: "truncated", call: { latency_ms: 5 } },
      runId: first.id,
    });
    const row = await upsertEnrichment(db(), {
      companyId: company.id,
      kind: "email_pick",
      model: "fake",
      promptVersion: "v3",
      output: { pick: {}, parse_error: null, call: { latency_ms: 9 } },
      runId: second.id,
    });
    expect(row.runId).toBe(second.id);
    expect((row.output as { previous_attempts: unknown }).previous_attempts).toEqual([
      { parse_error: "truncated", call: { latency_ms: 5 } },
    ]);
  });
});

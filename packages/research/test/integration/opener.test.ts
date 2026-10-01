/**
 * Opener lines against the migrated schema: who is selected, what one row holds,
 * run stats and abort, and the recruiting_facts view that carries the line to
 * the template. Fake LLM only.
 */
import { companies, imports, leads, recruitingFacts } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError, LlmInputRejected } from "@wren/llm";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PPP_MODEL } from "../../src/companies/ppp-size.js";
import {
  OPENER_VERSION,
  runOpener,
  selectOpenerTargets,
  writeOpener,
} from "../../src/enrichment/opener.js";
import { type DocumentKind, documents, enrichments } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

let n = 0;
async function addCompany(
  name: string,
  opts: { niche?: string | null; raw?: Record<string, unknown> | null } = {},
): Promise<number> {
  n += 1;
  const [row] = await db()
    .insert(companies)
    .values({
      domain: `c${n}.example`,
      name,
      niche: opts.niche === undefined ? "recruiting" : opts.niche,
      raw: opts.raw === undefined ? {} : opts.raw,
    })
    .returning({ id: companies.id });
  return (row as { id: number }).id;
}

async function addPage(
  companyId: number,
  url: string,
  text: string,
  opts: { isShell?: boolean; kind?: DocumentKind; fetchedAt?: Date } = {},
): Promise<void> {
  n += 1;
  await db()
    .insert(documents)
    .values({
      companyId,
      url,
      text,
      kind: opts.kind ?? "webpage",
      isShell: opts.isShell ?? false,
      contentHash: `h${n}`,
      ...(opts.fetchedAt ? { fetchedAt: opts.fetchedAt } : {}),
    });
}

async function addLead(
  companyId: number,
  status: "imported" | "verified" | "suppressed" | "undeliverable" = "imported",
): Promise<void> {
  n += 1;
  const [batch] = await db()
    .insert(imports)
    .values({ sourceType: "test", sourceRef: "inline", stats: {} })
    .returning({ id: imports.id });
  await db()
    .insert(leads)
    .values({
      email: `lead${n}@x.example`,
      status,
      raw: {},
      importId: (batch as { id: number }).id,
      companyId,
    });
}

/** A company that should be selected: one page, one mailable lead. */
async function ready(name: string, text: string, niche: string | null = "recruiting") {
  const id = await addCompany(name, { niche });
  await addPage(id, `https://c${id}.example/`, text);
  await addLead(id);
  return id;
}

const TULSA = "Tulsa Nurse Partners places ICU nurses in Tulsa hospitals since 1999.";
const answer = (line: string | null, quote: string | null, source_url: string | null = null) =>
  JSON.stringify({ line, quote, source_url });
const GOOD = answer(
  "You have placed ICU nurses in Tulsa hospitals since 1999.",
  "places ICU nurses in Tulsa hospitals since 1999",
);
const NONE = answer(null, null, null);

/** Answers by which company the prompt names. */
const byCompany = (answers: Record<string, string | (() => never)>) =>
  new FakeLlm({
    respond: (p) => {
      const company = /Company: (.*)\n/.exec(p)?.[1] ?? "";
      const a = answers[company];
      if (a === undefined) throw new Error(`no answer for ${company}`);
      return typeof a === "function" ? a() : a;
    },
  });

const openerRows = () =>
  db()
    .select()
    .from(enrichments)
    .where(eq(enrichments.kind, "opener"))
    .orderBy(asc(enrichments.id));
type OpenerOutput = {
  opener: { line: string; quote: string; source_url: string } | null;
  rejected: string | null;
  pages: string[];
  parse_error: string | null;
  provider_rejected: string | null;
  previous_attempts?: unknown[];
};
const out = (row: { output: unknown } | undefined) => row?.output as OpenerOutput;

describe("selectOpenerTargets", () => {
  it("needs a non-shell webpage with text and an imported or verified lead", async () => {
    const imported = await ready("Imported", TULSA);
    const verified = await addCompany("Verified");
    await addPage(verified, "https://v.example/", TULSA);
    await addLead(verified, "verified");
    const suppressed = await addCompany("Suppressed");
    await addPage(suppressed, "https://s.example/", TULSA);
    await addLead(suppressed, "suppressed");
    const bounced = await addCompany("Bounced");
    await addPage(bounced, "https://b.example/", TULSA);
    await addLead(bounced, "undeliverable");
    const shell = await addCompany("Shell");
    await addPage(shell, "https://sh.example/", TULSA, { isShell: true });
    await addLead(shell);
    const empty = await addCompany("Empty");
    await addPage(empty, "https://e.example/", "");
    await addLead(empty);
    const snippet = await addCompany("Snippet");
    await addPage(snippet, "https://sn.example/", TULSA, { kind: "snippet" });
    await addLead(snippet);
    const noPage = await addCompany("No page");
    await addLead(noPage);
    const noLead = await addCompany("No lead");
    await addPage(noLead, "https://nl.example/", TULSA);

    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([imported, verified]);
  });

  it("filters by niche and honors the limit in id order", async () => {
    const a = await ready("A", TULSA, "recruiting");
    const b = await ready("B", TULSA, "agencies");
    const c = await ready("C", TULSA, "recruiting");
    const llm = new FakeLlm();
    expect(await selectOpenerTargets(db(), llm, { niche: "recruiting" })).toEqual([a, c]);
    expect(await selectOpenerTargets(db(), llm, { niche: null })).toEqual([a, b, c]);
    expect(await selectOpenerTargets(db(), llm, { limit: 2 })).toEqual([a, b]);
  });

  it("skips a finished row for this model and version, retries a parse failure", async () => {
    const done = await ready("Done", TULSA);
    const otherModel = await ready("Other model", TULSA);
    const oldVersion = await ready("Old version", TULSA);
    const failed = await ready("Failed", TULSA);
    const row = (companyId: number, model: string, promptVersion: string, output: object) =>
      db().insert(enrichments).values({ companyId, kind: "opener", model, promptVersion, output });
    await row(done, "fake", OPENER_VERSION, { parse_error: null, opener: null, rejected: null });
    await row(otherModel, "claude-x", OPENER_VERSION, { parse_error: null, opener: null });
    await row(oldVersion, "fake", "v0", { parse_error: null, opener: null });
    await row(failed, "fake", OPENER_VERSION, { parse_error: "no json", opener: null });
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([
      otherModel,
      oldVersion,
      failed,
    ]);
  });
});

describe("writeOpener", () => {
  it("stores one opener row with the line, quote, source page and pages shown", async () => {
    const id = await addCompany("Tulsa Nurse Partners");
    await addPage(id, "https://tnp.example/about", "Founded by two ICU nurses in 1999.");
    await addPage(id, "https://tnp.example/", TULSA);
    await addPage(id, "https://tnp.example/", "Shell text that must not be shown.", {
      isShell: true,
    });
    await addLead(id);
    const prompts: string[] = [];
    const llm = new FakeLlm({
      respond: (p) => {
        prompts.push(p);
        return GOOD;
      },
    });
    const r = await writeOpener(db(), llm, id, {});
    expect(r).toEqual({ outcome: "written", rejected: null });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Company: Tulsa Nurse Partners\n");
    expect(prompts[0]).toContain(`=== https://tnp.example/\n${TULSA}`);
    expect(prompts[0]).not.toContain("Shell text");
    // Homepage before the about page.
    expect(prompts[0]?.indexOf("=== https://tnp.example/\n")).toBeLessThan(
      prompts[0]?.indexOf("=== https://tnp.example/about") ?? -1,
    );

    const rows = await openerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: id,
      documentId: null,
      kind: "opener",
      model: "fake",
      promptVersion: OPENER_VERSION,
    });
    expect(out(rows[0])).toMatchObject({
      opener: {
        line: "You have placed ICU nurses in Tulsa hospitals since 1999.",
        quote: "places ICU nurses in Tulsa hospitals since 1999",
        source_url: "https://tnp.example/",
      },
      rejected: null,
      pages: ["https://tnp.example/", "https://tnp.example/about"],
      parse_error: null,
    });
  });

  it("uses the newest copy of a page", async () => {
    const id = await addCompany("Fresh Co");
    await addPage(id, "https://f.example/", "Old words about Denver since 1990.", {
      fetchedAt: new Date("2025-01-01T00:00:00Z"),
    });
    await addPage(id, "https://f.example/", TULSA, { fetchedAt: new Date("2026-01-01T00:00:00Z") });
    const prompts: string[] = [];
    await writeOpener(
      db(),
      new FakeLlm({
        respond: (p) => {
          prompts.push(p);
          return GOOD;
        },
      }),
      id,
    );
    expect(prompts[0]).toContain(TULSA);
    expect(prompts[0]).not.toContain("Denver");
  });

  it("a no-line answer is stored and counts as done", async () => {
    const id = await ready("Quiet Co", TULSA);
    const r = await writeOpener(db(), new FakeLlm({ default: NONE }), id);
    expect(r).toEqual({ outcome: "no_line", rejected: null });
    const rows = await openerRows();
    expect(rows).toHaveLength(1);
    expect(out(rows[0])).toMatchObject({ opener: null, rejected: null, parse_error: null });
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([]);
  });

  it("a rejected line is stored with its reason and not retried", async () => {
    const id = await ready("Loud Co", TULSA);
    const loud = answer(
      "You place ICU nurses in Tulsa hospitals!",
      "places ICU nurses in Tulsa hospitals",
    );
    const r = await writeOpener(db(), new FakeLlm({ default: loud }), id);
    expect(r).toEqual({ outcome: "rejected", rejected: "style" });
    const rows = await openerRows();
    expect(out(rows[0])).toMatchObject({ opener: null, rejected: "style" });
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([]);
  });

  it("a parse failure is stored, retried, and the retry lands on the same row", async () => {
    const id = await ready("Garbled Co", TULSA);
    const first = await writeOpener(db(), new FakeLlm({ default: "not json at all" }), id);
    expect(first).toEqual({ outcome: "parse_error", rejected: null });
    expect(out((await openerRows())[0]).parse_error).toBeTruthy();
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([id]);

    const second = await writeOpener(db(), new FakeLlm({ default: GOOD }), id);
    expect(second).toEqual({ outcome: "written", rejected: null });
    const rows = await openerRows();
    expect(rows).toHaveLength(1);
    expect(out(rows[0]).parse_error).toBeNull();
    expect(out(rows[0]).opener?.line).toContain("Tulsa");
    expect(out(rows[0]).previous_attempts).toHaveLength(1);
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([]);
  });

  it("no pages writes nothing", async () => {
    const id = await addCompany("Blank Co");
    await addPage(id, "https://blank.example/", TULSA, { isShell: true });
    const r = await writeOpener(db(), new FakeLlm({ default: GOOD }), id);
    expect(r).toEqual({ outcome: "no_pages", rejected: null });
    expect(await openerRows()).toEqual([]);
    expect((await writeOpener(db(), new FakeLlm(), 999_999)).outcome).toBe("no_pages");
  });

  it("falls back to the domain when the company has no name", async () => {
    const [row] = await db()
      .insert(companies)
      .values({ domain: "nameless.example", name: null, niche: "recruiting", raw: {} })
      .returning({ id: companies.id });
    const id = (row as { id: number }).id;
    await addPage(id, "https://nameless.example/", TULSA);
    const prompts: string[] = [];
    await writeOpener(
      db(),
      new FakeLlm({
        respond: (p) => {
          prompts.push(p);
          return NONE;
        },
      }),
      id,
    );
    expect(prompts[0]).toContain("Company: nameless.example\n");
  });
});

describe("runOpener", () => {
  it("counts written, no line, rejections by reason, parse errors and provider rejections", async () => {
    await ready("Written Co", TULSA);
    await ready("Nothing Co", TULSA);
    await ready("Invented Co", TULSA);
    await ready("Long Co", TULSA);
    await ready("Garbled Co", TULSA);
    await ready("Refused Co", TULSA);
    const llm = byCompany({
      "Written Co": GOOD,
      "Nothing Co": NONE,
      "Invented Co": answer("You place ICU nurses in Denver.", "we place ICU nurses in Denver"),
      "Long Co": answer(
        `You ${"really ".repeat(25)}place ICU nurses.`,
        "places ICU nurses in Tulsa hospitals",
      ),
      "Garbled Co": "sorry, I cannot help",
      "Refused Co": () => {
        throw new LlmInputRejected("HTTP 400");
      },
    });
    const stats = await runOpener(db(), llm, { niche: "recruiting" });
    expect(stats).toEqual({
      selected: 6,
      written: 1,
      no_line: 1,
      rejected: { quote_not_found: 1, too_long: 1 },
      parse_errors: 1,
      provider_rejected: 1,
      no_pages: 0,
      aborted: null,
    });
    expect(await openerRows()).toHaveLength(6);
    const refused = (await openerRows()).find((r) => out(r).provider_rejected !== null);
    expect(out(refused).provider_rejected).toBe("HTTP 400");

    // Only the parse failure comes back.
    const again = await runOpener(db(), byCompany({ "Garbled Co": GOOD }));
    expect(again).toMatchObject({ selected: 1, written: 1 });
  });

  it("aborts on a provider failure and keeps the progress made", async () => {
    const first = await ready("First Co", TULSA);
    const second = await ready("Second Co", TULSA);
    const third = await ready("Third Co", TULSA);
    const llm = byCompany({
      "First Co": GOOD,
      "Second Co": () => {
        throw new LlmError("provider down");
      },
      "Third Co": GOOD,
    });
    const stats = await runOpener(db(), llm);
    expect(stats).toMatchObject({ selected: 3, written: 1, aborted: "provider down" });
    const rows = await openerRows();
    expect(rows.map((r) => r.companyId)).toEqual([first]);
    expect(await selectOpenerTargets(db(), new FakeLlm())).toEqual([second, third]);
  });

  it("any other error propagates", async () => {
    await ready("Boom Co", TULSA);
    await expect(
      runOpener(
        db(),
        byCompany({
          "Boom Co": () => {
            throw new TypeError("bug");
          },
        }),
      ),
    ).rejects.toThrow("bug");
    expect(await openerRows()).toEqual([]);
  });
});

describe("recruiting_facts view", () => {
  const ppp = (companyId: number, output: object, createdAt: string, model = PPP_MODEL) =>
    db()
      .insert(enrichments)
      .values({
        companyId,
        kind: "firmographics",
        model,
        promptVersion: createdAt.slice(0, 10),
        output,
        createdAt: new Date(createdAt),
      });
  const opener = (companyId: number, line: string | null, createdAt: string, model: string) =>
    db()
      .insert(enrichments)
      .values({
        companyId,
        kind: "opener",
        model,
        promptVersion: OPENER_VERSION,
        output: {
          parse_error: null,
          opener: line === null ? null : { line, quote: "q", source_url: "u" },
          rejected: null,
        },
        createdAt: new Date(createdAt),
      });
  const video = (companyId: number, url: string | null, createdAt: string, version: string) =>
    db()
      .insert(enrichments)
      .values({
        companyId,
        kind: "video",
        model: "reactivation-demo",
        promptVersion: version,
        output: url === null ? { firm: "x" } : { url, firm: "x" },
        createdAt: new Date(createdAt),
      });
  const facts = async () =>
    new Map((await db().select().from(recruitingFacts)).map((r) => [r.companyId as number, r]));

  it("employees and payroll from the newest PPP row, zero as null", async () => {
    const sized = await addCompany("Sized");
    await ppp(
      sized,
      { jobs_reported: 10, payroll_yearly_estimate: 500_000 },
      "2025-01-01T00:00:00Z",
    );
    await ppp(
      sized,
      { jobs_reported: 30, payroll_yearly_estimate: 1_200_000 },
      "2026-01-01T00:00:00Z",
    );
    await ppp(sized, { jobs_reported: 99 }, "2026-06-01T00:00:00Z", "other-model");
    const zero = await addCompany("Zero");
    await ppp(zero, { jobs_reported: 0, payroll_yearly_estimate: 0 }, "2026-01-01T00:00:00Z");
    const nulls = await addCompany("Nulls");
    await ppp(
      nulls,
      { jobs_reported: null, payroll_yearly_estimate: null },
      "2026-01-01T00:00:00Z",
    );
    const otherOnly = await addCompany("Other only");
    await ppp(otherOnly, { jobs_reported: 12 }, "2026-01-01T00:00:00Z", "other-model");

    const f = await facts();
    expect(f.get(sized)).toMatchObject({ employees: 30, payrollYearlyUsd: 1_200_000 });
    expect(f.get(zero)).toMatchObject({ employees: null, payrollYearlyUsd: null });
    expect(f.get(nulls)).toMatchObject({ employees: null, payrollYearlyUsd: null });
    expect(f.get(otherOnly)).toMatchObject({ employees: null, payrollYearlyUsd: null });
  });

  it("founded_year from raw.sba.year_established", async () => {
    const str = await addCompany("String", { raw: { sba: { year_established: "1998" } } });
    const num = await addCompany("Number", { raw: { sba: { year_established: 2004 } } });
    const noisy = await addCompany("Noisy", { raw: { sba: { year_established: "Est. 2011" } } });
    const blank = await addCompany("Blank", { raw: { sba: { year_established: "" } } });
    const none = await addCompany("None", { raw: { sba: {} } });
    const noSba = await addCompany("No sba", { raw: { geo: "Tulsa, OK" } });
    const nullRaw = await addCompany("Null raw", { raw: null });

    const f = await facts();
    expect(f.get(str)?.foundedYear).toBe(1998);
    expect(f.get(num)?.foundedYear).toBe(2004);
    expect(f.get(noisy)?.foundedYear).toBe(2011);
    for (const id of [blank, none, noSba, nullRaw]) expect(f.get(id)?.foundedYear).toBeNull();
  });

  it("opener is the newest row that has a line, across models", async () => {
    const id = await addCompany("Lined");
    await opener(id, "Old line.", "2025-01-01T00:00:00Z", "model-a");
    await opener(id, "Newest line.", "2026-01-01T00:00:00Z", "model-b");
    await opener(id, null, "2026-06-01T00:00:00Z", "model-c");
    const empty = await addCompany("No line");
    await opener(empty, null, "2026-01-01T00:00:00Z", "model-a");
    const bare = await addCompany("Bare");

    const f = await facts();
    expect(f.get(id)?.opener).toBe("Newest line.");
    expect(f.get(empty)?.opener).toBeNull();
    expect(f.get(bare)).toMatchObject({ opener: null, employees: null, foundedYear: null });
  });

  it("video_url is the newest render that has a url, across walk versions", async () => {
    const id = await addCompany("Filmed");
    await video(id, "https://w.example/v/old", "2025-01-01T00:00:00Z", "1");
    await video(id, "https://w.example/v/new", "2026-01-01T00:00:00Z", "2");
    await video(id, null, "2026-06-01T00:00:00Z", "3");
    const bare = await addCompany("Unfilmed");

    const f = await facts();
    expect(f.get(id)?.videoUrl).toBe("https://w.example/v/new");
    expect(f.get(bare)?.videoUrl).toBeNull();
  });

  it("only recruiting companies, with their identity columns", async () => {
    const rec = await addCompany("Rec Co");
    const agency = await addCompany("Agency Co", { niche: "agencies" });
    const unset = await addCompany("Unset Co", { niche: null });
    const f = await facts();
    expect([...f.keys()]).toEqual([rec]);
    expect(f.has(agency) || f.has(unset)).toBe(false);
    expect(f.get(rec)).toMatchObject({ name: "Rec Co", domain: `c${n - 2}.example` });
  });

  it("an opener written by runOpener reaches the view", async () => {
    const id = await ready("Tulsa Nurse Partners", TULSA);
    await runOpener(db(), new FakeLlm({ default: GOOD }));
    expect((await facts()).get(id)?.opener).toBe(
      "You have placed ICU nurses in Tulsa hospitals since 1999.",
    );
  });
});

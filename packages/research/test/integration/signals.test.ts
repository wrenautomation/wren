/**
 * Signals on a real Postgres: the checks, dating on keep, the backfill, the runner and
 * `signalsFor`. Synthetic firms only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { people } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { googleLeft } from "../../src/enrichment/profiles.js";
import { keepFinding, keepSignal } from "../../src/findings.js";
import { findings, signalChecks } from "../../src/schema.js";
import {
  type BaseDeps,
  type Collected,
  defineCollector,
  firmKey,
  passOf,
  runSignals,
  SIGNALS_GOOGLE_PER_DAY,
  signalPlan,
  signalsFor,
  signalUnit,
} from "../../src/signals/collectors.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "findings", "signal_checks", "documents"]));
const db = () => pg.db;

const LINK = "https://news.example/a";
const news = (companyId: number, over: Record<string, unknown> = {}) => ({
  kind: "news" as const,
  companyId,
  factKey: `c${companyId}:news:a`,
  value: { title: "Opened a second office", topic: "growth", raw: { id: 1 } },
  confidence: 0.9,
  via: "test",
  sourceUrl: LINK,
  document: null,
  signalAt: new Date("2026-09-01T00:00:00Z"),
  dated: "published" as const,
  ...over,
});
const row = async (id: number) =>
  (await db().select().from(findings).where(eq(findings.id, id)))[0];

describe("the checks", () => {
  it("refuse a dated row with no link, no dated, or a non-signal kind", async () => {
    const firm = await makeCompany(db());
    const insert = (over: Record<string, unknown>) =>
      db()
        .insert(findings)
        .values({
          kind: "news",
          companyId: firm.id,
          factKey: `k${Math.random()}`,
          value: {},
          confidence: 1,
          via: "t",
          sourceUrl: LINK,
          signalAt: new Date(),
          signalDated: "seen",
          ...over,
        });
    await expect(insert({ sourceUrl: null })).rejects.toThrow();
    await expect(insert({ signalDated: null })).rejects.toThrow();
    await expect(insert({ kind: "profile" })).rejects.toThrow();
    await expect(insert({})).resolves.toBeDefined();
  });
});

describe("keepFinding and keepSignal", () => {
  it("date a signal kind from its value; a first-seen date stays; a read with no link keeps it", async () => {
    const firm = await makeCompany(db());
    const base = { ...news(firm.id), signalAt: null, dated: null };
    const id = await keepFinding(db(), { ...base, value: { date: "2026-08-30" } });
    expect((await row(id))?.signalDated).toBe("published");
    const hiring = { ...base, kind: "hiring" as const, factKey: "h", value: { roles: [] } };
    const h = await keepFinding(db(), hiring);
    const first = (await row(h))?.signalAt;
    expect((await row(h))?.signalDated).toBe("seen");
    await keepFinding(db(), { ...hiring, sourceUrl: null });
    expect((await row(h))?.signalAt).toEqual(first);
    expect((await row(h))?.sourceUrl).toBe(LINK);
    // A profile is never dated.
    const p = await keepFinding(db(), {
      ...base,
      kind: "profile",
      factKey: "p",
      value: { published_at: "2020-01-01" },
    });
    expect((await row(p))?.signalAt).toBeNull();
  });

  it("keepSignal refuses a draft with no raw and writes nothing", async () => {
    const firm = await makeCompany(db());
    const r = await keepSignal(db(), news(firm.id, { value: { title: "t" } }));
    expect(r).toEqual({ ok: false, reason: "no raw" });
    expect(await db().select().from(findings)).toHaveLength(0);
    expect((await keepSignal(db(), news(firm.id))).ok).toBe(true);
  });
});

describe("the backfill", () => {
  it("dates news, posts, hiring and job changes with a link; the rest stay undated", async () => {
    const firm = await makeCompany(db());
    const raw = (kind: string, value: object, sourceUrl: string | null = LINK) =>
      db()
        .insert(findings)
        .values({
          kind: kind as "news",
          companyId: firm.id,
          factKey: `${kind}:${JSON.stringify(value)}:${sourceUrl}`,
          value,
          confidence: 1,
          via: "t",
          sourceUrl,
        })
        .returning({ id: findings.id })
        .then((r) => r[0]?.id as number);
    const n = await raw("news", { date: "2026-08-01" });
    const nl = await raw("news", { date: "2026-08-01" }, null);
    const po = await raw("post", { published_at: "2026-09-10T08:00:00Z" });
    const hi = await raw("hiring", { roles: [{ postedAt: "2026-09-01" }, { postedAt: "x" }] });
    const hs = await raw("hiring", { count: 2 });
    const jc = await raw("job_change", { to: "Acme" });
    const pr = await raw("profile", { published_at: "2020-01-01" });
    const dir = new URL("../../../db/drizzle/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_signals.sql")) as string;
    const backfill = readFileSync(new URL(file, dir), "utf8").split("-- Hand-written backfill")[1];
    for (const stmt of (backfill as string).split("--> statement-breakpoint"))
      if (stmt.includes("UPDATE")) await db().execute(sql.raw(stmt.slice(stmt.indexOf("UPDATE"))));
    expect((await row(n))?.signalAt).toEqual(new Date("2026-08-01T00:00:00Z"));
    expect((await row(nl))?.signalAt).toBeNull();
    expect((await row(po))?.signalDated).toBe("published");
    expect((await row(hi))?.signalAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect((await row(hs))?.signalDated).toBe("seen");
    expect((await row(jc))?.signalDated).toBe("seen");
    expect((await row(pr))?.signalAt).toBeNull();
  });
});

describe("the runner", () => {
  const fake = (answer: (subject: string) => Collected) =>
    defineCollector({
      name: "fake",
      subject: "company",
      built: true,
      settings: z.object({ words: z.number().default(3) }),
      bucket: { perDay: 100, burst: 10 },
      everyDays: 7,
      metered: false,
      async collect(_deps, subject, s) {
        expect(s.words).toBe(3);
        return answer(subject);
      },
    });
  const base = (): BaseDeps => ({
    db: db(),
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
  });

  it("keeps what passes, notes what is refused, waits everyDays, and dry writes nothing", async () => {
    const firm = await makeCompany(db(), { name: "Verdano Advisors" });
    const [jane] = await db()
      .insert(people)
      .values({
        companyId: firm.id,
        fullName: "Jane Roe",
        firstName: "Jane",
        lastName: "Roe",
        isCompliance: false,
        origin: "website",
        originRef: "test",
        raw: {},
      })
      .returning({ id: people.id });
    const c = fake(() => ({
      state: "found",
      signals: [news(firm.id), news(firm.id, { factKey: "bad", sourceUrl: null })],
      tried: [{ step: "google", what: "q", outcome: "read" }],
    }));
    const pass = await passOf(db(), "n", [jane?.id as number]);
    expect(pass.companyIds).toEqual([firm.id]);
    const on = { fake: { on: true } };
    const opts = { pass, timezone: "UTC" };

    const dry = await runSignals([c], on, base(), { ...opts, dry: true });
    expect(dry.collectors.fake?.found).toBe(1);
    expect(await db().select().from(signalChecks)).toHaveLength(0);

    const s = await runSignals([c], on, base(), opts);
    expect(s).toMatchObject({ checked: 1, kept: 1 });
    expect(s.collectors.fake).toMatchObject({ selected: 1, found: 1, refused: 1 });
    const [check] = await db().select().from(signalChecks);
    expect(check).toMatchObject({ collector: "fake", subject: firmKey(firm.id), found: 1 });
    expect(JSON.stringify(check?.tried)).toContain("refused: no link");

    // Not due again inside everyDays; off means not run.
    expect((await runSignals([c], on, base(), opts)).collectors.fake?.selected).toBe(0);
    expect(
      (await runSignals([c], { fake: { on: false } }, base(), opts)).collectors.fake?.stopped,
    ).toBe("off in settings");

    // A person's signals include their firm's.
    const got = await signalsFor(db(), { personId: jane?.id as number });
    expect(got.map((g) => [g.kind, g.subject, g.url])).toEqual([
      ["news", "Verdano Advisors", LINK],
    ]);
    expect(await signalsFor(db(), { companyId: firm.id, kinds: ["hiring"] })).toEqual([]);
  });

  it("found with nothing kept is none", async () => {
    const firm = await makeCompany(db());
    const c = fake(() => ({
      state: "found",
      signals: [news(firm.id, { signalAt: null })],
      tried: [],
    }));
    const pass = await passOf(db(), "n", [], [firm.id]);
    const s = await runSignals([c], { fake: { on: true } }, base(), { pass, timezone: "UTC" });
    expect(s.collectors.fake).toMatchObject({ none: 1, refused: 1 });
  });
});

describe("metered collectors and the vendor gate", () => {
  const metered = (answer: (subject: string) => Collected) =>
    defineCollector({
      name: "paid",
      subject: "company",
      built: true,
      settings: z.object({}),
      bucket: { perDay: 100, burst: 10 },
      everyDays: 7,
      metered: true,
      vendors: ["exa", "models"],
      spends: (subject) => (subject.endsWith("1") ? ["exa"] : ["exa", "models"]),
      async collect(_deps, subject) {
        return answer(subject);
      },
    });
  const base = (): BaseDeps => ({
    db: db(),
    sites: null,
    desk: null,
    fetcher: null,
    pages: null,
    youtube: null,
    llm: null,
    linkedin: null,
  });
  const on = { paid: { on: true } };

  it("plans nothing without a yes from each vendor, and no more than the smallest room", async () => {
    const firms = [];
    for (const n of [1, 2, 3])
      firms.push(await makeCompany(db(), { key: `crd:93100${n}`, domain: `paid${n}.example` }));
    const pass = await passOf(
      db(),
      "n",
      [],
      firms.map((f) => f.id),
    );
    const c = metered(() => ({ state: "none", signals: [], tried: [] }));
    const plan = (rooms: Record<string, number | null | string>) =>
      signalPlan(db(), [c], on, pass, {
        now: new Date(),
        gate: async (vendor) => {
          const r = rooms[vendor];
          return typeof r === "string"
            ? { ok: false, why: r, mode: null }
            : { ok: true, mode: "own", bucket: `${vendor}:own:x`, room: r ?? null };
        },
      });
    expect(await plan({ exa: 5, models: "Needs setup" })).toMatchObject([
      { name: "paid", subjects: [], why: "Needs setup" },
    ]);
    expect((await plan({ exa: 2, models: null }))[0]?.subjects).toHaveLength(2);
    expect((await plan({ exa: null, models: null }))[0]?.subjects).toHaveLength(3);
  });

  it("meters what a read answered, by the subject's vendors, and never what failed", async () => {
    const metering: string[][] = [];
    const meter = async (vendors: readonly string[]) => {
      metering.push([...vendors]);
    };
    const found = metered(() => ({ state: "none", signals: [], tried: [] }));
    await signalUnit(found, "c1", { on: true }, base(), { timezone: "UTC", meter });
    await signalUnit(found, "c2", { on: true }, base(), { timezone: "UTC", meter });
    await signalUnit(found, "c3", { on: true }, base(), { timezone: "UTC", meter, dry: true });
    const lost = metered(() => ({ state: "unresolved", signals: [], tried: [] }));
    await signalUnit(lost, "c4", { on: true }, base(), { timezone: "UTC", meter });
    const broke = metered(() => {
      throw new Error("site down");
    });
    const r = await signalUnit(broke, "c5", { on: true }, base(), { timezone: "UTC", meter });
    expect(r.state).toBe("error");
    expect(metering).toEqual([["exa"], ["exa", "models"]]);

    // A meter that fails is logged, not thrown: the read isn't retried and bought twice.
    const after = await signalUnit(found, "c6", { on: true }, base(), {
      timezone: "UTC",
      meter: async () => {
        throw new Error("main is down");
      },
    });
    expect(after.state).toBe("none");
  });
});

describe("Google's share", () => {
  it("signals spend at most their 50 of the day's searches", async () => {
    const now = new Date("2026-10-06T15:00:00Z");
    const tried = Array.from({ length: SIGNALS_GOOGLE_PER_DAY }, () => ({
      step: "google",
      what: "q",
      outcome: "read",
    }));
    await db()
      .insert(signalChecks)
      .values({ collector: "news", subject: "c1", state: "found", tried, checkedAt: now });
    expect(await googleLeft(db(), { now, timezone: "UTC", signals: SIGNALS_GOOGLE_PER_DAY })).toBe(
      0,
    );
    expect(await googleLeft(db(), { now, timezone: "UTC" })).toBe(200 - SIGNALS_GOOGLE_PER_DAY);
  });
});

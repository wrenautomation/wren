/** Copy experiments on a real database: start, counts with thread credit, tick, import, moves. */
import { randomUUID } from "node:crypto";
import { companies } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  approveCandidate,
  listCandidates,
  proposeCandidates,
  rejectCandidate,
  seedExperiment,
} from "../../src/evolve/candidates.js";
import {
  experimentTemplates,
  moveExperiment,
  startExperiment,
  switchSetting,
  tickExperiment,
} from "../../src/evolve/experiments.js";
import { alleleStats } from "../../src/evolve/stats.js";
import { parseTemplate, toSource } from "../../src/outreach/authoring.js";
import { alleleKey, render, type Template, variantPoints } from "../../src/outreach/templates.js";
import { tickAll } from "../../src/restate/evolution.js";
import {
  enrollments,
  experimentAlleles,
  experimentJournal,
  experimentSnapshots,
  experiments,
  messages,
  templateVersions,
  threadEvents,
} from "../../src/schema.js";
import { TABLES } from "./compose-fixtures.js";

const NICHE = "sec_ria";
const DAY = 86_400_000;
const T0 = new Date(Date.UTC(2026, 8, 1, 12));
const at = (days: number) => new Date(T0.getTime() + days * DAY);

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    ...TABLES,
    "experiments",
    "experiment_alleles",
    "experiment_snapshots",
    "experiment_journal",
    "messages",
    "thread_events",
  ]),
);
const db = (): Db => pg.db;

const FILE = parseTemplate(
  "opener",
  "subject: [[Quick question | A question]] for {company_name}\n\n[[Hi | Hey]] there.",
);
const keysAt = (tpl: Template, locus: string) =>
  [...variantPoints([...(tpl.subject ?? []), ...tpl.body])]
    .find((p) => p.name === locus)
    ?.options.map(alleleKey) ?? [];

let companyId = 0;
beforeEach(async () => {
  const [co] = await db()
    .insert(companies)
    .values({ domain: "acme.example", name: "Acme", niche: NICHE, raw: {} })
    .returning();
  companyId = (co as { id: number }).id;
});

/** `n` finished enrollments, each sent `template` at `sentAt` with these picks. */
async function sends(
  n: number,
  version: string,
  picks: Record<string, number>,
  opts: { template?: string; step?: number; sentAt?: Date; enrollmentIds?: number[] } = {},
): Promise<number[]> {
  const ids =
    opts.enrollmentIds ??
    (
      await db()
        .insert(enrollments)
        .values(
          Array.from({ length: n }, () => ({
            personId: null,
            companyId,
            kind: "role_inbox" as const,
            toEmail: `info-${randomUUID().slice(0, 8)}@acme.example`,
            sender: "will@wren-a.test",
            niche: NICHE,
            sequenceName: "seq",
            sequenceSnapshot: { name: "seq", steps: [] },
            offer: "test-offer",
            state: "finished" as const,
          })),
        )
        .returning({ id: enrollments.id })
    ).map((r) => r.id);
  await db()
    .insert(messages)
    .values(
      ids.map((enrollmentId) => ({
        enrollmentId,
        step: opts.step ?? 0,
        template: opts.template ?? "opener",
        templateVersion: version,
        toEmail: "info@acme.example",
        subject: "hi",
        body: "hi",
        provenance: { picks },
        state: "sent" as const,
        messageId: `<${randomUUID()}@wren-a.test>`,
        sentAt: opts.sentAt ?? at(0),
      })),
    );
  return ids;
}

async function replies(ids: readonly number[], when: Date, disposition = "interested") {
  if (ids.length === 0) return;
  await db()
    .insert(threadEvents)
    .values(
      ids.map((enrollmentId) => ({
        enrollmentId,
        kind: "reply" as const,
        disposition: disposition as "interested",
        dispositionSource: "operator" as const,
        fromAddress: "info@acme.example",
        receivedAt: when,
        gmailId: randomUUID().replaceAll("-", ""),
      })),
    );
}

const journalKinds = async (id: number) =>
  (
    await db()
      .select({ kind: experimentJournal.kind })
      .from(experimentJournal)
      .where(eq(experimentJournal.experimentId, id))
      .orderBy(asc(experimentJournal.id))
  ).map((r) => r.kind);

describe("experimentTemplates", () => {
  it("hands back the files untouched when nothing evolves", async () => {
    const files = new Map([["opener", FILE]]);
    const out = await experimentTemplates(db(), NICHE, files);
    expect(out.templates).toBe(files);
    expect(out.allocations.size).toBe(0);
  });
});

describe("startExperiment", () => {
  it("names every point, writes the genome and seeds each option as a live allele", async () => {
    const exp = await startExperiment(db(), { niche: NICHE, file: FILE });
    expect(exp.state).toBe("running");
    const [genome] = await db()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.version, exp.liveVersion));
    expect(genome?.experimentId).toBe(exp.id);
    expect(genome?.parentVersion).toBe(FILE.version);
    expect(genome?.source).toContain("[[#v1 Quick question | A question]]");
    const alleles = await db().select().from(experimentAlleles);
    expect(alleles.map((a) => [a.locus, a.state, a.origin])).toEqual([
      ["v1", "live", "seed"],
      ["v1", "live", "seed"],
      ["v2", "live", "seed"],
      ["v2", "live", "seed"],
    ]);
    expect(await journalKinds(exp.id)).toEqual(["start", "seed"]);
    await expect(startExperiment(db(), { niche: NICHE, file: FILE })).rejects.toThrow(
      /already holds/,
    );
    // The genome renders as the file did: its names are the auto names.
    const { templates } = await experimentTemplates(db(), NICHE, new Map([["opener", FILE]]));
    const live = templates.get("opener") as Template;
    for (const seed of ["person:1", "person:2", "person:3"]) {
      const a = render(live, { company_name: "Acme" }, seed);
      const b = render(FILE, { company_name: "Acme" }, seed);
      expect([a.subject, a.body]).toEqual([b.subject, b.body]);
    }
  });
});

describe("alleleStats", () => {
  it("counts recipients, crediting each allele sent before an outcome on its thread", async () => {
    const [opened] = await sends(1, FILE.version, { v1: 0, v2: 1 });
    // The follow-up's reply still credits the opener's picks.
    await sends(
      1,
      FILE.version,
      {},
      {
        template: "followup",
        step: 1,
        enrollmentIds: [opened as number],
      },
    );
    const late = await sends(2, FILE.version, { v1: 1, v2: 0 }, { sentAt: at(3) });
    await replies([opened as number], at(5));
    // Answered before the send: no credit.
    await replies([late[0] as number], at(1));
    await db()
      .insert(templateVersions)
      .values({ niche: NICHE, template: "opener", version: FILE.version, source: toSource(FILE) });
    const stats = await alleleStats(db(), NICHE, "opener");
    const [quick, question] = keysAt(FILE, "v1");
    const [hi, hey] = keysAt(FILE, "v2");
    expect(stats.get("v1")?.get(quick as string)).toMatchObject({ exposures: 1, interested: 1 });
    expect(stats.get("v1")?.get(question as string)).toMatchObject({
      exposures: 2,
      replies: 0,
      interested: 0,
    });
    expect(stats.get("v2")?.get(hey as string)).toMatchObject({ exposures: 1, replies: 1 });
    expect(stats.get("v2")?.get(hi as string)).toMatchObject({ exposures: 2, replies: 0 });
  });
});

describe("tickExperiment", () => {
  it("retires a clear loser, rewrites the genome without it, settles and stops", async () => {
    const exp = await startExperiment(db(), {
      niche: NICHE,
      file: FILE,
      settings: { minSends: 100 },
    });
    const v = exp.liveVersion;
    // v1: option 0 wins clearly. v2: option 1 wins clearly.
    const a = await sends(300, v, { v1: 0, v2: 1 });
    const b = await sends(300, v, { v1: 1, v2: 0 });
    await replies(a.slice(0, 45), at(2));
    await replies(b.slice(0, 3), at(2));
    const r = await tickExperiment(db(), exp.id, FILE);
    expect(r?.retired.map((x) => [x.locus, x.reason]).sort()).toEqual([
      ["v1", "p_best"],
      ["v2", "p_best"],
    ]);
    expect(r?.genomeChanged).toBe(true);
    expect(r?.settled.sort()).toEqual(["v1", "v2"]);
    expect(r?.stopped).toBe("settled");
    const [row] = await db().select().from(experiments);
    expect([row?.state, row?.stopReason]).toEqual(["settled", "settled"]);
    const [genome] = await db()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.version, row?.liveVersion as string));
    expect(genome?.parentVersion).toBe(v);
    expect(genome?.source).toContain("[[#v1 Quick question]]");
    expect(genome?.source).toContain("[[#v2 Hey]]");
    expect(await db().select().from(experimentSnapshots)).toHaveLength(1);
    expect(await journalKinds(exp.id)).toEqual([
      "start",
      "seed",
      "retire",
      "retire",
      "snapshot",
      "settle",
      "settle",
      "stop",
    ]);
    // Settled: compose keeps rendering the frozen genome with the last shares.
    const { templates, allocations } = await experimentTemplates(
      db(),
      NICHE,
      new Map([["opener", FILE]]),
    );
    expect(templates.get("opener")?.version).toBe(row?.liveVersion);
    expect(allocations.get("opener")?.shares).toEqual({ v1: [1], v2: [1] });
    // A settled experiment does not tick until resumed.
    expect(await tickExperiment(db(), exp.id, FILE)).toBeNull();
  });

  it("imports a file edit: new options go live, dropped ones retire", async () => {
    const exp = await startExperiment(db(), { niche: NICHE, file: FILE });
    const edited = parseTemplate(
      "opener",
      "subject: [[Quick question | Short question]] for {company_name}\n\n[[Hi | Hey]] there, friend.",
    );
    const r = await tickExperiment(db(), exp.id, edited);
    expect(r?.imported).toBe(true);
    const alleles = await db().select().from(experimentAlleles).orderBy(asc(experimentAlleles.id));
    expect(alleles.map((x) => [x.locus, x.text, x.state, x.origin])).toEqual([
      ["v1", "Quick question", "live", "seed"],
      ["v1", "A question", "retired", "seed"],
      ["v2", "Hi", "live", "seed"],
      ["v2", "Hey", "live", "seed"],
      ["v1", "Short question", "live", "import"],
    ]);
    const [row] = await db().select().from(experiments);
    expect(row?.fileVersion).toBe(edited.version);
    const [genome] = await db()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.version, row?.liveVersion as string));
    expect(genome?.source).toContain("[[#v1 Quick question | Short question]]");
    expect(genome?.source).toContain("there, friend.");
    expect(await journalKinds(exp.id)).toContain("import");
    // The same file again imports nothing.
    expect((await tickExperiment(db(), exp.id, edited))?.imported).toBe(false);
  });
});

describe("settings and moves", () => {
  it("switches a setting, refuses a bad one, and walks pause, resume, stop", async () => {
    const exp = await startExperiment(db(), { niche: NICHE, file: FILE });
    const next = await switchSetting(db(), exp.id, "guards.negativeRatio", 3);
    expect(next.guards.negativeRatio).toBe(3);
    await expect(switchSetting(db(), exp.id, "selection", "greedy")).rejects.toThrow();
    await expect(switchSetting(db(), exp.id, "nope", 1)).rejects.toThrow();
    expect((await moveExperiment(db(), exp.id, "pause")).state).toBe("paused");
    expect(await tickExperiment(db(), exp.id, FILE)).toBeNull();
    await expect(moveExperiment(db(), exp.id, "pause")).rejects.toThrow(/cannot pause/);
    expect((await moveExperiment(db(), exp.id, "resume")).state).toBe("running");
    expect((await moveExperiment(db(), exp.id, "stop")).state).toBe("stopped");
    // Stopped: the file renders again, and a new experiment may start.
    const files = new Map([["opener", FILE]]);
    expect((await experimentTemplates(db(), NICHE, files)).templates).toBe(files);
    await startExperiment(db(), { niche: NICHE, file: FILE });
    expect(await journalKinds(exp.id)).toEqual([
      "start",
      "seed",
      "switch",
      "pause",
      "resume",
      "stop",
    ]);
  });
});

describe("tickAll", () => {
  it("ticks each running experiment once, skipping one ticked in the last 20 hours", async () => {
    await startExperiment(db(), { niche: NICHE, file: FILE });
    const now = new Date();
    const first = await tickAll(db(), new Map(), { now, trackOpens: false, skipRecent: true });
    expect([first.ticked.length, first.skipped]).toEqual([1, 0]);
    const again = await tickAll(db(), new Map(), { now, trackOpens: false, skipRecent: true });
    expect([again.ticked.length, again.skipped]).toEqual([0, 1]);
    const forced = await tickAll(db(), new Map(), { now, trackOpens: false });
    expect(forced.ticked[0]?.generation).toBe(2);
  });
});

/** A fake model that answers each tier by its prompt. */
function fakeTiers(over: { strategist?: string; writer?: string[]; judge?: string } = {}) {
  const calls: string[] = [];
  const llm = new FakeLlm({
    respond: (prompt) => {
      if (prompt.includes("Pick what the writer works on next")) {
        calls.push("strategist");
        return (
          over.strategist ??
          '{"mode":"fix","loci":["growth"],"mutation":"rewrite_loser","temperature":0.4,"reason":"growth lags"}'
        );
      }
      if (prompt.includes("You write copy for one point")) {
        calls.push("writer");
        return JSON.stringify({
          options: over.writer ?? [
            "I read that {company_name} grew",
            "your team grew — a lot this year",
            "I saw {company_name} grew this year",
            "I noticed {company_name} is growing",
            "hello {first_name}, your team grew",
            "word is {company_name} keeps growing",
          ],
        });
      }
      calls.push("judge");
      return (
        over.judge ??
        '{"scores":[{"n":1,"score":6,"angle":"proof"},{"n":2,"score":8,"angle":"curiosity"},{"n":3,"score":4,"angle":"pain"}]}'
      );
    },
  });
  return { llmFor: () => llm, calls };
}

const GROWTH = parseTemplate(
  "opener",
  "subject: [[Quick question | A question]] for {company_name}\n\n[[#growth I saw {company_name} grew this year | your team at {company_name} grew a lot]].",
);

describe("candidates", () => {
  it("writes, checks and judges candidates; approve makes a new genome version; reject keeps it out", async () => {
    const exp = await startExperiment(db(), { niche: NICHE, file: GROWTH });
    await tickExperiment(db(), exp.id, GROWTH);
    const fake = fakeTiers();
    const p = await proposeCandidates(db(), exp.id, fake.llmFor);
    expect(fake.calls).toEqual(["strategist", "writer", "judge"]);
    // The dash, the unknown fact and the repeat of a live allele are dropped; three wait.
    expect(p.loci).toEqual([{ locus: "growth", written: 6, checked: 3, queued: 3, error: null }]);
    expect(p.queued.map((q) => q.text)).toEqual([
      "I noticed {company_name} is growing",
      "I read that {company_name} grew",
      "word is {company_name} keeps growing",
    ]);
    const waiting = await listCandidates(db());
    expect(waiting.map((c) => [c.origin, c.judgeScore, c.angle, c.reason])).toEqual([
      ["mutation", 8, "curiosity", "growth lags"],
      ["mutation", 6, "proof", "growth lags"],
      ["mutation", 4, "pain", "growth lags"],
    ]);
    expect(waiting[0]?.winners.map((w) => w.text).sort()).toEqual([
      "I saw {company_name} grew this year",
      "your team at {company_name} grew a lot",
    ]);
    // growth's queue is full, so the plan falls back to the subject, where every option is too long.
    const again = await proposeCandidates(db(), exp.id, fakeTiers().llmFor);
    expect(again.queued).toEqual([]);

    const [first, second, third] = waiting as [
      (typeof waiting)[0],
      (typeof waiting)[0],
      (typeof waiting)[0],
    ];
    const before = (await db().select().from(experiments).where(eq(experiments.id, exp.id)))[0];
    const d = await approveCandidate(db(), first.id, { by: "test" });
    const [after] = await db().select().from(experiments).where(eq(experiments.id, exp.id));
    expect(after?.liveVersion).toBe(d.version);
    expect(d.version).not.toBe(before?.liveVersion);
    const [version] = await db()
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.version, d.version));
    expect(version).toMatchObject({ parentVersion: before?.liveVersion, experimentId: exp.id });
    const { templates, allocations } = await experimentTemplates(
      db(),
      NICHE,
      new Map([["opener", GROWTH]]),
    );
    const genome = templates.get("opener") as Template;
    expect(keysAt(genome, "growth")).toContain(first.allele);
    // Newer than the snapshot: it renders at the floor.
    expect(allocations.get("opener")?.shares.growth).toEqual([0.5, 0.5, 0.05]);

    await expect(approveCandidate(db(), first.id, { by: "test" })).rejects.toThrow(
      /not a candidate/,
    );
    await expect(
      approveCandidate(db(), second.id, { by: "test", text: "they grew — fast" }),
    ).rejects.toThrow(/edit refused: a dash/);
    const edited = await approveCandidate(db(), second.id, {
      by: "test",
      text: "{company_name|your firm} grew fast",
    });
    expect(edited.allele).not.toBe(second.allele);
    await rejectCandidate(db(), third.id, { by: "test" });
    const rows = await db()
      .select()
      .from(experimentAlleles)
      .where(eq(experimentAlleles.experimentId, exp.id))
      .orderBy(asc(experimentAlleles.id));
    expect(rows.slice(-3).map((r) => [r.state, r.decidedBy])).toEqual([
      ["live", "test"],
      ["live", "test"],
      ["rejected", "test"],
    ]);
    expect(rows.at(-2)?.text).toBe("{company_name|your firm} grew fast");
    const [rejectRow] = await db()
      .select()
      .from(experimentJournal)
      .where(eq(experimentJournal.id, rows.at(-1)?.journalId as number));
    expect(rejectRow?.outcome).toEqual({ state: "rejected", by: "test" });
    expect(await journalKinds(exp.id)).toEqual([
      "start",
      "seed",
      "snapshot",
      "strategist",
      "check",
      "judge",
      "candidate",
      "candidate",
      "candidate",
      "strategist",
      "check",
      "approve",
      "edit",
      "approve",
      "reject",
    ]);
  });

  it("falls back when the strategist answers nonsense, and autoApprove puts candidates live", async () => {
    const exp = await startExperiment(db(), {
      niche: NICHE,
      file: GROWTH,
      settings: { autoApprove: true, queueSize: 1 },
    });
    await tickExperiment(db(), exp.id, GROWTH);
    const p = await proposeCandidates(
      db(),
      exp.id,
      fakeTiers({ strategist: "sure!", writer: ["A short question", "One quick question"] }).llmFor,
    );
    expect(p.plan?.fallback).toBe(true);
    expect(p.approved).toBe(1);
    const live = await db()
      .select()
      .from(experimentAlleles)
      .where(
        and(eq(experimentAlleles.experimentId, exp.id), eq(experimentAlleles.origin, "mutation")),
      );
    expect(live.map((r) => [r.state, r.decidedBy])).toEqual([["live", "auto"]]);
  });

  it("llm_seed queues candidates at every locus; from_winners puts another experiment's best live", async () => {
    const seeded = await startExperiment(db(), {
      niche: NICHE,
      file: GROWTH,
      settings: { seeding: "llm_seed", queueSize: 1 },
    });
    const fake = fakeTiers({
      writer: ["I saw {company_name} is growing", "a quick question"],
      judge: '{"scores":[{"n":1,"score":5,"angle":"pain"}]}',
    });
    const out = await seedExperiment(db(), seeded.id, { llmFor: fake.llmFor });
    expect(fake.calls).not.toContain("strategist");
    // Two loci, one candidate each (the subject's "a quick question" passes there).
    expect(out.queued).toBe(2);
    expect((await listCandidates(db())).map((c) => [c.locus, c.origin])).toEqual([
      ["v1", "seed"],
      ["growth", "seed"],
    ]);
    await moveExperiment(db(), seeded.id, "stop");

    const source = await startExperiment(db(), { niche: NICHE, file: GROWTH });
    await tickExperiment(db(), source.id, GROWTH);
    const other = parseTemplate(
      "opener",
      "subject: [[Quick question | A question]] for {company_name}\n\n[[#growth {company_name} keeps growing | a growing team at {company_name}]].",
    );
    await moveExperiment(db(), source.id, "stop");
    const target = await startExperiment(db(), {
      niche: NICHE,
      file: other,
      settings: { seeding: "from_winners" },
    });
    await expect(seedExperiment(db(), target.id, {})).rejects.toThrow(/needs the experiment/);
    const won = await seedExperiment(db(), target.id, { from: source.id });
    // v1 already holds the source's best; growth takes it.
    expect([won.imported, won.skipped]).toEqual([1, 1]);
    const [t] = await db().select().from(experiments).where(eq(experiments.id, target.id));
    const genome = (
      await experimentTemplates(db(), NICHE, new Map([["opener", other]]))
    ).templates.get("opener") as Template;
    expect(genome.version).toBe(t?.liveVersion);
    expect(keysAt(genome, "growth")).toHaveLength(3);
  });

  it("tickAll runs the tiers when the strategist is due", async () => {
    await startExperiment(db(), { niche: NICHE, file: GROWTH, settings: { strategistEvery: 1 } });
    const fake = fakeTiers();
    const out = await tickAll(db(), new Map(), {
      now: new Date(),
      trackOpens: false,
      llmFor: fake.llmFor,
    });
    expect(out.proposed).toEqual([
      { experiment: out.ticked[0]?.experiment, queued: 3, approved: 0 },
    ]);
  });
});

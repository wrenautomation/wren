/** Copy experiments on a real database: start, counts with thread credit, tick, import, moves. */
import { randomUUID } from "node:crypto";
import { companies } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

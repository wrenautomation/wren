/**
 * Experiments in the console over a real database: the three record types, the lineage and
 * settings panel, and the team's handlers (approve, edit, reject, pause, switch, start).
 */

import { loadSettings } from "@wren/config";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startExperiment, tickExperiment } from "../../src/evolve/experiments.js";
import { parseOption } from "../../src/evolve/tiers.js";
import { parseTemplate } from "@wren/core/slots";
import { alleleKey } from "@wren/core/slots";
import { emailRecords } from "../../src/records.js";
import { emailConsoleApi } from "../../src/restate/console.js";
import { experimentAlleles, experimentJournal, experiments } from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";

const NICHE = "sec_ria";
const GROWTH = parseTemplate(
  "opener",
  "subject: [[Quick question | A question]] for {company_name}\n\n[[#growth I saw {company_name} grew this year | your team at {company_name} grew a lot]].",
);
const policy = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
const op = { viewer: { email: "op@example.test", operator: true } };
const client = { viewer: { email: "amy@acme.test" } };

let pg: TestPostgres;
let expId = 0;
const candidates: number[] = [];
beforeAll(async () => {
  pg = await startTestPostgres();
  const exp = await startExperiment(pg.db, { niche: NICHE, file: GROWTH });
  await tickExperiment(pg.db, exp.id, GROWTH);
  expId = exp.id;
  for (const text of [
    "I noticed {company_name} is growing",
    "word is {company_name} keeps growing",
    "I read that {company_name} grew",
  ]) {
    const [made] = await pg.db
      .insert(experimentJournal)
      .values({
        experimentId: exp.id,
        generation: 1,
        kind: "candidate",
        locus: "growth",
        detail: { reason: "growth lags" },
      })
      .returning();
    const [row] = await pg.db
      .insert(experimentAlleles)
      .values({
        experimentId: exp.id,
        locus: "growth",
        allele: alleleKey(parseOption(text)),
        text,
        state: "candidate",
        origin: "mutation",
        judgeScore: 7,
        journalId: (made as { id: number }).id,
      })
      .returning();
    candidates.push((row as { id: number }).id);
  }
});
afterAll(() => pg.stop());

const serve = () => serveRecords(emailRecords([], policy), pg.db);
const api = () =>
  emailConsoleApi({
    db: pg.db,
    senders: [],
    policy,
    campaigns: new Map([[NICHE, { templates: new Map([["opener", GROWTH]]) }]]) as never,
  });

describe("experiment records", () => {
  it("lists the experiment, its options and what waits, with the live ones beside a candidate", async () => {
    const list = await serve().list({ record: "email.experiment", view: "running" });
    expect(list.rows).toMatchObject([{ id: expId, state: "running", waiting: 3 }]);
    const waiting = await serve().list({ record: "email.candidate", view: "waiting" });
    expect(waiting.rows).toHaveLength(3);
    const one = await serve().get({ record: "email.candidate", id: String(candidates[0]) });
    expect(
      (one.detail as { winners: { text: string }[] }).winners.map((w) => w.text).sort(),
    ).toEqual(["I saw {company_name} grew this year", "your team at {company_name} grew a lot"]);
    expect((one.detail as { frame: unknown }).frame).toEqual({
      subject: "Quick question for «company_name»",
      body: "WRENSLOT.",
      slot: "WRENSLOT",
    });
    const exp = await serve().get({ record: "email.experiment", id: String(expId) });
    expect(exp.related).toEqual([
      { record: "email.allele", count: 7 },
      { record: "email.candidate", count: 3 },
    ]);
    const detail = exp.detail as {
      lineage: { added: unknown[] }[];
      settings: { field: string; hint: string }[];
    };
    expect(detail.lineage).toHaveLength(1);
    expect(detail.settings.find((f) => f.field === "selection")?.hint).toMatch(/^Now thompson\./);
    expect(detail.settings.some((f) => f.field === "seeding")).toBe(false);
  });

  it("team only; approve, edit and reject; the lineage shows what was added", async () => {
    await expect(
      api().decideCandidates("approve", { ...client, ids: [candidates[0] as number] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      api().decideCandidates("approve", { ...op, ids: candidates, text: "one edit" }),
    ).rejects.toThrow(/one candidate at a time/);
    expect(
      await api().decideCandidates("approve", { ...op, ids: [candidates[0] as number] }),
    ).toEqual({ done: [String(candidates[0])], skipped: [] });
    await expect(
      api().decideCandidates("approve", { ...op, ids: [candidates[1] as number], text: "a — b" }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/edit refused/) });
    await api().decideCandidates("approve", {
      ...op,
      ids: [candidates[1] as number],
      text: "{company_name|your firm} grew fast",
    });
    await api().decideCandidates("reject", { ...op, ids: [candidates[2] as number] });
    const rows = await pg.db
      .select()
      .from(experimentAlleles)
      .where(eq(experimentAlleles.experimentId, expId));
    expect(
      rows.filter((r) => candidates.includes(r.id)).map((r) => [r.state, r.decidedBy]),
    ).toEqual([
      ["live", "console:op@example.test"],
      ["live", "console:op@example.test"],
      ["rejected", "console:op@example.test"],
    ]);
    const exp = await serve().get({ record: "email.experiment", id: String(expId) });
    const lineage = (exp.detail as { lineage: { added: { text: string }[]; live: boolean }[] })
      .lineage;
    expect(lineage).toHaveLength(3);
    expect(lineage.at(-1)?.live).toBe(true);
    expect(lineage[1]?.added.map((a) => a.text)).toEqual(["I noticed {company_name} is growing"]);
  });

  it("switches only what's given, refuses a bad value, pauses and resumes", async () => {
    await expect(
      api().switchExperiments({ ...op, ids: [expId], settings: { selection: "dice" } }),
    ).rejects.toMatchObject({ status: 400 });
    await api().switchExperiments({
      ...op,
      ids: [expId],
      settings: { queueSize: 2, guards: { negativeRatio: 0.2 } },
    });
    const [after] = await pg.db.select().from(experiments).where(eq(experiments.id, expId));
    expect(after?.settings).toMatchObject({ queueSize: 2, guards: { negativeRatio: 0.2 } });
    await api().moveExperiments("pause", { ...op, ids: [expId] });
    expect(
      (await serve().get({ record: "email.experiment", id: String(expId) })).row,
    ).toMatchObject({ state: "paused" });
    await api().moveExperiments("resume", { ...op, ids: [expId] });
  });

  it("start refuses an unknown template and a second experiment on the same one", async () => {
    await expect(
      api().startExperiment({ ...op, niche: NICHE, template: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      api().startExperiment({ ...op, niche: NICHE, template: "opener" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

/**
 * Opportunities on a real Postgres (designs/2026-10-09-opportunities.md): the default pipeline
 * on the first look, deals made and moved (each move kept, each one fired), won and lost by
 * kind, the saved views, stage edits that refuse to strand deals, and owners kept apart: Wren's
 * deals, a client's, and a viewer who may only read. Synthetic data only.
 */
import { addClient, addMember, addOperator } from "@wren/core/clients";
import { logicOf, triggerHears } from "@wren/core/logic";
import type { Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dealFired, dealsConsoleApi } from "../../src/console.js";
import { dealRecordFor, rowOf, STALE_DAYS } from "../../src/records.js";
import { movesOf } from "../../src/store.js";

let pg: TestPostgres;
const OWNER = "owner@acme.example.test";
const VAL = "val@acme.example.test";
const ADA = "ada@example.test";
const as = (email: string, client?: string, operator = false) => ({
  viewer: { email, ...(operator ? { operator: true } : {}) } as Viewer,
  ...(client ? { client } : {}),
});
const api = () => dealsConsoleApi({ main: pg.db });

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Plumbing", products: {} });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  await addMember(pg.db, "acme", VAL, { role: "viewer" });
  await addOperator(pg.db, ADA);
});
afterAll(() => pg.stop());

describe("a client's board", () => {
  it("makes the default pipeline on the first look", async () => {
    const b = await api().board(as(OWNER, "acme"));
    expect(b.pipelines).toHaveLength(1);
    expect(b.pipelines[0]?.stages.map((s) => s.label)).toEqual([
      "New",
      "Contacted",
      "Booked",
      "Quoted",
      "Won",
      "Lost",
    ]);
    expect(b.deals).toEqual([]);
    // A second look makes nothing more.
    expect((await api().board(as(OWNER, "acme"))).pipelines).toHaveLength(1);
  });

  it("adds a deal in the first stage and fires it", async () => {
    const m = await api().create({
      ...as(OWNER, "acme"),
      name: "Kitchen remodel",
      value: "$4,500.50",
      contactEmail: "Sam@Example.test",
    });
    expect(m.stage.key).toBe("new");
    expect(m.deal).toMatchObject({ client: "acme", valueCents: 450050, status: "open" });
    expect(m.deal.contactEmail).toBe("sam@example.test");
    const f = dealFired(m);
    expect(f).toMatchObject({
      client: "acme",
      facts: { trigger: "trigger.deal", change: "moved", stage: "new" },
      about: ["sam@example.test"],
      event: { subject: `deal:${m.deal.id}`, kind: "deal" },
    });
  });

  it("moves a deal, keeps each move, and a Deal trigger hears it by its settings", async () => {
    const [d] = (await api().board(as(OWNER, "acme"))).deals;
    if (!d) throw new Error("no deal");
    const [m] = await api().move({ ...as(OWNER, "acme"), ids: [d.id], stage: "quoted" });
    expect(m).toMatchObject({ from: "new", stage: { key: "quoted" } });
    // The same stage again moves nothing.
    expect(await api().move({ ...as(OWNER, "acme"), ids: [d.id], stage: "quoted" })).toEqual([]);
    const [won] = await api().close({ ...as(OWNER, "acme"), ids: [d.id] }, "won");
    if (!won) throw new Error("not moved");
    expect(won.deal).toMatchObject({ stage: "won", status: "won" });
    expect(won.deal.closedAt).not.toBeNull();
    expect((await movesOf(pg.db, d.id)).map((x) => [x.from, x.to])).toEqual([
      [null, "new"],
      ["new", "quoted"],
      ["quoted", "won"],
    ]);
    const facts = dealFired(won).facts;
    const node = (w: Record<string, string>) => ({ id: "t", uses: "trigger.deal", with: w });
    expect(logicOf("trigger.deal")?.group).toBe("trigger");
    expect(triggerHears(node({}), facts)).toBe(true);
    expect(triggerHears(node({ on: "won" }), facts)).toBe(true);
    expect(triggerHears(node({ on: "lost" }), facts)).toBe(false);
    expect(triggerHears(node({ on: "any", stage: "quoted" }), facts)).toBe(false);
    expect(triggerHears(node({ stage: "won" }), facts)).toBe(true);
  });

  it("lists by saved view, with the stage's label and what needs doing", async () => {
    await api().create({ ...as(OWNER, "acme"), name: "Water heater", owner: OWNER });
    await api().create({ ...as(OWNER, "acme"), name: "Leak", nextOn: "2026-01-02" });
    const list = (view: string) =>
      api()
        .recordsList({ ...as(OWNER, "acme"), record: "deals.deal", view } as never)
        .then((p) => (p as { rows: Record<string, unknown>[] }).rows.map((r) => r.name));
    expect((await list("open")).sort()).toEqual(["Leak", "Water heater"]);
    expect(await list("won")).toEqual(["Kitchen remodel"]);
    expect(await list("due")).toEqual(["Leak"]);
    const page = (await api().recordsList({
      ...as(OWNER, "acme"),
      record: "deals.deal",
      view: "won",
    } as never)) as { rows: Record<string, unknown>[] };
    expect(page.rows[0]).toMatchObject({
      stageLabel: "Won",
      value: { amount: 4500.5, currency: "USD" },
    });
  });

  it("calls a deal stale after two weeks in one stage", () => {
    const at = new Date("2026-10-09T12:00:00Z");
    const d = {
      id: "x",
      pipeline: "p",
      stage: "new",
      status: "open",
      nextOn: null,
      movedAt: new Date(at.getTime() - STALE_DAYS * 86_400_000),
      valueCents: null,
      currency: "usd",
    } as never;
    expect(rowOf(d, new Map(), at).flag).toBe("stale");
  });

  it("keeps stages that hold deals, and moves status with a stage's kind", async () => {
    const b = await api().board(as(OWNER, "acme"));
    const p = b.pipelines[0];
    if (!p) throw new Error("no pipeline");
    const noNew = p.stages.filter((s) => s.key !== "new");
    await expect(
      api().pipelineSave({ ...as(OWNER, "acme"), id: p.id, name: p.name, stages: noNew }),
    ).rejects.toThrow(/move the 2 deal\(s\) out of New first/);
    await expect(
      api().pipelineSave({
        ...as(OWNER, "acme"),
        id: p.id,
        name: p.name,
        stages: p.stages.filter((s) => s.kind !== "lost"),
      }),
    ).rejects.toThrow(/one won stage and one lost stage/);
    // Renamed and one added, keys kept: the deals stay where they are.
    const saved = await api().pipelineSave({
      ...as(OWNER, "acme"),
      id: p.id,
      name: "Jobs",
      stages: [
        ...p.stages.slice(0, 4).map((s) => (s.key === "new" ? { ...s, label: "Inbound" } : s)),
        { label: "Proposal sent" },
        ...p.stages.slice(4),
      ],
    });
    expect(saved.stages.map((s) => s.key)).toContain("proposal_sent");
    const again = await api().board(as(OWNER, "acme"));
    expect(again.pipelines[0]?.name).toBe("Jobs");
    expect(again.deals.filter((d) => d.stage === "new")).toHaveLength(2);
  });
});

describe("owners kept apart", () => {
  it("Wren's team sees Wren's own deals without naming a client", async () => {
    const m = await api().create({ ...as(ADA, undefined, true), name: "Acme retainer" });
    expect(m.deal.client).toBeNull();
    const wren = await api().board(as(ADA, undefined, true));
    expect(wren.deals.map((d) => d.name)).toEqual(["Acme retainer"]);
    expect((await api().board(as(OWNER, "acme"))).deals.map((d) => d.name)).not.toContain(
      "Acme retainer",
    );
    // The console's records read Wren's the same way.
    const rows = await dealRecordFor(null).rows?.(pg.db);
    expect(rows?.map((r) => r.name)).toEqual(["Acme retainer"]);
  });

  it("refuses another client's deal, and a viewer's change", async () => {
    const [d] = (await api().board(as(OWNER, "acme"))).deals;
    if (!d) throw new Error("no deal");
    await expect(
      api().move({ ...as(ADA, "beta", true), ids: [d.id], stage: "won" }),
    ).rejects.toThrow(/no such deal/);
    await expect(api().board(as(OWNER, "beta"))).rejects.toThrow();
    await expect(api().create({ ...as(VAL, "acme"), name: "Not allowed" })).rejects.toThrow(
      /can't do that/,
    );
    expect((await api().board(as(VAL, "acme"))).deals.length).toBeGreaterThan(0);
  });
});

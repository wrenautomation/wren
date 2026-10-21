/**
 * The shape console on a real Postgres, with the metro model (designs/briefs/2026-10-21-design-
 * language-d.md, D1): the diff, export, restore, blame, draft detail and numbers answer for a
 * graph version, a metro version and a metro draft. Synthetic data only.
 */
import { addOperator } from "@wren/core/clients";
import type { Viewer } from "@wren/core/portal";
import { resolveProfile } from "@wren/core/profiles";
import { profiles } from "@wren/core/profiles-schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pipelineConsoleApi } from "../../src/console.js";
import { metroOf } from "../../src/convert.js";
import { newDraft } from "../../src/drafts.js";
import { leadsOf, numberRows } from "../../src/numbers.js";
import { journeys, offerVersions, pipelineDeals } from "../../src/schema.js";
import { exportShape, parseShape } from "../../src/shape-file.js";
import { GRAPH_OVER_METRO, newestShape, saveShape, shapeVersionsOf } from "../../src/store.js";
import { metroView, runOf, type StoredBody } from "../../src/stored.js";
import { shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
const ADA = "ada@example.test";
const op = () => ({ viewer: { email: ADA, operator: true } as Viewer });
const api = () => pipelineConsoleApi({ db: pg.db, open: () => pg.db });

const save = (body: Parameters<typeof saveShape>[1]["body"], note: string) =>
  saveShape(pg.db, { body, note, by: "t", triggers: TRIGGERS });

const drawn = () => {
  const r = metroOf(shape());
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.body;
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await addOperator(pg.db, ADA);
});
afterAll(() => pg.stop());

describe("a graph newest", () => {
  it("diffs two graph versions with both sides drawn, and restores one with from", async () => {
    await save(shape(), "first");
    const renamed = shape({
      name: "Renamed shape",
      nodes: shape().nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n)),
    });
    await save(renamed, "second");
    const d = await api().shapeDiff({ ...op(), a: 1, b: 2 });
    expect(d.changes.map((c) => c.key).sort()).toEqual(["name", "node:booked:renamed"]);
    expect(d.views?.map((v) => v.name)).toEqual([shape().name, "Renamed shape"]);
    expect(d.marks).not.toBeNull();

    // A restore saves a copy of an older version, with no body sent.
    expect(await api().shapeVersion({ ...op(), note: "back", from: 1 })).toEqual({ version: 3 });
    expect((await newestShape(pg.db))?.body).toEqual(shape());
    await expect(api().shapeVersion({ ...op(), note: "x" })).rejects.toThrow(/exactly one/);
    await expect(
      api().shapeVersion({ ...op(), note: "x", from: 1, body: shape() }),
    ).rejects.toThrow(/exactly one/);
    await expect(api().shapeVersion({ ...op(), note: "x", from: 99 })).rejects.toThrow(
      /no shape version 99/,
    );
  });

  it("lists station and track rows that match the node and edge rows", async () => {
    const rows = await numberRows(pg.db);
    const nodes = rows.filter((r) => r.kind === "node");
    const stations = rows.filter((r) => r.kind === "station" && r.label !== "hub");
    expect(nodes.length).toBeGreaterThan(0);
    expect(stations.map((r) => r.label).sort()).toEqual(nodes.map((r) => r.label).sort());
    // An edge out of a source is a track out of the hub, so the hub's tracks stand for them.
    const edges = rows.filter((r) => r.kind === "edge" && !["yt", "mail"].includes(r.from ?? ""));
    const tracks = rows.filter((r) => r.kind === "track" && r.from !== "hub" && r.to !== "hub");
    expect(tracks.map((r) => r.label).sort()).toEqual(edges.map((r) => r.label).sort());
  });

  it("counts a lead on the hub row and skips a merged profile and one with a deal", async () => {
    const before = await leadsOf(pg.db);
    const mk = async (email: string) =>
      (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;
    const lead = await mk("lead@example.test");
    const dealt = await mk("dealt@example.test");
    await pg.db.insert(offerVersions).values({
      offer: "offer-a",
      number: 1,
      hash: "4".repeat(64),
      body: {} as never,
      why: "t",
      createdBy: "t",
    });
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: dealt, version: 1, node: "signed", entry: "yt" })
      .returning();
    await pg.db.insert(pipelineDeals).values({
      journey: j?.id as string,
      profileId: dealt,
      offer: "offer-a",
      offerVersion: 1,
    });
    expect(lead).not.toBe(dealt);
    expect(await leadsOf(pg.db)).toBe(before + 1);
    // A profile merged into another is not a lead.
    const gone = await mk("gone@example.test");
    await pg.db.update(profiles).set({ mergedInto: lead }).where(eq(profiles.id, gone));
    expect(await leadsOf(pg.db)).toBe(before + 1);
  });
});

describe("a metro newest", () => {
  const renamed = () =>
    shape({
      nodes: shape().nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n)),
    });
  const drawnRenamed = () => {
    const r = metroOf(renamed());
    if (!r.ok) throw new Error(r.errors.join(" "));
    return r.body;
  };

  it("answers a metro diff for a version against a metro draft, and the draft's metro", async () => {
    const draft = await newDraft(pg.db, { name: "Drawn", body: drawnRenamed(), by: ADA });
    const d = await api().shapeDiff({ ...op(), a: 3, b: `draft:${draft.id}` });
    expect(d.views).not.toBeNull();
    expect(d.changes.map((c) => c.key)).toEqual(["station:booked:renamed"]);
    const got = await api().recordsGet({
      ...op(),
      record: "pipeline.shape_draft",
      id: draft.id,
    });
    const detail = got.detail as { body: unknown; metro: { model: string } | null };
    expect(detail.metro?.model).toBe("metro");
    expect(detail.body).toEqual(runOf(drawnRenamed()));
  });

  it("exports a metro version by ref as the metro file", async () => {
    const v = await save(drawnRenamed(), "Move the shape to the metro model.");
    expect(v.number).toBe(4);
    const { text } = await api().shapeExport({ ...op(), ref: v.number });
    // The file reads back to the same body (the database may reorder keys).
    expect(parseShape(text).body).toEqual(drawnRenamed());
    expect(text).toMatch(/^model: metro/m);
    // The older graph version still exports as a graph.
    expect((await api().shapeExport({ ...op(), ref: 3 })).text).toBe(exportShape(shape()));
  });

  it("blames a station across the convert", async () => {
    const { lines } = await api().shapeBlame({ ...op(), station: "booked" });
    expect(lines.at(-1)).toMatchObject({ version: 1, how: "added" });
    expect(lines[0]).toMatchObject({ version: 4, how: "renamed" });
    await expect(api().shapeBlame({ ...op(), station: "booked", node: "booked" })).rejects.toThrow(
      /exactly one/,
    );
  });

  it("keys the diff of two graph versions as metro, and undo takes such a key", async () => {
    const d = await api().shapeDiff({ ...op(), a: 1, b: 2 });
    const keys = d.changes.map((c) => c.key);
    expect(keys).toContain("station:booked:renamed");
    expect(keys.some((k) => k.startsWith("node:"))).toBe(false);
    const undo = { ...op(), a: 1, b: 2, change: "station:booked:renamed" };
    const preview = await api().shapeUndoPreview(undo);
    expect(preview.changes.map((c) => c.key)).toEqual(["station:booked:renamed"]);
    expect(await api().shapeUndo(undo)).toEqual({ version: 5 });
    expect((await newestShape(pg.db))?.body).toEqual(drawn());
  });

  it("restores a graph version as its drawn form", async () => {
    expect(await api().shapeVersion({ ...op(), note: "back to 2", from: 2 })).toEqual({
      version: 6,
    });
    const second = (await shapeVersionsOf(pg.db))[1];
    expect((await newestShape(pg.db))?.body).toEqual(metroView(second?.body as StoredBody));
  });

  it("refuses a graph file on a metro newest in one sentence", async () => {
    const text = exportShape(shape());
    const refusal = { status: 400, message: GRAPH_OVER_METRO };
    await expect(api().shapePreview({ ...op(), text })).rejects.toMatchObject(refusal);
    await expect(api().shapeImport({ ...op(), text, note: "x" })).rejects.toMatchObject(refusal);
  });
});

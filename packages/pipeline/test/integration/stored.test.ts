/**
 * A shape on both models, on a real Postgres (designs/2026-10-20-design-language.md, area C1):
 * a graph version, the same shape as a metro version, then metro edits. Save, carry, diff, blame,
 * undo, the file, drafts, the records and the numbers read across the change of model. Synthetic
 * data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lowerable, metroOf } from "../../src/convert.js";
import { applyDraft, draftOf, newDraft } from "../../src/drafts.js";
import { editShape, ON_METRO } from "../../src/edit.js";
import { isMetro, type MetroBody, placesOf } from "../../src/metro.js";
import { numberRows } from "../../src/numbers.js";
import { shapeRecord, shapeRows } from "../../src/records.js";
import { journeys } from "../../src/schema.js";
import { exportShape, parseShape } from "../../src/shape-file.js";
import { newestShape, Refused, saveShape, shapeVersionsOf } from "../../src/store.js";
import {
  diffStored,
  historyOfStored,
  type StoredBody,
  storedChangeKey,
  storedChangeLines,
  storedChangesOf,
} from "../../src/stored.js";
import { planUndo, undoShape } from "../../src/undo.js";
import { metroShape, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const save = (body: StoredBody, note: string) =>
  saveShape(pg.db, { body, note, by: "t", triggers: TRIGGERS });

const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

const drawn = (): MetroBody => {
  const r = metroOf(shape());
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.body;
};

const relabel = (m: MetroBody, id: string, label: string): MetroBody => ({
  ...m,
  stations: m.stations.map((s) => (s.id === id ? { ...s, label } : s)),
});

async function journeyAt(email: string, version: number, node: string): Promise<string> {
  const p = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test");
  const [j] = await pg.db
    .insert(journeys)
    .values({ profileId: p?.id as number, version, node, entry: "yt" })
    .returning();
  return j?.id as string;
}

describe("a graph version, then the metro model", () => {
  let journey = "";

  it("saves a graph, then its metro form, and carries an open journey across", async () => {
    const v1 = await save(shape(), "graph");
    expect(isMetro(v1.body)).toBe(false);
    journey = await journeyAt("ada@example.test", 1, "booked");

    const v2 = await save(drawn(), "Move the shape to the metro model.");
    expect(v2).toMatchObject({ number: 2, parent: 1 });
    expect(isMetro(v2.body)).toBe(true);
    expect(v2.depths).toEqual(placesOf(drawn()));

    const [after] = await pg.db.select().from(journeys).where(eq(journeys.id, journey));
    expect(after).toMatchObject({ version: 2, node: "booked", status: "open" });
  });

  it("says nothing changed for the same metro body again", async () => {
    expect(await reasons(save(drawn(), "again"))).toEqual(["Nothing changed."]);
    expect((await shapeVersionsOf(pg.db)).map((v) => v.number)).toEqual([1, 2]);
  });

  it("refuses a metro body with every reason in one list", async () => {
    const bad: MetroBody = { ...metroShape(), name: "" };
    const why = await reasons(save(bad, "x"));
    expect(why).toContain("The shape needs a name.");
    for (const reason of lowerable(bad)) expect(why).toContain(reason);
    expect((await shapeVersionsOf(pg.db)).map((v) => v.number)).toEqual([1, 2]);
  });

  it("refuses a graph edit while the newest version is metro", async () => {
    const why = await reasons(
      editShape(pg.db, { change: (b) => b, note: "x", by: "t", triggers: TRIGGERS }),
    );
    expect(why).toEqual([ON_METRO]);
  });

  it("diffs the convert as no change on the map", async () => {
    const [v1, v2] = await shapeVersionsOf(pg.db);
    if (!v1 || !v2) throw new Error("two versions expected");
    const d = diffStored(v1.body, v2.body);
    expect(d.model).toBe("metro");
    expect(storedChangesOf(d)).toEqual([]);
  });

  it("saves a metro edit, then diffs, blames and undoes it by station", async () => {
    const v3 = await save(relabel(drawn(), "booked", "Call booked"), "rename a station");
    expect(v3.number).toBe(3);

    const all = await shapeVersionsOf(pg.db);
    const [v1, v2] = all;
    if (!v1 || !v2) throw new Error("versions expected");
    const d = diffStored(v2.body, v3.body);
    expect(storedChangesOf(d).map(storedChangeKey)).toEqual(["station:booked:renamed"]);
    expect(storedChangeLines(v2.body, v3.body, d)).toEqual([
      "Renamed station Booked to Call booked.",
    ]);

    // A station keeps its history across the convert: its id is the node id.
    expect(historyOfStored(all, "booked", "station").map((l) => [l.version, l.how])).toEqual([
      [3, "renamed"],
      [1, "added"],
    ]);
    expect(historyOfStored(all, "booked", "node").map((l) => [l.version, l.how])).toEqual([
      [3, "renamed"],
      [1, "added"],
    ]);

    const plan = await planUndo(pg.db, {
      a: 2,
      b: 3,
      change: "station:booked:renamed",
      triggers: TRIGGERS,
    });
    expect(plan.line).toBe("Renamed station Booked to Call booked.");
    expect(plan.diff.model).toBe("metro");
    expect(isMetro(plan.result)).toBe(true);

    const v4 = await undoShape(pg.db, {
      a: 2,
      b: 3,
      change: "station:booked:renamed",
      by: "t",
      triggers: TRIGGERS,
    });
    expect(v4.number).toBe(4);
    expect(v4.note).toBe("Undo: Renamed station Booked to Call booked.");
    expect(v4.body).toEqual(v2.body);
  });

  it("refuses a graph key once the newest version is metro", async () => {
    const why = await reasons(
      undoShape(pg.db, { a: 1, b: 2, change: "node:booked:renamed", by: "t", triggers: TRIGGERS }),
    );
    expect(why).toEqual(["The shape is on the metro model now. Undo by station or track."]);
  });

  it("undoes a graph key while the newest version is a graph", async () => {
    // A fresh history in the same database: version 5 is a graph, version 6 renames a node.
    const g = shape();
    g.nodes = g.nodes.map((n) => (n.id === "yt" ? { ...n, name: "Video" } : n));
    const v5 = await save(g, "back to a graph");
    expect(isMetro(v5.body)).toBe(false);
    const g2 = shape();
    g2.nodes = g2.nodes.map((n) => (n.id === "yt" ? { ...n, name: "Video" } : n));
    g2.nodes = g2.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n));
    const v6 = await save(g2, "rename a node");
    const undone = await undoShape(pg.db, {
      a: v5.number,
      b: v6.number,
      change: "node:booked:renamed",
      by: "t",
      triggers: TRIGGERS,
    });
    expect(isMetro(undone.body)).toBe(false);
    expect(undone.body).toEqual(v5.body);
  });
});

describe("the file", () => {
  it("writes a metro version with model: metro and reads it back", async () => {
    const newest = await newestShape(pg.db);
    if (!newest) throw new Error("no shape");
    const m = drawn();
    const text = exportShape(m);
    expect(text.startsWith("model: metro")).toBe(true);
    expect(parseShape(text).body).toEqual(m);
    expect(exportShape(shape())).not.toContain("model:");
    expect(parseShape(exportShape(shape())).body).toEqual(shape());
  });
});

describe("drafts and the records", () => {
  it("keeps a metro draft and applies it as the next version", async () => {
    const before = (await newestShape(pg.db))?.number ?? 0;
    // Land on a metro version first, so the draft forks a metro body.
    const base = await save(drawn(), "metro again");
    const draft = await newDraft(pg.db, {
      name: "Metro draft",
      body: relabel(drawn(), "engaged", "Replied"),
      by: "t",
    });
    expect(draft.base).toBe(base.number);
    const held = await draftOf(pg.db, draft.id);
    expect(isMetro(held?.body)).toBe(true);

    const applied = await applyDraft(pg.db, { id: draft.id, by: "t", triggers: TRIGGERS });
    expect(applied.version.number).toBe(base.number + 1);
    expect(isMetro(applied.version.body)).toBe(true);
    expect(applied.version.number).toBeGreaterThan(before);
  });

  it("answers the shape record in graph terms, with the metro view beside it", async () => {
    const top = await newestShape(pg.db);
    expect(isMetro(top?.body)).toBe(true);
    const [row] = await shapeRows(pg.db);
    expect(row).toMatchObject({ id: "shape", nodes: shape().nodes.length });

    const detail = (await shapeRecord().load?.(pg.db, "shape")) as {
      body: { nodes: unknown[]; edges: unknown[]; model?: string };
      depths: Record<string, number>;
      metro: MetroBody | null;
      places: Record<string, number> | null;
    } | null;
    expect(detail?.body.model).toBeUndefined();
    expect(detail?.body.nodes).toHaveLength(shape().nodes.length);
    expect(detail?.depths).toMatchObject({ yt: 0, engaged: 1 });
    expect(detail?.metro?.model).toBe("metro");
    expect(detail?.places).toEqual(placesOf(detail?.metro as MetroBody));
  });

  it("answers the numbers per line, station and track for a metro newest", async () => {
    const rows = await numberRows(pg.db);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has("line")).toBe(true);
    expect(kinds.has("station")).toBe(true);
    expect(kinds.has("track")).toBe(true);
    expect(kinds.has("node")).toBe(false);
    expect(kinds.has("edge")).toBe(false);
    const station = rows.find((r) => r.id === "station:booked");
    expect(station).toMatchObject({ name: "Booked", now: 1 });
    expect(rows.find((r) => r.id === "track:engaged_to_booked")).toMatchObject({ crossings: 0 });
    expect(rows.find((r) => r.id === "line:yt")).toMatchObject({ kind: "line", name: "YouTube" });
  });
});

/**
 * The version store on a real Postgres (designs/2026-10-19-business-map.md): offers sync by hash,
 * terms go live by date, the shape saves under the rules and carries journeys. Synthetic data only.
 */

import { resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { OFFERS, type Offer, type Terms } from "@wren/offers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MetroBody } from "../../src/metro.js";
import { depthOf } from "../../src/model.js";
import { journeys } from "../../src/schema.js";
import {
  addTerms,
  liveTerms,
  newestShape,
  offerVersionsOf,
  Refused,
  saveShape,
  shapeVersionsOf,
  syncOffers,
} from "../../src/store.js";
import { asMetro, flow, grown, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const offer = (id: string, promise = "Something."): Offer => ({
  id,
  name: "Test",
  status: "live",
  audience: "Someone.",
  promise,
  price: { kind: "quoted" },
  slots: null,
  days: null,
  youGet: ["A thing."],
  youGive: [],
  weGet: [],
  guarantee: null,
  measures: [],
  next: [],
  page: null,
  booking: null,
  application: null,
});

const terms = (setupCents: number): Terms => ({
  currency: "USD",
  setupCents,
  monthlyCents: null,
  perUnitCents: null,
  unit: null,
  capCents: null,
  days: null,
  payDays: 7,
});

const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

describe("syncOffers", () => {
  it("adds once, repeats nothing, and numbers a changed hash", async () => {
    const first = await syncOffers(pg.db, [offer("sync-a"), offer("sync-b")], "t");
    expect(first.added).toEqual([
      { offer: "sync-a", number: 1 },
      { offer: "sync-b", number: 1 },
    ]);

    const again = await syncOffers(pg.db, [offer("sync-a"), offer("sync-b")], "t");
    expect(again).toEqual({ added: [], unchanged: 2 });

    const changed = await syncOffers(
      pg.db,
      [offer("sync-a", "Something else."), offer("sync-b")],
      "t",
    );
    expect(changed.added).toEqual([{ offer: "sync-a", number: 2 }]);
    expect(changed.unchanged).toBe(1);

    const rows = await offerVersionsOf(pg.db, "sync-a");
    expect(rows.map((r) => r.number)).toEqual([1, 2]);
    expect(rows[1]?.body.promise).toBe("Something else.");
    expect(rows[0]?.hash).not.toBe(rows[1]?.hash);
  });

  it("numbers a change back to an older shape as the next version", async () => {
    await syncOffers(pg.db, [offer("sync-c")], "t");
    await syncOffers(pg.db, [offer("sync-c", "Other.")], "t");
    const back = await syncOffers(pg.db, [offer("sync-c")], "t");
    expect(back).toEqual({ added: [{ offer: "sync-c", number: 3 }], unchanged: 0 });
    const rows = await offerVersionsOf(pg.db, "sync-c");
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows[2]?.hash).toBe(rows[0]?.hash);
    expect((await syncOffers(pg.db, [offer("sync-c")], "t")).unchanged).toBe(1);
  });

  it("writes a draft offer's version, so a deal can be made on it", async () => {
    const draft: Offer = { ...offer("sync-draft"), status: "draft" };
    expect((await syncOffers(pg.db, [draft], "t")).added).toEqual([
      { offer: "sync-draft", number: 1 },
    ]);
    expect((await offerVersionsOf(pg.db, "sync-draft"))[0]?.body.status).toBe("draft");
  });

  it("writes the registry's Growth Partner draft", async () => {
    const r = await syncOffers(pg.db, OFFERS, "t");
    expect(r.added).toContainEqual({ offer: "growth-partner", number: 1 });
    const [v] = await offerVersionsOf(pg.db, "growth-partner");
    expect(v?.body).toMatchObject({ name: "Growth Partner", status: "draft" });
  });
});

describe("terms", () => {
  it("goes live by date, the highest number whose date has come", async () => {
    await addTerms(pg.db, {
      offer: "offer-a",
      plan: "standard",
      from: "2027-01-01",
      body: terms(100),
      why: "first",
      by: "t",
    });
    const second = await addTerms(pg.db, {
      offer: "offer-a",
      plan: "standard",
      from: "2027-06-01",
      body: terms(200),
      why: "second",
      by: "t",
    });
    expect(second.number).toBe(2);

    expect(await liveTerms(pg.db, "offer-a", "standard", "2026-12-31")).toBeNull();
    expect((await liveTerms(pg.db, "offer-a", "standard", "2027-03-01"))?.body.setupCents).toBe(
      100,
    );
    expect((await liveTerms(pg.db, "offer-a", "standard", "2027-06-01"))?.body.setupCents).toBe(
      200,
    );
    expect(await liveTerms(pg.db, "offer-a", "flat", "2027-06-01")).toBeNull();
    expect(await liveTerms(pg.db, "offer-b", "standard", "2027-06-01")).toBeNull();
  });

  it("refuses an earlier date and a bad body", async () => {
    const early = await reasons(
      addTerms(pg.db, {
        offer: "offer-a",
        plan: "standard",
        from: "2027-02-01",
        body: terms(300),
        why: "x",
        by: "t",
      }),
    );
    expect(early[0]).toMatch(/cannot start earlier/);
    const bad = await reasons(
      addTerms(pg.db, {
        offer: "offer-a",
        plan: "Bad Plan",
        from: "2027-09-01",
        body: { ...terms(1.5), currency: "usd" },
        why: "x",
        by: "t",
      }),
    );
    expect(bad.length).toBe(3);
  });

  it("numbers two concurrent adds apart", async () => {
    const add = (from: string) =>
      addTerms(pg.db, {
        offer: "offer-c",
        plan: "partner-1",
        from,
        body: terms(100),
        why: "x",
        by: "t",
      });
    const rows = await Promise.all([add("2027-01-01"), add("2027-01-01")]);
    expect(rows.map((r) => r.number).sort()).toEqual([1, 2]);
  });
});

describe("shape", () => {
  const saveMetro = (body: MetroBody, note = "first", moves?: Record<string, string>) =>
    saveShape(pg.db, {
      body,
      note,
      by: "t",
      triggers: TRIGGERS,
      ...(moves ? { moves } : {}),
    });
  const save = (body = shape(), note = "first", moves?: Record<string, string>) =>
    saveMetro(asMetro(body), note, moves);

  it("saves the first version with its depths, and says nothing changed on a repeat", async () => {
    expect(await newestShape(pg.db)).toBeNull();
    const v1 = await save();
    expect(v1).toMatchObject({ number: 1, parent: null, note: "first", createdBy: "t" });
    expect(v1.depths).toEqual(depthOf(shape()));
    expect(v1.depths).toMatchObject({ yt: 0, mail: 0, engaged: 1, booked: 2, signed: 4 });
    expect(await reasons(save(shape(), "again"))).toEqual(["Nothing changed."]);
    expect((await shapeVersionsOf(pg.db)).map((r) => r.number)).toEqual([1]);
  });

  it("refuses a body that breaks the rules, and a note that is empty", async () => {
    // A graph that breaks a rule cannot be drawn as metro, so the broken body is a metro one.
    const broken = { ...asMetro(shape()), name: "" };
    const why = (await reasons(saveMetro(broken, "x"))).join(" ");
    expect(why).toMatch(/needs a name/);
    expect(await reasons(save(grown([], []), "  "))).toEqual(["Say why."]);
    expect((await shapeVersionsOf(pg.db)).map((r) => r.number)).toEqual([1]);
  });

  it("refuses an unknown trigger, a moves target that is no node, and a loop of flow edges", async () => {
    const nope = shape();
    nope.nodes = nope.nodes.map((n) =>
      n.id === "engaged" && n.kind === "step"
        ? { ...n, advance: [{ trigger: "trigger.nope" }] }
        : n,
    );
    expect((await reasons(save(nope, "x"))).join(" ")).toMatch(/not a known trigger/);

    const next = grown(
      [{ id: "kept", kind: "step", name: "Kept", action: "other", advance: [] }],
      [flow("standard", "kept")],
    );
    expect(await reasons(save(next, "x", { booked: "missing" }))).toEqual([
      "Cannot move booked to missing: the shape has no node missing.",
    ]);

    const cycle = grown([], [flow("signed", "booked")]);
    expect((await reasons(save(cycle, "x"))).join(" ")).toMatch(/Tracks form a loop/);
    expect((await shapeVersionsOf(pg.db)).map((r) => r.number)).toEqual([1]);
  });

  it("refuses a group or a list that does not exist", async () => {
    const body = grown(
      [
        { id: "warm", kind: "source", name: "Warm", via: "group", group: "999999" },
        { id: "lst", kind: "source", name: "List", via: "sourced", source: "import:999999" },
      ],
      [flow("warm", "engaged"), flow("lst", "engaged")],
    );
    const why = (await reasons(save(body, "x"))).join(" ");
    expect(why).toMatch(/group 999999, which does not exist/);
    expect(why).toMatch(/names source import:999999, which does not exist/);
  });

  it("carries an open journey to the next version with a version arrival", async () => {
    const profile = await person("ada@example.test");
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: profile, version: 1, node: "booked", entry: "yt" })
      .returning();
    expect(j?.node).toBe("booked");

    const next = grown(
      [{ id: "kept", kind: "step", name: "Kept", action: "other", advance: [] }],
      [flow("standard", "kept")],
    );
    const v2 = await save(next, "add a step");
    expect(v2).toMatchObject({ number: 2, parent: 1 });

    const [after] = await pg.db
      .select()
      .from(journeys)
      .where(eq(journeys.id, j?.id as string));
    expect(after).toMatchObject({ version: 2, node: "booked", status: "open" });
    const arrivals = await pg.db
      .select()
      .from(events)
      .where(eq(events.subject, `journey:${j?.id}`));
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ workflow: "shape.v2", node: "s_booked", by: "carry" });
    expect(arrivals[0]?.data).toMatchObject({ cause: { kind: "version", ref: "1" } });
  });

  it("leaves a journey on a removed node as a ghost, and moves it when moves names a node", async () => {
    const profile = await person("bo@example.test");
    const ghost = (
      await pg.db
        .insert(journeys)
        .values({ profileId: profile, version: 2, node: "kept", entry: "yt" })
        .returning()
    )[0];
    const moved = (
      await pg.db
        .insert(journeys)
        .values({
          profileId: await person("cy@example.test"),
          version: 2,
          node: "kept",
          entry: "yt",
        })
        .returning()
    )[0];
    if (!ghost || !moved) throw new Error("no journeys");

    // v3 has no "kept": both stay on v2 unless moves names a node.
    const v3 = await save(shape(), "drop kept", {});
    expect(v3.number).toBe(3);
    expect((await journeyRow(ghost.id))?.version).toBe(2);
    expect((await journeyRow(moved.id))?.version).toBe(2);

    // v4 changes a name; moves sends "kept" to "proposal". Both journeys on v2 move.
    const body = shape();
    body.nodes = body.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n));
    await save(body, "rename", { kept: "proposal" });
    for (const id of [ghost.id, moved.id]) {
      expect(await journeyRow(id)).toMatchObject({ version: 4, node: "proposal" });
    }
    const trail = (await journeyRow(moved.id))?.trail;
    expect(trail?.at(-1)).toMatchObject({ edge: null, from: "kept", to: "proposal" });
  });

  it("numbers two concurrent saves apart", async () => {
    const a = shape();
    a.nodes = a.nodes.map((n) => (n.id === "engaged" ? { ...n, name: "Race A" } : n));
    const b = shape();
    b.nodes = b.nodes.map((n) => (n.id === "engaged" ? { ...n, name: "Race B" } : n));
    const rows = await Promise.all([save(a, "a"), save(b, "b")]);
    const numbers = rows.map((r) => r.number).sort();
    const first = (await newestShape(pg.db))?.number as number;
    expect(numbers).toEqual([first - 1, first]);
    const all = await shapeVersionsOf(pg.db);
    expect(all.map((r) => r.number)).toEqual(all.map((_, i) => i + 1));
    expect(all.at(-1)?.parent).toBe(first - 1);
  });
});

async function person(email: string): Promise<number> {
  const p = await resolveProfile(pg.db, [{ kind: "email", value: email }], "test");
  return p?.id as number;
}

async function journeyRow(id: string) {
  return (await pg.db.select().from(journeys).where(eq(journeys.id, id)))[0];
}

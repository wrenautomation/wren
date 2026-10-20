/**
 * Drafts and tags on a real Postgres (designs/2026-10-19-business-map.md, "History like git"):
 * a draft is saved beside the live shape, proposed, then applied as the next version or dropped.
 * Synthetic data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyDraft,
  bodyOfRef,
  draftOf,
  draftsOf,
  dropDraft,
  newDraft,
  parseRef,
  proposeDraft,
  updateDraft,
} from "../../src/drafts.js";
import type { ShapeBody } from "../../src/model.js";
import { journeys, shapeDrafts } from "../../src/schema.js";
import { newestShape, Refused, saveShape, shapeVersionsOf } from "../../src/store.js";
import { addTag, tagsOf } from "../../src/tags.js";
import { flow, grown, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const BY = "ada@example.test";
const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );
const extra = grown(
  [{ id: "kept", kind: "step", name: "Kept", action: "other", advance: [] }],
  [flow("standard", "kept")],
);
/** `shape()` without the "booked" step: engaged leads straight to proposal. */
const withoutBooked = (): ShapeBody => {
  const base = shape();
  return {
    ...base,
    nodes: base.nodes.filter((n) => n.id !== "booked"),
    edges: [
      ...base.edges.filter((e) => e.from !== "booked" && e.to !== "booked"),
      flow("engaged", "proposal"),
    ],
  };
};
const person = async (email: string) =>
  (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;
const journeyRow = async (id: string) =>
  (await pg.db.select().from(journeys).where(eq(journeys.id, id)))[0];

describe("drafts", () => {
  it("refuses a draft before the workspace has a shape, and a name with nothing in it", async () => {
    expect(await reasons(newDraft(pg.db, { name: "First", body: shape(), by: BY }))).toEqual([
      "Start or import a shape first.",
    ]);
    await saveShape(pg.db, { body: shape(), note: "first", by: BY, triggers: TRIGGERS });
    expect(await reasons(newDraft(pg.db, { name: "  ", body: shape(), by: BY }))).toEqual([
      "The draft needs a name.",
    ]);
  });

  it("saves a draft from the newest version, whatever its body, and refuses a taken id in any state", async () => {
    const half = { name: "Half done", nodes: [], edges: [] } as ShapeBody;
    const d = await newDraft(pg.db, { name: "Add a Step", body: half, by: BY, note: "try it" });
    expect(d).toMatchObject({
      id: "add-a-step",
      name: "Add a Step",
      state: "draft",
      base: 1,
      note: "try it",
      createdBy: BY,
      moves: {},
      appliedVersion: null,
    });
    expect(await reasons(newDraft(pg.db, { name: "add a step", body: shape(), by: BY }))).toEqual([
      'A draft "add-a-step" exists. Pick another name.',
    ]);
    expect(
      await reasons(newDraft(pg.db, { name: "Fork", body: shape(), base: 9, by: BY })),
    ).toEqual(["There is no shape version 9."]);
    // A dropped draft still holds its id.
    await dropDraft(pg.db, { id: "add-a-step", reason: "wrong idea", by: BY });
    expect(await reasons(newDraft(pg.db, { name: "Add a step", body: shape(), by: BY }))).toEqual([
      'A draft "add-a-step" exists. Pick another name.',
    ]);
  });

  it("updates the body and moves, keeps the note unless one is given, and keeps the state", async () => {
    await newDraft(pg.db, { name: "Edit me", body: shape(), by: BY, note: "why" });
    const a = await updateDraft(pg.db, {
      id: "edit-me",
      body: extra,
      moves: { x: "kept" },
      by: BY,
    });
    expect(a).toMatchObject({ state: "draft", note: "why", moves: { x: "kept" } });
    expect(a.body.nodes.map((n) => n.id)).toContain("kept");
    const b = await updateDraft(pg.db, { id: "edit-me", body: extra, note: "better why", by: BY });
    expect(b).toMatchObject({ note: "better why", moves: {} });
    expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
    expect(await reasons(updateDraft(pg.db, { id: "none", body: extra, by: BY }))).toEqual([
      'There is no draft "none".',
    ]);
  });

  it("proposes a draft once, and a proposed draft can still change", async () => {
    await newDraft(pg.db, { name: "Propose me", body: extra, by: BY });
    expect((await proposeDraft(pg.db, { id: "propose-me", by: BY })).state).toBe("proposed");
    expect(await reasons(proposeDraft(pg.db, { id: "propose-me", by: BY }))).toEqual([
      'The draft "propose-me" is proposed. Only a draft can be proposed.',
    ]);
    const u = await updateDraft(pg.db, { id: "propose-me", body: shape(), by: BY });
    expect(u.state).toBe("proposed");
  });

  it("applies a draft as the next version with the draft set, and carries open journeys", async () => {
    const newest = (await newestShape(pg.db))?.number as number;
    const on = await person("bo@example.test");
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: on, version: newest, node: "engaged", entry: "yt" })
      .returning();
    if (!j) throw new Error("no journey");
    await newDraft(pg.db, { name: "Ship kept", body: extra, by: BY });
    const done = await applyDraft(pg.db, {
      id: "ship-kept",
      by: "val@example.test",
      triggers: TRIGGERS,
    });
    expect(done.version).toMatchObject({
      number: newest + 1,
      parent: newest,
      draft: "ship-kept",
      note: "Draft Ship kept",
      createdBy: "val@example.test",
    });
    expect(done.draft).toMatchObject({
      state: "applied",
      appliedVersion: newest + 1,
      decidedBy: "val@example.test",
    });
    expect(done.draft.decidedAt).toBeInstanceOf(Date);
    expect(await journeyRow(j.id)).toMatchObject({
      version: newest + 1,
      node: "engaged",
      status: "open",
    });
    // Applied is final.
    expect(
      await reasons(applyDraft(pg.db, { id: "ship-kept", by: BY, triggers: TRIGGERS })),
    ).toEqual(['The draft "ship-kept" is applied. Only an open draft changes.']);
    expect(await reasons(updateDraft(pg.db, { id: "ship-kept", body: shape(), by: BY }))).toEqual([
      'The draft "ship-kept" is applied. Only an open draft changes.',
    ]);
  });

  it("moves a journey on a dropped node by the draft's moves", async () => {
    const newest = (await newestShape(pg.db))?.number as number;
    const [j] = await pg.db
      .insert(journeys)
      .values({
        profileId: await person("cy@example.test"),
        version: newest,
        node: "booked",
        entry: "yt",
      })
      .returning();
    if (!j) throw new Error("no journey");
    await newDraft(pg.db, {
      name: "Drop booked",
      body: withoutBooked(),
      moves: { booked: "proposal" },
      note: "skip the call",
      by: BY,
    });
    const done = await applyDraft(pg.db, { id: "drop-booked", by: BY, triggers: TRIGGERS });
    expect(done.version.note).toBe("skip the call");
    expect(await journeyRow(j.id)).toMatchObject({
      version: done.version.number,
      node: "proposal",
    });
  });

  it("leaves the draft proposed when the checks refuse it, and when nothing changed", async () => {
    const before = (await shapeVersionsOf(pg.db)).length;
    const broken = shape({ edges: [flow("yt", "engaged"), flow("engaged", "yt")] });
    await newDraft(pg.db, { name: "Broken", body: broken, by: BY });
    await proposeDraft(pg.db, { id: "broken", by: BY });
    const why = (
      await reasons(applyDraft(pg.db, { id: "broken", by: BY, triggers: TRIGGERS }))
    ).join(" ");
    expect(why).toMatch(/Nothing enters a source/);
    expect((await draftOf(pg.db, "broken"))?.state).toBe("proposed");
    expect(await shapeVersionsOf(pg.db)).toHaveLength(before);

    const newest = await newestShape(pg.db);
    await newDraft(pg.db, { name: "Same", body: newest?.body as ShapeBody, by: BY });
    expect(await reasons(applyDraft(pg.db, { id: "same", by: BY, triggers: TRIGGERS }))).toEqual([
      "Nothing changed.",
    ]);
    expect((await draftOf(pg.db, "same"))?.state).toBe("draft");
    expect(await shapeVersionsOf(pg.db)).toHaveLength(before);
  });

  it("drops a draft only with a reason, and a dropped draft cannot be applied", async () => {
    await newDraft(pg.db, { name: "Drop me", body: extra, by: BY });
    expect(await reasons(dropDraft(pg.db, { id: "drop-me", reason: "  ", by: BY }))).toEqual([
      "Say why.",
    ]);
    expect((await draftOf(pg.db, "drop-me"))?.state).toBe("draft");
    const d = await dropDraft(pg.db, { id: "drop-me", reason: "not now", by: "val@example.test" });
    expect(d).toMatchObject({
      state: "dropped",
      dropReason: "not now",
      decidedBy: "val@example.test",
    });
    expect(await reasons(applyDraft(pg.db, { id: "drop-me", by: BY, triggers: TRIGGERS }))).toEqual(
      ['The draft "drop-me" is dropped. Only an open draft changes.'],
    );
  });

  it("lists drafts newest change first, narrowed by state", async () => {
    const open = await draftsOf(pg.db, { states: ["draft", "proposed"] });
    expect(open.every((d) => d.state === "draft" || d.state === "proposed")).toBe(true);
    expect(open.map((d) => d.id)).toEqual(expect.arrayContaining(["broken", "propose-me"]));
    const all = await draftsOf(pg.db);
    expect(all.length).toBeGreaterThan(open.length);
    const times = all.map((d) => d.updatedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("reads a version or a draft by ref", async () => {
    expect(parseRef(1)).toBe(1);
    expect(parseRef("2")).toBe(2);
    expect(parseRef("draft:propose-me")).toBe("draft:propose-me");
    expect(() => parseRef("nope")).toThrow(Refused);
    expect(() => parseRef(0)).toThrow(Refused);
    expect((await bodyOfRef(pg.db, 1)).name).toBe("Test shape");
    expect((await bodyOfRef(pg.db, "draft:propose-me")).nodes.length).toBeGreaterThan(0);
    expect(await reasons(bodyOfRef(pg.db, "draft:none"))).toEqual(['There is no draft "none".']);
    expect(await reasons(bodyOfRef(pg.db, 99))).toEqual(["There is no shape version 99."]);
  });

  it("numbers two concurrent applies apart: one lands, the other waits and still applies", async () => {
    await newDraft(pg.db, { name: "Race one", body: shape({ name: "Race one" }), by: BY });
    await newDraft(pg.db, { name: "Race two", body: shape({ name: "Race two" }), by: BY });
    const rows = await Promise.all([
      applyDraft(pg.db, { id: "race-one", by: BY, triggers: TRIGGERS }),
      applyDraft(pg.db, { id: "race-two", by: BY, triggers: TRIGGERS }),
    ]);
    const numbers = rows.map((r) => r.version.number).sort((a, b) => a - b);
    expect(numbers[1]).toBe((numbers[0] as number) + 1);
  });

  it("keeps the base a real version: the database refuses a base that is none", async () => {
    await expect(
      pg.db.insert(shapeDrafts).values({
        id: "ghost-base",
        name: "Ghost",
        body: shape(),
        base: 9999,
        createdBy: BY,
      }),
    ).rejects.toThrow();
  });
});

describe("tags", () => {
  it("puts a trimmed name on a version, and lists tags by version", async () => {
    const t = await addTag(pg.db, { name: "  launch  ", version: 2, note: "  shipped ", by: BY });
    expect(t).toMatchObject({ name: "launch", version: 2, note: "shipped", createdBy: BY });
    await addTag(pg.db, { name: "alpha", version: 1, by: BY });
    expect((await tagsOf(pg.db)).map((x) => [x.version, x.name])).toEqual([
      [1, "alpha"],
      [2, "launch"],
    ]);
    expect((await tagsOf(pg.db))[0]?.note).toBeNull();
  });

  it("refuses a taken name, a missing version, an empty name and a long one", async () => {
    expect(await reasons(addTag(pg.db, { name: "launch", version: 3, by: BY }))).toEqual([
      'The tag "launch" is on version 2.',
    ]);
    expect(await reasons(addTag(pg.db, { name: "late", version: 999, by: BY }))).toEqual([
      "There is no shape version 999.",
    ]);
    expect(await reasons(addTag(pg.db, { name: "  ", version: 1, by: BY }))).toEqual([
      "The tag needs a name.",
    ]);
    expect(await reasons(addTag(pg.db, { name: "x".repeat(61), version: 1, by: BY }))).toEqual([
      "A tag name is 60 characters or fewer.",
    ]);
    expect(await addTag(pg.db, { name: "x".repeat(60), version: 1, by: BY })).toMatchObject({
      version: 1,
    });
  });

  it("never edits or removes a tag: the database refuses", async () => {
    await expect(
      pg.db.execute(sql`update pipeline.shape_tags set version = 1 where name = 'launch'`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/never edited or deleted/) },
    });
    await expect(
      pg.db.execute(sql`delete from pipeline.shape_tags where name = 'launch'`),
    ).rejects.toThrow();
    expect((await tagsOf(pg.db)).find((t) => t.name === "launch")?.version).toBe(2);
  });
});

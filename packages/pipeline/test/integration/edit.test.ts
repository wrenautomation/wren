/**
 * Small shape edits on a real Postgres (designs/2026-10-19-business-map.md): the CLI's add-node,
 * connect and remove read the newest body, change it and save the next version. Synthetic data
 * only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edgeOf, editShape, openOn, withEdge, withNode, withoutNode } from "../../src/edit.js";
import type { ShapeNode } from "../../src/model.js";
import { journeys } from "../../src/schema.js";
import { newestShape, Refused, saveShape } from "../../src/store.js";
import { shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const won: ShapeNode = { id: "won", kind: "step", name: "Won", action: "other", advance: [] };
const person = async (email: string) =>
  (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;
const edit = (change: Parameters<typeof editShape>[1]["change"], moves?: Record<string, string>) =>
  editShape(pg.db, {
    change,
    note: "t",
    by: "t",
    triggers: TRIGGERS,
    ...(moves ? { moves } : {}),
  });

describe("editShape", () => {
  it("refuses while no shape exists", async () => {
    await expect(edit((b) => b)).rejects.toThrow(/no shape yet/);
  });

  it("adds a node and an edge as one version, and checks the result", async () => {
    await saveShape(pg.db, { body: shape(), note: "v1", by: "t", triggers: TRIGGERS });
    // A step with no edge into it is refused by the shape's own rules.
    await expect(edit((b) => withNode(b, won))).rejects.toThrow(Refused);
    const v2 = await edit((b) => withNode(b, won, [edgeOf("standard", "won")]));
    expect(v2.number).toBe(2);
    expect((await newestShape(pg.db))?.body.nodes.map((n) => n.id)).toContain("won");
  });

  it("counts the open journeys on a node", async () => {
    const [a, b] = [await person("a@example.test"), await person("b@example.test")];
    await pg.db.insert(journeys).values([
      { profileId: a, version: 2, node: "won", entry: "yt" },
      { profileId: b, version: 2, node: "booked", entry: "yt" },
    ]);
    expect(await openOn(pg.db, "won")).toBe(1);
    expect(await openOn(pg.db, "yt")).toBe(0);
  });

  it("removes a node and moves its journeys where --move-to says", async () => {
    const v3 = await edit((b) => withoutNode(b, "won"), { won: "standard" });
    expect(v3.number).toBe(3);
    const [j] = await pg.db.select().from(journeys).where(eq(journeys.node, "standard"));
    expect(j).toMatchObject({ version: 3, status: "open" });
    expect(j?.trail.at(-1)).toMatchObject({ edge: null, from: "won", to: "standard" });
    expect(await openOn(pg.db, "won")).toBe(0);
  });

  it("leaves a journey as a ghost when the node goes and nothing moves it", async () => {
    await edit((b) =>
      withNode(b, { ...won, id: "lost", name: "Lost" }, [edgeOf("standard", "lost")]),
    );
    const c = await person("c@example.test");
    const [g] = await pg.db
      .insert(journeys)
      .values({ profileId: c, version: 4, node: "lost", entry: "yt" })
      .returning();
    const v5 = await edit((b) => withoutNode(b, "lost"));
    expect(v5.number).toBe(5);
    const [after] = await pg.db
      .select()
      .from(journeys)
      .where(eq(journeys.id, g?.id as string));
    expect(after).toMatchObject({ version: 4, node: "lost", status: "open" });
    expect(await openOn(pg.db, "lost")).toBe(1);
  });

  it("refuses a move target the new shape lacks, and a repeat of the same body", async () => {
    await expect(edit((b) => withoutNode(b, "standard"), { standard: "nowhere" })).rejects.toThrow(
      /no node nowhere/,
    );
    await expect(edit((b) => b)).rejects.toThrow(/Nothing changed/);
  });

  it("connects two nodes with a loop edge", async () => {
    const v = await edit((b) => withEdge(b, edgeOf("proposal", "engaged", { loop: true })));
    expect((await newestShape(pg.db))?.body.edges.at(-1)).toMatchObject({
      id: "proposal_loop_engaged",
      kind: "loop",
    });
    expect(v.number).toBe(6);
  });
});

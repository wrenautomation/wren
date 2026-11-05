/** One turn of the loop on a real Postgres: subject, batch, calls and notes, close, feedback. Synthetic copy. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addBatch,
  addGuide,
  addNote,
  catalog,
  closeBatch,
  feedback,
  judge,
  keep,
  newSubject,
  queue,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

describe("variants loop", () => {
  it("judges a batch and feeds it back", async () => {
    const db = pg.db;
    await newSubject(db, { slug: "opener", name: "Opener email", kind: "text", by: "me" });
    const tip = await addGuide(db, { text: "Name their tool in line one", subject: "opener" });
    const b = await addBatch(db, "opener", {
      why: "Try a named-tool opener against a question opener",
      agent: "test",
      samples: [
        { body: "Saw you use Acme CRM.\nOne idea for it.", guides: [tip.id], change: "named tool" },
        { body: "Quick question about your pipeline?", change: "question" },
        { body: "Hi there,\nHope you're well.", change: "plain" },
      ],
    });
    const [open] = await queue(db);
    expect(open?.samples).toHaveLength(3);
    const [a, q, plain] = b.samples as [number, number, number];
    await judge(db, a, "amazing", "me");
    await judge(db, plain, "bad", "me");
    await addNote(
      db,
      q,
      { anchor: { type: "quote", exact: "Quick question" }, tone: "bad", text: "generic" },
      "me",
    );
    await keep(db, a, true, "me");
    await closeBatch(db, b.batch, "More like the named-tool one", "me");
    expect(await queue(db)).toHaveLength(0);

    const f = await feedback(db, "opener");
    expect(f.batches[0]?.note).toBe("More like the named-tool one");
    expect(f.leaders[0]?.sample).toBe(a);
    expect(f.guides[0]?.effect.with).toEqual({ good: 1, n: 1 });
    const notes = f.batches[0]?.samples.find((s) => s.id === q)?.notes;
    expect(notes?.[0]?.anchor).toEqual({ type: "quote", exact: "Quick question" });
    expect((await catalog(db)).map((r) => r.sample.id)).toEqual([a]);
  });
});

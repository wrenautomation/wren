/** One turn of the loop on a real Postgres: subject, batch, calls and notes, close, feedback. Synthetic copy. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variantsConsoleApi } from "../../src/console.js";
import { variants } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

describe("variants loop", () => {
  it("judges a batch and feeds it back", async () => {
    const db = pg.db;
    const v = variants(db);
    await v.newSubject({ slug: "opener", name: "Opener email", kind: "text", by: "me" });
    const tip = await v.addGuide({ text: "Name their tool in line one", subject: "opener" });
    const b = await v.addBatch("opener", {
      why: "Try a named-tool opener against a question opener",
      agent: "test",
      samples: [
        { body: "Saw you use Acme CRM.\nOne idea for it.", guides: [tip.id], change: "named tool" },
        { body: "Quick question about your pipeline?", change: "question" },
        { body: "Hi there,\nHope you're well.", change: "plain" },
      ],
    });
    const [open] = await v.queue();
    expect(open?.samples).toHaveLength(3);
    const [a, q, plain] = b.samples as [number, number, number];
    await v.judge(a, "amazing", "me");
    await v.judge(plain, "bad", "me");
    await v.addNote(
      q,
      { anchor: { type: "quote", exact: "Quick question" }, tone: "bad", text: "generic" },
      "me",
    );
    await v.keep(a, true, "me");
    await v.closeBatch(b.batch, "More like the named-tool one", "me");
    expect(await v.queue()).toHaveLength(0);

    const f = await v.feedback("opener");
    expect(f.batches[0]?.note).toBe("More like the named-tool one");
    expect(f.leaders[0]?.sample).toBe(a);
    expect(f.guides[0]?.effect.with).toEqual({ good: 1, n: 1 });
    const notes = f.batches[0]?.samples.find((s) => s.id === q)?.notes;
    expect(notes?.[0]?.anchor).toEqual({ type: "quote", exact: "Quick question" });
    expect((await v.catalog()).map((r) => r.sample.id)).toEqual([a]);

    // the Batches page: newest first; an open batch hides what each sample tests
    const b2 = await v.addBatch("opener", {
      why: "Named tools, three ways",
      agent: "test",
      samples: [{ body: "Your Acme CRM, one idea.", change: "short" }],
    });
    const rows = await variantsConsoleApi(db).batches();
    expect(rows.map((r) => [r.id, r.state, r.why])).toEqual([
      [b2.batch, "open", null],
      [b.batch, "closed", "Try a named-tool opener against a question opener"],
    ]);
    expect(rows[0]?.samples[0]?.change).toBeNull();
    expect(rows[1]?.samples.map((s) => s.change)).toEqual(["named tool", "question", "plain"]);
    expect(rows[1]?.samples.find((s) => s.id === q)?.notes).toHaveLength(1);
    expect(rows[1]?.subject.slug).toBe("opener");
  });
});

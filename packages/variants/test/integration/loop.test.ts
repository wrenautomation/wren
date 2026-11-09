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
      title: "Two openers",
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
      title: "Named-tool openers",
      why: "Named tools, three ways",
      agent: "test",
      samples: [{ body: "Your Acme CRM, one idea.", change: "short" }],
    });
    const api = variantsConsoleApi(db);
    type Req = Parameters<typeof api.batches>[0];
    const as = (email: string, q: Record<string, unknown> = {}) =>
      ({ viewer: { email }, ...q }) as unknown as Req;
    const page = await api.batches(as("me", { sort: "newest" }));
    expect(page.rows.map((r) => [r.ref, r.state, r.title, r.why, r.waits])).toEqual([
      [b2.batch, "open", "Named-tool openers", null, true],
      [b.batch, "closed", "Two openers", "Try a named-tool opener against a question opener", false],
    ]);
    expect(page.waiting).toBe(1);
    expect(page.rows[1]?.tally).toEqual({ amazing: 1, good: 0, okay: 0, bad: 1, unmarked: 1 });
    expect((await api.batches(as("me", { state: "closed" }))).rows).toHaveLength(1);
    expect((await api.batches(as("me", { who: "me" }))).rows.map((r) => r.ref)).toEqual([b.batch]);

    // one batch by its ref: open hides what each sample tests; closed shows it
    const open2 = await api.batch(as("me", { ref: b2.batch }));
    expect(open2.samples[0]?.change).toBeNull();
    const shut = await api.batch(as("me", { ref: b.batch }));
    expect(shut.samples.map((s) => s.change)).toEqual(["named tool", "question", "plain"]);
    expect(shut.samples.find((s) => s.id === q)?.notes).toHaveLength(1);
    expect(shut.subject.slug).toBe("opener");
    expect(shut.newer?.ref).toBe(b2.batch);

    // a second person on the open batch: each sees only their own call
    const [s2] = (await api.batch(as("me", { ref: b2.batch }))).samples;
    await api.judge(as("me", { sample: s2?.id, verdict: "good" }));
    await api.judge(as("you", { sample: s2?.id, verdict: "bad" }));
    expect((await api.batch(as("me", { ref: b2.batch }))).samples[0]?.verdict).toBe("good");
    expect((await api.batch(as("you", { ref: b2.batch }))).samples[0]?.verdict).toBe("bad");
  });
});

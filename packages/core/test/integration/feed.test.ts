/** A run's feed: lines written as a stage works, read back after a cursor. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorText, readFeed, runFeed } from "../../src/feed.js";
import { runEvents } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

/** A fresh `runs` row. */
const newRun = async () => {
  const [r] = await pg.db.execute<{ id: string }>(
    sql`insert into runs (id, command, argv) values (gen_random_uuid(), 'crm run', '{}'::jsonb) returning id`,
  );
  return r?.id ?? "";
};
const quiet = () => {
  const said: string[] = [];
  return { said, warn: (m: string) => said.push(m) };
};

describe("runFeed", () => {
  it("writes a line with every field, and defaults the rest (and an empty detail) to null", async () => {
    const run = await newRun();
    const feed = runFeed(pg.db, run);
    await feed.emit({
      step: "lookup",
      kind: "found",
      line: "Cara Lim moved to Initech",
      subject: "Cara Lim",
      count: 1,
      source: { label: "Web search", href: "https://example.com/cara" },
      detail: "why",
      traceId: "a".repeat(32),
    });
    await feed.emit({ step: "lookup", kind: "started", line: "Finding where each person is now" });
    await feed.emit({ step: "s", kind: "did", line: "hi", detail: "" });
    const [full, bare, empty] = await readFeed(pg.db, run);
    expect(full).toMatchObject({
      step: "lookup",
      kind: "found",
      line: "Cara Lim moved to Initech",
      subject: "Cara Lim",
      count: 1,
      source: { label: "Web search", href: "https://example.com/cara" },
      detail: "why",
    });
    expect(full).not.toHaveProperty("traceId");
    expect(Number.isNaN(Date.parse(full?.at ?? ""))).toBe(false);
    expect(bare).toMatchObject({ subject: null, count: null, source: null, detail: null });
    expect(empty?.detail).toBeNull(); // an empty detail is stored as null
    const [row] = await pg.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.seq, full?.seq ?? 0));
    expect(row?.traceId).toBe("a".repeat(32));
  });

  it("cuts a long line to 300 and a long detail to 500, ending in an ellipsis; exactly at the cap stays", async () => {
    const run = await newRun();
    await runFeed(pg.db, run).emit({
      step: "s",
      kind: "failed",
      line: "x".repeat(400),
      detail: "y".repeat(900),
    });
    await runFeed(pg.db, run).emit({
      step: "s",
      kind: "did",
      line: "x".repeat(300),
      detail: "y".repeat(500),
    });
    const [l, exact] = await readFeed(pg.db, run);
    expect(l?.line).toBe(`${"x".repeat(299)}…`);
    expect(l?.detail).toBe(`${"y".repeat(499)}…`);
    expect(exact?.line).toBe("x".repeat(300));
    expect(exact?.detail).toBe("y".repeat(500));
  });

  it("never splits an emoji at the cut", async () => {
    const run = await newRun();
    await runFeed(pg.db, run).emit({ step: "s", kind: "did", line: `${"x".repeat(298)}😀tail` });
    const line = (await readFeed(pg.db, run))[0]?.line ?? "";
    expect(line).not.toContain("�");
    expect(line.endsWith("…")).toBe(true);
  });

  it("a NUL in an error's text doesn't stop the feed", async () => {
    const run = await newRun();
    const { said, warn } = quiet();
    const feed = runFeed(pg.db, run, warn);
    await feed.emit({
      step: "s",
      kind: "failed",
      line: "Couldn't finish Acme",
      detail: "bad\u0000",
    });
    await feed.emit({ step: "s", kind: "did", line: "next" });
    expect(said).toEqual([]);
    expect((await readFeed(pg.db, run)).map((l) => l.line)).toEqual([
      "Couldn't finish Acme",
      "next",
    ]);
  });

  it("after one failed write it warns once, never throws, and goes quiet", async () => {
    const run = crypto.randomUUID(); // no runs row yet: the write fails
    const { said, warn } = quiet();
    const feed = runFeed(pg.db, run, warn);
    await expect(feed.emit({ step: "s", kind: "did", line: "one" })).resolves.toBeUndefined();
    await pg.db.execute(
      sql`insert into runs (id, command, argv) values (${run}, 'crm run', '{}'::jsonb)`,
    );
    // The row exists now; the feed still writes nothing and says nothing more.
    await feed.emit({ step: "s", kind: "did", line: "two" });
    await feed.emit({ step: "s", kind: "did", line: "three" });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`feed for run ${run} stopped:`);
    expect(await readFeed(pg.db, run)).toEqual([]);
  });
});

describe("readFeed", () => {
  it("only this run's lines, oldest first; none for a run with no lines", async () => {
    const [a, b] = [await newRun(), await newRun()];
    const fa = runFeed(pg.db, a);
    const fb = runFeed(pg.db, b);
    await fa.emit({ step: "s", kind: "did", line: "a1" });
    await fb.emit({ step: "s", kind: "did", line: "b1" });
    await fa.emit({ step: "s", kind: "did", line: "a2" });
    const lines = await readFeed(pg.db, a);
    expect(lines.map((l) => l.line)).toEqual(["a1", "a2"]);
    expect(lines[0]?.seq).toBeLessThan(lines[1]?.seq ?? 0);
    expect(await readFeed(pg.db, await newRun())).toEqual([]); // a run with no lines
  });

  it("after a cursor: only the lines past it; past the end: none; a limit takes the oldest", async () => {
    const run = await newRun();
    const feed = runFeed(pg.db, run);
    for (const line of ["1", "2", "3"]) await feed.emit({ step: "s", kind: "did", line });
    const all = await readFeed(pg.db, run);
    const after = await readFeed(pg.db, run, { after: all[0]?.seq ?? 0 });
    expect(after.map((l) => l.line)).toEqual(["2", "3"]);
    expect(await readFeed(pg.db, run, { after: all[2]?.seq ?? 0 })).toEqual([]);
    // a limit takes the oldest lines first
    expect((await readFeed(pg.db, run, { limit: 2 })).map((l) => l.line)).toEqual(["1", "2"]);
  });
});

describe("errorText", () => {
  it("an error: its name and message; anything else as a string", () => {
    expect(errorText(new TypeError("bad input"))).toBe("TypeError: bad input");
    expect(errorText(new Error(""))).toBe("Error: ");
    // anything else: as a string
    expect(errorText("plain")).toBe("plain");
    expect(errorText(429)).toBe("429");
    expect(errorText(null)).toBe("null");
    expect(errorText(undefined)).toBe("undefined");
  });
});

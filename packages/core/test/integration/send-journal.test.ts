/** The send journal on Postgres: one record per key, written before the act. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbSendJournal, openTry } from "../../src/send-journal.js";
import type { SendVerdict } from "../../src/send-verdict.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const entry = (key: string) => ({
  key,
  site: "reddit",
  method: "POST",
  path: "/api/submit",
  account: null,
});
const T0 = new Date("2026-10-16T12:00:00Z");

describe("dbSendJournal", () => {
  it("the first begin wins; a second reads the open record and never wins", async () => {
    const j = dbSendJournal(pg.db);
    expect(await j.read("a")).toBeNull();
    expect(await j.begin(entry("a"), T0)).toEqual({ won: true });
    const again = await j.begin(entry("a"), new Date(T0.getTime() + 60_000));
    expect(again).toEqual({
      won: false,
      record: { verdict: null, startedAt: T0.toISOString() },
    });
    if (again.won) throw new Error("a second begin must lose");
    expect(openTry(again.record)).toMatchObject({
      verdict: "unknown",
      since: T0.toISOString(),
    });
  });

  it("settle stores the verdict, and read returns it", async () => {
    const j = dbSendJournal(pg.db);
    await j.begin(entry("b"), T0);
    const v: SendVerdict = {
      verdict: "not_sent",
      how: "refused",
      reason: "RATELIMIT",
      status: 422,
    };
    await j.settle("b", v, T0);
    expect(await j.read("b")).toEqual({ verdict: v, startedAt: T0.toISOString() });
    expect(await j.begin(entry("b"), T0)).toMatchObject({ won: false });
  });

  it("two races for one key: exactly one wins", async () => {
    const j = dbSendJournal(pg.db);
    const won = await Promise.all([j.begin(entry("c"), T0), j.begin(entry("c"), T0)]);
    expect(won.filter((r) => r.won)).toHaveLength(1);
  });
});

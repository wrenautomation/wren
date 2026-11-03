/** Texts to William: from a number in his country, never a lead's thread. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SmsNotifier } from "../../src/operator.js";
import { FakeProvider } from "../../src/provider.js";
import { smsMessages } from "../../src/schema.js";
import { numbers, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;
const WILLIAM = "+14165550142";

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  provider = new FakeProvider();
});

describe("SmsNotifier", () => {
  it("texts from a number in his country, plain text, and logs nothing as a lead text", async () => {
    await numbers(pg.db, provider, ["+13125550001", "+14165550100"]);
    const n = new SmsNotifier(pg.db, provider, WILLIAM, () => {});
    expect(await n.notify("Warm reply from Jane", "**they said** Wednesday", "warning")).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ from: "+14165550100", to: WILLIAM });
    expect(provider.sent[0]?.text).toBe("! Warm reply from Jane\nthey said Wednesday");
    expect(await pg.db.select().from(smsMessages)).toHaveLength(0);
  });

  it("no number in his country: skipped, false, never throws", async () => {
    await numbers(pg.db, provider, ["+13125550001"]);
    const logged: string[] = [];
    const n = new SmsNotifier(pg.db, provider, WILLIAM, (l) => logged.push(l));
    expect(await n.notify("x")).toBe(false);
    expect(provider.sent).toHaveLength(0);
    expect(logged.join()).toContain("no active number in CA");
  });

  it("a US number off the campaign never texts", async () => {
    await numbers(pg.db, provider, ["+13125550001"], "2026-09-01", { registered: false });
    const n = new SmsNotifier(pg.db, provider, "+12125550101", () => {});
    expect(await n.notify("x")).toBe(false);
  });

  it("a carrier error is false, not a throw", async () => {
    await numbers(pg.db, provider, ["+14165550100"]);
    provider.explode.add(WILLIAM);
    expect(await new SmsNotifier(pg.db, provider, WILLIAM, () => {}).notify("x")).toBe(false);
  });
});

/**
 * Email link clicks against the migrated schema: a code on the lander names
 * its message and company, the visitor's later views and application follow
 * it, and a code no message holds stays unnamed rather than guessed.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailClicks, type SiteApplication, type SiteHit } from "../../src/inbox/clicks.js";
import { allMessages, makeCompany, makePerson, runCompose, TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));

let n = 0;
const view = (visitor: string, over: Partial<SiteHit> = {}): SiteHit => ({
  id: ++n,
  ts: `2026-09-29T10:${String(n).padStart(2, "0")}:00Z`,
  visitor,
  page: "/",
  secs: 20,
  cta: 0,
  touched: 0,
  r: "",
  ...over,
});

describe("emailClicks", () => {
  it("names the message behind a code and follows its visitor", async () => {
    const company = await makeCompany(pg.db, { name: "Oakbridge" });
    await makePerson(pg.db, company, { email: "jane@oakbridge.example" });
    await runCompose(pg.db);
    const [opener] = await allMessages(pg.db);
    const code = opener?.linkCode as string;
    const hits = [
      view("v1", { r: code }),
      view("v1", { page: "/recruiting", cta: 1 }),
      view("v2", { r: "typedByHand1" }),
      view("v3"),
    ];
    const apps: SiteApplication[] = [
      { id: 1, ts: "2026-09-29T11:00:00Z", visitor: "v1", offer: "reactivation", fit: 1, r: code },
    ];
    const clicks = await emailClicks(pg.db, hits, apps);
    const named = clicks.find((c) => c.code === code);
    expect(named?.message).toMatchObject({
      company: "Oakbridge",
      toEmail: "jane@oakbridge.example",
      step: 0,
    });
    expect(named).toMatchObject({ visitors: 1, views: 2, secs: 40, reachedForm: true });
    expect(named?.applied).toMatchObject({ offer: "reactivation", fit: true });
    const unknown = clicks.find((c) => c.code === "typedByHand1");
    expect(unknown?.message).toBeNull();
    expect(unknown?.applied).toBeNull();
    expect(clicks).toHaveLength(2);
  });
});

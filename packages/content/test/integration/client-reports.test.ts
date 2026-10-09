/**
 * Client reports on a real Postgres (designs/2026-10-09-client-reports.md): a closed week read
 * against the one before, kept every run, mailed per member only with mail on, Run now mailed to
 * nobody, a member who left told on the run, a stranger refused at save. Synthetic data only.
 */
import { addClient, addMember, removeMember } from "@wren/core/clients";
import { date, defineRecord, number } from "@wren/core/records";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ReportMail, runReport, saveReport } from "../../src/client-reports/store.js";

const siteDay = defineRecord({
  id: "marketing.site_day",
  app: "marketing",
  channel: null,
  name: { one: "day", many: "days" },
  // The week read (Oct 5 to 11), the week before (Sep 28 to Oct 4), and this week (not read).
  rows: async () =>
    (
      [
        ["2026-10-05T12:00:00Z", 100, 2],
        ["2026-10-11T20:00:00Z", 20, 1],
        ["2026-09-29T12:00:00Z", 60, 3],
        ["2026-10-12T12:00:00Z", 999, 9],
      ] as const
    ).map(([day, visits, forms], i) => ({ id: i + 1, day: new Date(day), visits, forms })),
  key: "id",
  title: "day",
  fields: { day: date(), visits: number(), forms: number() },
  views: [{ id: "all", label: "All", at: "day" }],
});

let pg: TestPostgres;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
const mailed: ReportMail[] = [];
const mail = {
  send: async (m: ReportMail) => void mailed.push(m),
  on: true,
  portal: "https://app.example.test",
};
const deps = () => ({ main: pg.db, open, records: [siteDay], mail });
// Monday 2026-10-12 09:00 in Toronto.
const DUE = new Date("2026-10-12T13:00:00Z");

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "rho",
    name: "Rho Test",
    products: { "marketing.stats": {} },
  });
  await addMember(pg.db, "rho", "owner@rho.example.test", { role: "owner" });
  await addMember(pg.db, "rho", "gone@rho.example.test", { role: "member" });
}, 120_000);
afterAll(() => pg?.stop());

describe("client reports", () => {
  it("refuses a recipient outside the workspace", async () => {
    await expect(
      saveReport(pg.db, {
        client: "rho",
        input: {
          name: "Weekly",
          tiles: ["visits"],
          every: "week",
          zone: "America/Toronto",
          recipients: ["x@else.example.test"],
          on: true,
        },
        by: "owner@rho.example.test",
        now: DUE,
      }),
    ).rejects.toThrow(/isn't in this workspace/);
  });

  it("reads the closed week, keeps it, mails each member", async () => {
    const r = await saveReport(pg.db, {
      client: "rho",
      input: {
        name: "Weekly",
        tiles: ["forms", "visits"],
        every: "week",
        zone: "America/Toronto",
        recipients: ["owner@rho.example.test", "gone@rho.example.test"],
        on: true,
      },
      by: "owner@rho.example.test",
      now: new Date("2026-10-09T16:00:00Z"),
    });
    expect(r.nextAt?.toISOString()).toBe(DUE.toISOString());
    expect(r.tiles).toEqual(["visits", "forms"]);
    await removeMember(pg.db, "rho", "gone@rho.example.test");

    const s = await runReport(deps(), { id: r.id, at: DUE, closed: true });
    expect(s?.lines.map((l) => [l.tile, l.value, l.prior])).toEqual([
      ["visits", 120, 60],
      ["forms", 3, 3],
    ]);
    expect(s?.sentTo).toEqual(["owner@rho.example.test"]);
    expect(s?.why).toBe("gone@rho.example.test left the workspace");
    expect(mailed).toHaveLength(1);
    expect(mailed[0]?.subject).toBe("Weekly, Oct 5 to Oct 11");
    expect(mailed[0]?.text).toContain("Site visits: 120 (+100% on the period before)");

    // Run now: the last 7 days (Sunday night and Monday), kept, mailed to nobody.
    const now = await runReport(deps(), {
      id: r.id,
      at: new Date("2026-10-12T18:00:00Z"),
      closed: false,
      by: "owner@rho.example.test",
    });
    expect(now?.lines[0]?.value).toBe(1019);
    expect(now?.sentTo).toEqual([]);
    expect(mailed).toHaveLength(1);

    // Mail off: kept, said so.
    const off = await runReport(
      { ...deps(), mail: { ...mail, on: false } },
      { id: r.id, at: DUE, closed: true },
    );
    expect(off?.why).toBe("Kept, mail is off");
    expect(mailed).toHaveLength(1);
  });
});

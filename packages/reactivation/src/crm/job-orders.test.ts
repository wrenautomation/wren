import { describe, expect, it } from "vitest";
import { ORDER_FORMATS, readJobOrders } from "./job-orders.js";

const read = (format: string, csv: string) => {
  const f = ORDER_FORMATS.get(format);
  if (!f) throw new Error(format);
  return readJobOrders(f, "orders.csv", new TextEncoder().encode(csv));
};

describe("job orders", () => {
  it("reads Bullhorn's open flag, day-first dates and a work email's domain", () => {
    const { orders, skipped } = read(
      "bullhorn",
      [
        "ID,Title,Client Corporation,Contact Email,Status,Open/Closed,# of Openings,Date Added,Date Closed",
        "101,Welder,Acme Co,jo@acme.example,Accepting Candidates,Open,2,25/03/2026,",
        "102,Driver,Acme Co,jo@gmail.com,Filled,Closed,1,01/02/2026,20/02/2026",
        "103,Clerk,,,,Open,1,,",
      ].join("\n"),
    );
    expect(skipped).toBe(1);
    expect(orders).toMatchObject([
      {
        orderKey: "101",
        domain: "acme.example",
        open: true,
        openings: 2,
        openedOn: "2026-03-25",
      },
      {
        orderKey: "102",
        domain: null,
        companyName: "Acme Co",
        open: false,
        closedOn: "2026-02-20",
      },
    ]);
  });

  it("without an open column, a close date or a shut status closes it", () => {
    const { orders } = read(
      "ats-generic",
      [
        "Job Title,Company,Status,Closed",
        "A,Beta,Active,",
        "B,Beta,On Hold,",
        "C,Beta,Active,2026-01-05",
        "A,Beta,Active,",
      ].join("\n"),
    );
    expect(orders.map((o) => o.open)).toEqual([true, false, false, true]);
    // No id: the same firm and role twice are still two orders.
    expect(new Set(orders.map((o) => o.orderKey)).size).toBe(4);
  });

  it("fails before reading rows when nothing names the company", () => {
    expect(() => read("ats-generic", "Job Title,Status\nA,Open")).toThrow(/no company/);
  });
});

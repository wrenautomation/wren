import type { RecordMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { askFor, periodStart, perRow, tileHref } from "./overview.js";

const meta = {
  id: "x.reply",
  views: [
    { id: "waiting", label: "Waiting", at: "received" },
    { id: "all", label: "All", at: "received" },
  ],
} as unknown as RecordMeta;
const now = new Date(2026, 9, 4, 15);

describe("Overview tiles", () => {
  it("start a period on its first day, today counted", () => {
    expect(periodStart("month", now)).toBe("2026-10-01");
    expect(periodStart(30, now)).toBe("2026-09-05");
    expect(periodStart(1, now)).toBe("2026-10-04");
  });
  it("open the rows they counted", () => {
    const tile = { label: "Replies", record: "x.reply", href: "/inbox/replies?view=all" };
    expect(tileHref({ ...tile, period: 7 }, meta, now)).toBe(
      "/inbox/replies?view=all&received=2026-09-28..",
    );
    expect(tileHref({ ...tile, period: 7, at: "sent" }, meta, now)).toBe(
      "/inbox/replies?view=all&sent=2026-09-28..",
    );
    expect(tileHref(tile, meta, now)).toBe("/inbox/replies?view=all");
  });
  it("count without a view their record lacks (a link to another page)", () => {
    const m = { ...meta, fields: [] };
    expect(askFor(m, "/marketing/funnel?view=30d")).toEqual(askFor(m, "/marketing/funnel"));
    expect(askFor(m, "/inbox/replies?view=all").view).toBe("all");
  });
});

describe("perRow", () => {
  it("fills each row, four at most, none alone", () => {
    expect(perRow(4)).toEqual([4]);
    expect(perRow(5)).toEqual([3, 2]);
    expect(perRow(6)).toEqual([3, 3]);
    expect(perRow(7)).toEqual([4, 3]);
    expect(perRow(9)).toEqual([3, 3, 3]);
  });
});

import { describe, expect, it } from "vitest";
import {
  IN_HOUSE,
  includedIn,
  inHouseOfApp,
  inHouseOfPart,
  monthlyOf,
  totalOf,
} from "./in-house.js";

describe("in-house tools", () => {
  it("every entry names a vendor with its own pricing page and the day it was read", () => {
    expect(IN_HOUSE.length).toBeGreaterThan(0);
    expect(new Set(IN_HOUSE.map((t) => t.id)).size).toBe(IN_HOUSE.length);
    for (const t of IN_HOUSE) {
      expect(t.instead.length, t.id).toBeGreaterThan(0);
      expect(t.instead.length, t.id).toBeLessThanOrEqual(2);
      for (const i of t.instead) {
        expect(i.url, `${t.id} ${i.vendor}`).toMatch(/^https:\/\/[^/]+\.[a-z]+\//);
        expect(i.asOf, `${t.id} ${i.vendor}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(i.plan, `${t.id} ${i.vendor}`).not.toBe("");
        expect(i.unit, `${t.id} ${i.vendor}`).not.toBe("");
        // No public number: the unit says so, and nothing is counted.
        if (i.price === null) expect(i.monthly, `${t.id} ${i.vendor}`).toBeNull();
        if (i.monthly !== null) expect(i.monthly).toBeGreaterThan(0);
      }
    }
  });

  it("totals count live tools only", () => {
    const building = IN_HOUSE.filter((t) => t.state !== "live");
    expect(building.length).toBeGreaterThan(0);
    const all = totalOf(IN_HOUSE);
    expect(all.tools.every((t) => t.state === "live")).toBe(true);
    expect(all.monthly).toBe(all.tools.reduce((n, t) => n + (monthlyOf(t) ?? 0), 0));
    // A client with only a building tool's part installed gets nothing counted.
    const calendar = IN_HOUSE.find((t) => t.id === "calendar");
    expect(calendar?.state).toBe("building");
    expect(includedIn(new Set(calendar?.parts))).toEqual({ tools: [], monthly: 0 });
    const email = includedIn(new Set(["email.sequences"]));
    expect(email.tools.map((t) => t.id)).toEqual(["cold-email"]);
    expect(email.monthly).toBe(47);
    expect(includedIn(new Set())).toEqual({ tools: [], monthly: 0 });
  });

  it("a launcher card names only a live tool", () => {
    for (const t of IN_HOUSE)
      for (const app of t.apps) expect(inHouseOfApp(app)?.state ?? "live").toBe("live");
    expect(inHouseOfApp("calendar")).toBeNull();
    // A Shop part names its live tool first: Marketing numbers is site analytics, not heatmaps.
    expect(inHouseOfPart("marketing.stats")?.id).toBe("site-analytics");
  });
});

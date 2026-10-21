/** ⌘K lists every app and page a viewer may open, whether the sidebar shows it or not. */
import { describe, expect, it } from "vitest";
import { homeOf, jumps } from "./palette-items.js";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./modules/index.js");

describe("jumps", () => {
  const all = new Set(MODULES.flatMap((m) => (m.component ? [m.component] : [])));
  const apps = appsIn(MODULES, { wren: true, team: true, installed: all });
  const items = jumps(apps, "/", homeOf(true), new Map());

  it("lists the Map first for Wren's team, Today for a client", () => {
    expect(items[0]?.label).toBe("Map");
    expect(jumps(apps, "/", homeOf(false), new Map())[0]?.label).toBe("Today");
  });

  it("holds every page of every app, the fixed ones and the rest", () => {
    const hrefs = new Set(items.map((i) => i.href));
    for (const m of apps)
      for (const p of m.pages.filter((x) => !x.hidden))
        expect(hrefs, `/${m.id}/${p.id}`).toContain(`/${m.id}/${p.id}`);
  });

  it("holds Systems and tags a parked app's pages", () => {
    expect(items.some((i) => i.href === "/settings/systems")).toBe(true);
    expect(items.find((i) => i.href === "/notes/home")?.hint).toContain("parked");
  });
});

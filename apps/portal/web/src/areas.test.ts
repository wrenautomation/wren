/** Every app sits in one area, and an area shows only the apps a workspace has. */
import { describe, expect, it } from "vitest";
import { AREAS, areasOf } from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES } = await import("./modules/index.js");

describe("areas", () => {
  it("names every app but the menu ones, each once", () => {
    const named = AREAS.flatMap((a) => a.apps);
    expect(new Set(named).size).toBe(named.length);
    for (const m of MODULES.filter((x) => !x.menu)) expect(named, m.id).toContain(m.id);
  });

  it("keeps area order, skips empty areas, puts an unnamed app under Tools", () => {
    const apps = [{ id: "notes" }, { id: "new-app" }, { id: "inbox" }, { id: "money" }];
    expect(areasOf(apps).map((a) => [a.area.id, a.apps.map((m) => m.id)])).toEqual([
      ["inbox", ["inbox"]],
      ["business", ["money"]],
      ["tools", ["notes", "new-app"]],
    ]);
  });
});

/** Products gate pages, not places: a page names its component; a client sees what it installed. */
import { OFFERS } from "@wren/offers";
import { COMPONENTS } from "@wren/worker/components";
import { describe, expect, it } from "vitest";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./index.js");

const live = (wren: boolean, team: boolean, installed: string[]) =>
  appsIn(MODULES, { wren, team, installed: new Set(installed) }).filter((m) => !m.parked);
const ids = (wren: boolean, team: boolean, installed: string[]) =>
  live(wren, team, installed).map((m) => m.id);

describe("places and components", () => {
  it("every gate names a component", () => {
    const known = new Set(COMPONENTS.map((c) => c.id));
    for (const m of MODULES) {
      if (m.component) expect(known, m.id).toContain(m.component);
      for (const p of m.pages)
        if (p.component) expect(known, `${m.id}/${p.id}`).toContain(p.component);
    }
  });

  it("an offer's add-on is a ready client component", () => {
    for (const o of OFFERS)
      if (o.addOn)
        expect(
          COMPONENTS.find((c) => c.id === o.addOn && c.for === "client" && c.ready),
          o.id,
        ).toBeDefined();
  });

  it("a client sees the pages of what it installed; the team sees every page", () => {
    expect(ids(false, false, [])).toEqual(["people", "office"]);
    expect(ids(false, false, ["reactivation"])).toEqual(["campaigns", "people", "office"]);
    expect(ids(false, false, ["delivery.portal"])).toContain("map");
    expect(ids(false, true, [])).toEqual([
      "map",
      "campaigns",
      "content",
      "people",
      "inbox",
      "calendar",
      "office",
    ]);
    // Installing a part adds its pages and nothing else.
    const pages = (inst: string[]) => live(false, false, inst).flatMap((m) => m.pages);
    const added = pages(["calls.outcome"]).filter((p) => !pages([]).includes(p));
    expect(added.length).toBeGreaterThan(0);
    for (const p of added) expect(p.component).toBe("calls.outcome");
  });

  it("Wren's workspace holds Wren's places, never a client's", () => {
    expect(ids(true, true, [])).toEqual([
      "map",
      "campaigns",
      "content",
      "people",
      "inbox",
      "calendar",
      "office",
      "research",
    ]);
  });
});

/** Every portal app is in exactly one component, or the platform's own; a module names its component. */
import { OFFERS } from "@wren/offers";
import { COMPONENTS, PLATFORM } from "@wren/worker/components";
import { describe, expect, it } from "vitest";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./index.js");

describe("apps and components", () => {
  it("every app is one component's, or the platform's", () => {
    for (const m of MODULES) {
      const owners = COMPONENTS.filter((c) => c.provides.apps.includes(m.id)).map((c) => c.id);
      expect(owners, m.id).toEqual(m.id in PLATFORM.apps ? [] : [m.component]);
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

  it("every app a component provides is a module", () => {
    const ids = MODULES.map((m) => m.id);
    for (const c of COMPONENTS) for (const a of c.provides.apps) expect(ids, c.id).toContain(a);
  });

  it("a client sees only the apps of what it installed; the team sees the rest", () => {
    const ids = (team: boolean, installed: string[]) =>
      appsIn(MODULES, { wren: false, team, installed: new Set(installed) }).map((m) => m.id);
    expect(ids(false, ["reactivation"])).toEqual([
      "reactivation",
      "marketplace",
      "notes",
      "account",
    ]);
    expect(ids(false, [])).toEqual(["marketplace", "notes", "account"]);
    expect(ids(true, [])).toEqual([
      "work",
      "reactivation",
      "leads",
      "texts",
      "calls",
      "marketplace",
      "marketing",
      "notes",
      "calendar",
      "account",
    ]);
    expect(ids(false, ["calendar.booking"])).toEqual(["marketplace", "notes", "calendar", "account"]);
    expect(ids(false, ["research.lead_sheet"])).toEqual(["leads", "marketplace", "notes", "account"]);
    expect(ids(false, ["calls.outcome"])).toEqual(["calls", "marketplace", "notes", "account"]);
    expect(ids(false, ["marketing.stats"])).toEqual(["marketplace", "marketing", "notes", "account"]);
    // Wren's own Marketing in Wren's workspace, never the client's pages.
    const wrens = appsIn(MODULES, { wren: true, team: true, installed: new Set() });
    expect(wrens.filter((m) => m.id === "marketing").map((m) => m.pages.length > 5)).toEqual([
      true,
    ]);
    expect(
      appsIn(MODULES, { wren: true, team: true, installed: new Set() }).map((m) => m.id),
    ).not.toContain("work");
  });
});

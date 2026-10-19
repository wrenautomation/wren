/** Every place the Map opens a node is a real page of a real app, in the workspace it is for. */
import { describe, expect, it } from "vitest";
import { opensOf, ROUTES, rowOf, type Target } from "./routes.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("../modules/index.js");

describe("map routes", () => {
  for (const place of ["wren", "client"] as const) {
    it(`each ${place} target is a page of an app in that workspace`, () => {
      const apps = appsIn(MODULES, {
        wren: place === "wren",
        team: place === "wren",
        installed: new Set(MODULES.flatMap((m) => (m.component ? [m.component] : []))),
      });
      const targets = Object.values(ROUTES).flatMap((r) => r[place] as readonly Target[]);
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        const app = apps.find((m) => m.id === t.app);
        expect(app, `${t.app} is an app at ${place}`).toBeDefined();
        expect(
          app?.pages.some((p) => p.id === t.page),
          `${t.app}/${t.page}`,
        ).toBe(true);
      }
    });
  }

  it("reads a node's row", () => {
    expect(rowOf({ kind: "source", via: "ads" })).toBe("ads");
    expect(rowOf({ kind: "source", via: "outbound", channel: "linkedin" })).toBe("dm");
    expect(rowOf({ kind: "source", via: "outbound", channel: "email" })).toBe("source");
    expect(rowOf({ kind: "source", via: "organic", channel: "youtube" })).toBe("source");
    expect(rowOf({ kind: "step" })).toBe("step");
    expect(rowOf({ kind: "offer" })).toBe("offer");
    expect(rowOf({ kind: "plan" })).toBe("plan");
  });

  it("links a step to its people, an offer to its offer too", () => {
    expect(opensOf({ id: "booked", kind: "step" }, "wren", null)).toEqual([
      { label: "Journeys", href: "/pipelines/journeys?node=booked&view=all" },
    ]);
    expect(opensOf({ id: "signed", kind: "offer" }, "wren", null).map((o) => o.href)).toEqual([
      "/pipelines/journeys?node=signed&view=all",
      "/offers/all",
    ]);
    expect(opensOf({ id: "pay", kind: "plan" }, "client", "acme")).toEqual([
      { label: "Payments", href: "/payments/links?client=acme" },
    ]);
  });
});

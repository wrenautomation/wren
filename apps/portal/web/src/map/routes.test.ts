/** Every place the Map opens a node is a real page of a real app, in the workspace it is for. */
import { describe, expect, it } from "vitest";
import {
  appsOnShape,
  mapNodeHref,
  nodeOfParams,
  opensOf,
  ROUTES,
  rowOf,
  systemsOf,
  type Target,
} from "./routes.js";

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

const NODES = [
  { id: "yt", name: "YouTube line", kind: "source" as const, via: "organic", channel: "youtube" },
  { id: "ads1", name: "Meta ads", kind: "source" as const, via: "ads" },
  { id: "dm1", name: "LinkedIn DM", kind: "source" as const, via: "outbound", channel: "linkedin" },
  { id: "old", name: "Old line", kind: "source" as const, via: "organic", parked: true as const },
  { id: "booked", name: "Call booked", kind: "step" as const },
  { id: "signed", name: "Signed", kind: "offer" as const },
  { id: "pay", name: "Retainer", kind: "plan" as const },
];

describe("appsOnShape", () => {
  it("names each node under every app it opens, at Wren", () => {
    const on = appsOnShape(NODES, "wren");
    expect(on.get("pipelines")?.map((n) => n.id)).toEqual(["booked", "signed", "pay"]);
    expect(on.get("offers")?.map((n) => n.id)).toEqual(["signed"]);
    expect(on.get("ads")?.map((n) => n.id)).toEqual(["ads1"]);
    expect(on.get("engage")?.map((n) => n.id)).toEqual(["dm1"]);
    expect(on.get("content")?.map((n) => n.id)).toEqual(["yt"]);
  });

  it("reads the client's apps in a client's workspace", () => {
    const on = appsOnShape(NODES, "client");
    expect(on.get("marketing")?.map((n) => n.id)).toEqual(["yt", "ads1", "dm1"]);
    expect(on.get("payments")?.map((n) => n.id)).toEqual(["pay"]);
    expect(on.has("offers")).toBe(false);
  });

  it("leaves a parked node out", () => {
    expect([...appsOnShape(NODES, "wren").values()].flat().map((n) => n.id)).not.toContain("old");
  });
});

describe("systemsOf", () => {
  const apps = [
    { id: "content" },
    { id: "pipelines" },
    { id: "handlers" },
    { id: "loops" },
    { id: "notes", parked: true as const },
  ];
  it("splits apps into on the shape and not, naming the nodes", () => {
    const got = systemsOf(apps, NODES, "wren");
    expect(got.onShape.map((g) => [g.app.id, g.nodes.map((n) => n.id)])).toEqual([
      ["content", ["yt"]],
      ["pipelines", ["booked", "signed", "pay"]],
    ]);
    expect(got.rest.map((a) => a.id)).toEqual(["handlers", "loops"]);
  });
  it("puts every app in Not on the shape when there are no nodes", () => {
    const got = systemsOf(apps, [], "wren");
    expect(got.onShape).toEqual([]);
    expect(got.rest.map((a) => a.id)).toEqual(["content", "pipelines", "handlers", "loops"]);
  });
  it("puts a parked app in neither group, even when a node opens it", () => {
    const got = systemsOf([{ id: "pipelines", parked: true as const }], NODES, "wren");
    expect(got.onShape).toEqual([]);
    expect(got.rest).toEqual([]);
  });
});

describe("map node links", () => {
  it("round-trips a node id through the address, with the client when it is not Wren's", () => {
    const url = new URL(mapNodeHref("review call", "acme"), "https://x.test");
    expect(url.pathname).toBe("/");
    expect(nodeOfParams(url.searchParams)).toBe("review call");
    expect(url.searchParams.get("client")).toBe("acme");
    expect(mapNodeHref("yt", null)).toBe("/?node=yt");
    expect(nodeOfParams(new URLSearchParams(""))).toBeNull();
  });
});

/** The sidebar is the places, in order; a workspace shows the ones it has. */
import { describe, expect, it } from "vitest";
import { areasOf, dockOf, pageIcon, phoneTabsOf, sidebarOf } from "./areas.js";

// The apps read the page's address as they load; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { MODULES, appsIn } = await import("./modules/index.js");

const ALL = new Set(
  MODULES.flatMap((m) => [m.component, ...m.pages.map((p) => p.component)]).filter(
    (c): c is string => !!c,
  ),
);
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe("the places", () => {
  it("gives Wren's team the fixed places, its products, then the core", () => {
    const apps = appsIn(MODULES, { wren: true, team: true, installed: ALL });
    expect(sidebarOf(apps).map((i) => [i.label, i.area])).toEqual([
      ["Map", "fixed"],
      ["Today", "fixed"],
      ["Results", "fixed"],
      ["Content", "products"],
      ["Outbound", "products"],
      ["Research", "products"],
      ["Clients", "core"],
      ["People", "core"],
      ["Back office", "core"],
    ]);
  });

  it("gives a client its places: Project, never Map, Clients or Research", () => {
    const apps = appsIn(MODULES, { wren: false, team: false, installed: ALL });
    expect(sidebarOf(apps).map((i) => i.app.id)).toEqual([
      "today",
      "results",
      "content",
      "reactivation",
      "project",
      "people",
      "office",
    ]);
  });

  it("caps a product at 4 tabs", () => {
    for (const id of ["content", "outbound", "reactivation"])
      for (const m of MODULES.filter((x) => x.id === id))
        expect(m.pages.filter((p) => !p.hidden).length, id).toBeLessThanOrEqual(4);
  });

  it("shows no app outside a place, and no parked app", () => {
    for (const wren of [true, false]) {
      const apps = appsIn(MODULES, { wren, team: wren, installed: ALL });
      const areas = areasOf(apps);
      expect(ids(areas.map((a) => a.area))).toEqual(["places"]);
      expect(areas.flatMap((a) => ids(a.apps)).every((id) => apps.some((m) => m.id === id))).toBe(
        true,
      );
    }
    expect(
      sidebarOf([{ id: "today", parked: true as const }, { id: "map" }]).map((i) => i.label),
    ).toEqual(["Map"]);
  });

  it("drops a client's page whose product it lacks, and a place left empty", () => {
    const apps = appsIn(MODULES, { wren: false, team: false, installed: new Set() });
    expect(apps.some((m) => m.id === "reactivation")).toBe(false);
  });

  it("docks Today, Content, Outbound, People, then the first pin", () => {
    const apps = ["map", "people", "content", "outbound", "today", "office"].map((id) => ({ id }));
    const pins = [{ href: "/content/studio" }, { href: "/outbound/engage" }];
    expect(dockOf(apps, pins).map((d) => ("pin" in d ? d.pin.href : d.app.id))).toEqual([
      "today",
      "content",
      "outbound",
      "people",
      "/content/studio",
    ]);
    expect(dockOf(apps, [])).toHaveLength(4);
    expect(dockOf(apps, pins, 3)).toHaveLength(2);
    expect(dockOf([{ id: "today", parked: true as const }], [])).toEqual([]);
  });
});

describe("phoneTabsOf", () => {
  const t = (id: string, group?: string, count?: number) => ({
    id,
    label: id,
    href: `/x/${id}`,
    ...(group ? { group } : {}),
    ...(count !== undefined ? { count } : {}),
  });
  it("leads with an app's picks, then a tab per page or group", () => {
    const tabs = [
      t("mail"),
      t("calendar"),
      t("messages"),
      t("approve"),
      t("a", "G", 2),
      t("b", "G", 3),
    ];
    const out = phoneTabsOf("today", tabs);
    expect(out.map((x) => [x.id, x.label, x.holds])).toEqual([
      ["approve", "approve", ["approve"]],
      ["messages", "messages", ["messages"]],
      ["calendar", "calendar", ["calendar"]],
      ["mail", "mail", ["mail"]],
      ["a", "G", ["a", "b"]],
    ]);
    expect(out[4]?.count).toBe(5);
  });
  it("skips picks the workspace lacks", () => {
    expect(phoneTabsOf("outbound", [t("engage"), t("inboxes")]).map((x) => x.id)).toEqual([
      "engage",
      "inboxes",
    ]);
  });
  it("names an icon from the page", () => {
    expect(pageIcon("calls")).toBe("phone");
    expect(pageIcon("zzz")).toBe("list");
  });
});
